#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadTsModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: resolvedPath,
  });

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    process,
    URL,
  };
  vm.runInNewContext(transpiled.outputText, sandbox);
  return module.exports;
}

const { isSupportedOAuthCallbackUrl, PROTOCOL_PRIMARY, PROTOCOL_LEGACY } = loadTsModule(
  path.join(root, 'src', 'shared', 'brand.ts')
);

test('OAuth Protocol: constants match expected brand schemes', () => {
  assert.equal(PROTOCOL_PRIMARY, 'wudi');
  assert.equal(PROTOCOL_LEGACY, 'supercmd');
});

test('OAuth Protocol: accepts supported callback URLs with primary wudi:// scheme', () => {
  assert.equal(isSupportedOAuthCallbackUrl('wudi://oauth/callback'), true);
  assert.equal(isSupportedOAuthCallbackUrl('wudi://oauth/callback?code=123&state=abc'), true);
  assert.equal(isSupportedOAuthCallbackUrl('wudi://auth/callback?token=xyz'), true);
});

test('OAuth Protocol: accepts supported callback URLs with legacy supercmd:// scheme', () => {
  assert.equal(isSupportedOAuthCallbackUrl('supercmd://oauth/callback'), true);
  assert.equal(isSupportedOAuthCallbackUrl('supercmd://oauth/callback?code=123&state=abc'), true);
  assert.equal(isSupportedOAuthCallbackUrl('supercmd://auth/callback?token=xyz'), true);
});

test('OAuth Protocol: rejects unsupported schemes and non-callback paths', () => {
  // Reject web and custom schemes
  assert.equal(isSupportedOAuthCallbackUrl('https://wudi.app/oauth/callback'), false);
  assert.equal(isSupportedOAuthCallbackUrl('https://supercmd.sh/oauth/callback'), false);
  assert.equal(isSupportedOAuthCallbackUrl('http://localhost:3000/oauth/callback'), false);
  assert.equal(isSupportedOAuthCallbackUrl('custom://oauth/callback'), false);
  assert.equal(isSupportedOAuthCallbackUrl('raycast://oauth/callback'), false);

  // Reject unsupported actions under valid schemes
  assert.equal(isSupportedOAuthCallbackUrl('wudi://settings/open'), false);
  assert.equal(isSupportedOAuthCallbackUrl('wudi://extensions/install?id=foo'), false);
  assert.equal(isSupportedOAuthCallbackUrl('supercmd://quicklink/run'), false);

  // Reject invalid, empty, or malformed inputs
  assert.equal(isSupportedOAuthCallbackUrl(''), false);
  assert.equal(isSupportedOAuthCallbackUrl(null), false);
  assert.equal(isSupportedOAuthCallbackUrl(undefined), false);
  assert.equal(isSupportedOAuthCallbackUrl('not-a-valid-url'), false);
});
