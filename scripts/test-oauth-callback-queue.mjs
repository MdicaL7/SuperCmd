#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgePath = path.join(root, 'src/renderer/src/raycast-api/oauth/oauth-bridge.ts');
const serviceCorePath = path.join(root, 'src/renderer/src/raycast-api/oauth/oauth-service-core.ts');
let importNonce = 0;

async function importOAuthBridge() {
  const result = await build({
    entryPoints: [bridgePath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}#oauth-${importNonce++}`;
  return import(dataUrl);
}

async function importOAuthServiceCore() {
  const result = await build({
    entryPoints: [serviceCorePath],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}#oauth-core-${importNonce++}`;
  return import(dataUrl);
}

async function loadBridge(t) {
  const previousWindow = globalThis.window;
  let callback = null;

  globalThis.window = {
    electron: {
      onOAuthCallback: (handler) => {
        callback = handler;
        return () => {
          callback = null;
        };
      },
    },
  };

  t.after(() => {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  });

  const bridge = await importOAuthBridge();
  bridge.ensureOAuthCallbackBridge();
  assert.equal(typeof callback, 'function', 'OAuth callback bridge should register a callback listener');

  return {
    bridge,
    emit: (url) => callback(url),
  };
}

function callbackUrl(state, code = state) {
  const url = new URL('supercmd://oauth/callback');
  url.searchParams.set('state', state);
  url.searchParams.set('code', code);
  return url.toString();
}

test('OAuth callback queue caps retained unmatched callbacks', async (t) => {
  const { bridge, emit } = await loadBridge(t);
  const cap = bridge.OAUTH_CALLBACK_QUEUE_MAX_SIZE;
  const total = 1000;

  assert.ok(cap < total, 'test fixture should exceed the configured callback queue cap');

  for (let i = 0; i < total; i++) {
    emit(callbackUrl(`queued-${i}`));
  }

  await assert.rejects(
    bridge.waitForOAuthCallback('queued-0', 1),
    /OAuth authorization timed out/,
    'old unmatched callbacks should be evicted once the cap is exceeded'
  );

  const firstRetained = total - cap;
  const callback = await bridge.waitForOAuthCallback(`queued-${firstRetained}`, 1);
  assert.equal(callback.state, `queued-${firstRetained}`);
  assert.equal(callback.code, `queued-${firstRetained}`);
});

test('OAuth callback queue prunes entries older than the callback timeout window', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);

  const { bridge, emit } = await loadBridge(t);
  emit(callbackUrl('stale'));

  now += bridge.OAUTH_CALLBACK_TIMEOUT_MS + 1;
  emit(callbackUrl('fresh'));

  await assert.rejects(
    bridge.waitForOAuthCallback('stale', 1),
    /OAuth authorization timed out/,
    'callbacks outside the timeout window should be pruned'
  );

  const callback = await bridge.waitForOAuthCallback('fresh', 1);
  assert.equal(callback.state, 'fresh');
  assert.equal(callback.code, 'fresh');
});

test('OAuth callback waiter resolves when a matching state arrives', async (t) => {
  const { bridge, emit } = await loadBridge(t);
  const pending = bridge.waitForOAuthCallback('matching-state', 100);

  emit(callbackUrl('other-state'));
  emit(callbackUrl('matching-state', 'matching-code'));

  const callback = await pending;
  assert.equal(callback.state, 'matching-state');
  assert.equal(callback.code, 'matching-code');
});

test('OAuth callback bridge ignores malformed and non-OAuth URLs safely', async (t) => {
  const { bridge, emit } = await loadBridge(t);
  emit(callbackUrl('keep'));

  for (let i = 0; i < bridge.OAUTH_CALLBACK_QUEUE_MAX_SIZE + 25; i++) {
    emit(i % 2 === 0 ? `not a url ${i}` : `https://example.com/oauth/callback?state=ignored-${i}`);
  }

  const callback = await bridge.waitForOAuthCallback('keep', 1);
  assert.equal(callback.state, 'keep');
  assert.equal(callback.code, 'keep');

  await assert.rejects(
    bridge.waitForOAuthCallback('ignored-1', 1),
    /OAuth authorization timed out/,
    'non-OAuth URLs should not be retained as callbacks'
  );
});

test('Case 1 & 2: OAuth callback accepts both wudi:// and supercmd:// protocols', async (t) => {
  const { bridge, emit } = await loadBridge(t);

  // Case 1: wudi:// protocol
  const wudiWait = bridge.waitForOAuthCallback('wudi-state', 100);
  emit('wudi://oauth/callback?state=wudi-state&code=code-wudi');
  const wudiResult = await wudiWait;
  assert.equal(wudiResult.state, 'wudi-state');
  assert.equal(wudiResult.code, 'code-wudi');

  // Case 2: supercmd:// legacy protocol
  const legacyWait = bridge.waitForOAuthCallback('legacy-state', 100);
  emit('supercmd://oauth/callback?state=legacy-state&code=code-legacy');
  const legacyResult = await legacyWait;
  assert.equal(legacyResult.state, 'legacy-state');
  assert.equal(legacyResult.code, 'code-legacy');
});

test('Case 3: Non-WUDI and non-OAuth schemes like http:// are rejected', async (t) => {
  const { bridge, emit } = await loadBridge(t);

  emit('http://oauth/callback?state=http-state&code=123');
  emit('https://oauth/callback?state=https-state&code=123');
  emit('custom://oauth/callback?state=custom-state&code=123');

  await assert.rejects(
    bridge.waitForOAuthCallback('http-state', 10),
    /OAuth authorization timed out/,
    'http:// scheme must not be accepted as OAuth callback'
  );

  await assert.rejects(
    bridge.waitForOAuthCallback('https-state', 10),
    /OAuth authorization timed out/,
    'https:// scheme must not be accepted as OAuth callback'
  );
});

test('Case 4: OAuth callback queue does not double-consume entries', async (t) => {
  const { bridge, emit } = await loadBridge(t);

  emit('wudi://oauth/callback?state=single-use&code=code-single');
  const first = await bridge.waitForOAuthCallback('single-use', 100);
  assert.equal(first.code, 'code-single');

  // Second wait for the same state should time out because the callback has been consumed
  await assert.rejects(
    bridge.waitForOAuthCallback('single-use', 10),
    /OAuth authorization timed out/,
    'consumed callback must not be reusable'
  );
});

test('Case 5: OAuthServiceCore throws explicit actionable error when clientId is missing', async (t) => {
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;

  globalThis.window = {
    electron: {
      oauthSetFlowActive: async () => {},
    },
  };
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };

  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
  });

  const { OAuthServiceCore } = await importOAuthServiceCore();
  const service = new OAuthServiceCore({
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'repo read:user',
    // clientId intentionally omitted
  });

  await assert.rejects(
    service.beginAuthorization(),
    /Missing OAuth client ID\. Configure a client ID in extension preferences to authorize\./,
    'beginAuthorization must throw explicit actionable error when clientId is missing'
  );

  await assert.rejects(
    service.exchangeAuthorizationCode({
      code: 'test-code',
      codeVerifier: 'verifier',
      redirectUri: 'wudi://oauth/callback',
    }),
    /Missing OAuth client ID\. Configure a valid client ID and try again\./,
    'exchangeAuthorizationCode must throw explicit actionable error when clientId is missing'
  );
});

