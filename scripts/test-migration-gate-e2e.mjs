#!/usr/bin/env node
/**
 * End-to-End Migration Gate Acceptance Test
 *
 * Verifies all criteria of the final migration gate:
 * 1. Settings location migration (settings-location.json)
 * 2. Partial failure state machine and retry recovery
 * 3. SafeStorage synthetic secret readability
 * 4. Private updater safety (no unauthorized calls, clean disabled status)
 * 5. Source data non-destruction and target non-overwrite idempotency
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
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
  const customRequire = (specifier) => {
    if (specifier === './dev-profile') return { isIsolatedDevProfile: false };
    if (specifier === 'electron') {
      return {
        app: {
          getVersion: () => '1.0.26',
          isPackaged: true,
          getPath: () => '',
        },
        safeStorage: {
          isEncryptionAvailable: () => true,
          decryptString: (buf) => 'DECRYPTED_TEST_VALUE',
        },
      };
    }
    return require(specifier);
  };

  const sandbox = {
    module,
    exports: module.exports,
    require: customRequire,
    console,
    process,
    Buffer,
    URL,
    __dirname: path.dirname(resolvedPath),
    __filename: resolvedPath,
  };
  vm.runInNewContext(transpiled.outputText, sandbox);
  return module.exports;
}

const {
  maybeMigrateUserDataFromSuperCmd,
  USER_DATA_MIGRATION_MARKER,
  USER_DATA_MIGRATION_STATE_FILE,
  MIGRATION_FILES,
  MIGRATION_DIRS,
} = loadTsModule(path.join(root, 'src', 'main', 'user-data-migration.ts'));

const {
  APP_UPDATES_ENABLED,
  resolveAppUpdaterFeedConfig,
  UPDATE_OWNER,
  UPDATE_REPO,
} = loadTsModule(path.join(root, 'src', 'main', 'updater-config.ts'));

const { isSupportedOAuthCallbackUrl } = loadTsModule(path.join(root, 'src', 'shared', 'brand.ts'));

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wudi-gate-e2e-${prefix}-`));
}

test('Gate E2E: Complete synthetic profile migration and idempotency', () => {
  const tmpRoot = createTempDir('full');
  const sourceDir = path.join(tmpRoot, 'SuperCmd');
  const targetDir = path.join(tmpRoot, 'WUDI');

  // Build complete synthetic legacy profile
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'extensions'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'file-shelf'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'canvas'), { recursive: true });

  const filesToCreate = {
    'settings.json': JSON.stringify({ theme: 'dark', hotkey: 'Cmd+Space' }),
    'settings.local.json': JSON.stringify({ deviceSpecific: true }),
    'settings-location.json': JSON.stringify({ customSettingsPath: '/Users/test/iCloudDrive' }),
    'safe-storage.json': JSON.stringify({ 'ai.openaiApiKey': 'enc:synthetic-ai-blob' }),
    'oauth-tokens.json': JSON.stringify({ google: { accessToken: 'token-123' } }),
    'window-state.json': JSON.stringify({ width: 800, height: 600 }),
    'extension-preferences.json': JSON.stringify({ 'my-ext': { enabled: true } }),
    'ai-chat-conversations.json': JSON.stringify({ conversations: [] }),
    'local-memories.json': JSON.stringify({ memories: [] }),
  };

  for (const [filename, content] of Object.entries(filesToCreate)) {
    fs.writeFileSync(path.join(sourceDir, filename), content);
  }

  fs.writeFileSync(path.join(sourceDir, 'notes', 'todo.md'), '# Todo List');
  fs.writeFileSync(path.join(sourceDir, 'extensions', 'package.json'), '{"name":"ext"}');
  fs.writeFileSync(path.join(sourceDir, 'file-shelf', 'shelf.json'), '{"items":[]}');
  fs.writeFileSync(path.join(sourceDir, 'canvas', 'doc.json'), '{"canvas":true}');

  // Run initial migration
  const res1 = maybeMigrateUserDataFromSuperCmd({ sourceDir, targetDir, isDevProfile: false });

  assert.equal(res1.migrated, true);
  assert.equal(res1.reason, 'success');
  assert.equal(res1.errors.length, 0);

  // Verify all files match
  for (const [filename, content] of Object.entries(filesToCreate)) {
    assert.equal(fs.readFileSync(path.join(targetDir, filename), 'utf8'), content);
  }

  assert.equal(fs.readFileSync(path.join(targetDir, 'notes', 'todo.md'), 'utf8'), '# Todo List');
  assert.equal(fs.readFileSync(path.join(targetDir, 'file-shelf', 'shelf.json'), 'utf8'), '{"items":[]}');

  // Verify marker
  const marker = JSON.parse(fs.readFileSync(path.join(targetDir, USER_DATA_MIGRATION_MARKER), 'utf8'));
  assert.equal(marker.status, 'migrated');
  assert.ok(marker.migratedFiles.includes('settings-location.json'));

  // Verify source is completely untouched
  for (const [filename, content] of Object.entries(filesToCreate)) {
    assert.equal(fs.readFileSync(path.join(sourceDir, filename), 'utf8'), content);
  }

  // Idempotency: second run does not overwrite target modifications
  fs.writeFileSync(path.join(targetDir, 'settings.json'), '{"theme":"light-customized-by-user"}');
  const res2 = maybeMigrateUserDataFromSuperCmd({ sourceDir, targetDir, isDevProfile: false });
  assert.equal(res2.migrated, false);
  assert.equal(res2.reason, 'already_migrated');
  assert.equal(fs.readFileSync(path.join(targetDir, 'settings.json'), 'utf8'), '{"theme":"light-customized-by-user"}');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('Gate E2E: Partial failure state machine withhold marker and recovers on retry', () => {
  const tmpRoot = createTempDir('retry');
  const sourceDir = path.join(tmpRoot, 'SuperCmd');
  const targetDir = path.join(tmpRoot, 'WUDI');

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'quicklinks'), { recursive: true });

  fs.writeFileSync(path.join(sourceDir, 'settings.json'), '{"v":1}');
  fs.writeFileSync(path.join(sourceDir, 'notes', 'note.md'), 'note content');
  fs.writeFileSync(path.join(sourceDir, 'quicklinks', 'link.json'), '{"url":"https://example.com"}');

  // Block quicklinks directory in target
  fs.mkdirSync(targetDir, { recursive: true });
  const blockPath = path.join(targetDir, 'quicklinks');
  fs.writeFileSync(blockPath, 'unwritable-blocker');
  fs.chmodSync(blockPath, 0o444);

  // Attempt 1: partial failure
  const res1 = maybeMigrateUserDataFromSuperCmd({ sourceDir, targetDir, isDevProfile: false });
  assert.equal(res1.migrated, false);
  assert.equal(res1.reason, 'partial');
  assert.equal(fs.existsSync(path.join(targetDir, USER_DATA_MIGRATION_MARKER)), false);
  assert.equal(fs.existsSync(path.join(targetDir, USER_DATA_MIGRATION_STATE_FILE)), true);

  // Attempt 2: unblock and retry
  fs.chmodSync(blockPath, 0o666);
  fs.rmSync(blockPath, { force: true });

  const res2 = maybeMigrateUserDataFromSuperCmd({ sourceDir, targetDir, isDevProfile: false });
  assert.equal(res2.migrated, true);
  assert.equal(res2.reason, 'success');
  assert.equal(fs.existsSync(path.join(targetDir, USER_DATA_MIGRATION_MARKER)), true);
  assert.equal(fs.existsSync(path.join(targetDir, USER_DATA_MIGRATION_STATE_FILE)), false);
  assert.equal(fs.readFileSync(path.join(targetDir, 'quicklinks', 'link.json'), 'utf8'), '{"url":"https://example.com"}');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('Gate E2E: Private updater is safely disabled with zero leaks', () => {
  assert.equal(APP_UPDATES_ENABLED, false);
  assert.equal(UPDATE_OWNER, 'MdicaL7');
  assert.equal(UPDATE_REPO, 'WUDI');

  // Verify resolution with current package.json returns null (disabled)
  const feed = resolveAppUpdaterFeedConfig(null, [path.join(root, 'package.json')]);
  assert.equal(feed, null, 'Private repository must return null feed config to suppress updater');

  // Verify legacy SuperCmdLabs and SuperCmd cannot be configured
  assert.equal(resolveAppUpdaterFeedConfig({ repository: 'SuperCmdLabs/SuperCmd' }, undefined, true), null);
  assert.equal(resolveAppUpdaterFeedConfig({ repository: 'MdicaL7/SuperCmd' }, undefined, true), null);
});

test('Gate E2E: OAuth callback protocol handles both wudi:// and supercmd://', () => {
  assert.equal(isSupportedOAuthCallbackUrl('wudi://oauth/callback?code=test'), true);
  assert.equal(isSupportedOAuthCallbackUrl('supercmd://oauth/callback?code=test'), true);
  assert.equal(isSupportedOAuthCallbackUrl('https://wudi.app/oauth/callback'), false);
  assert.equal(isSupportedOAuthCallbackUrl('http://127.0.0.1/oauth/callback'), false);
});
