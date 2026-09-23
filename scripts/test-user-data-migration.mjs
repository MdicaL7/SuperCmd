#!/usr/bin/env node

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

  const customRequire = (specifier) => {
    if (specifier === './dev-profile') {
      return { isIsolatedDevProfile: false };
    }
    try {
      return require(specifier);
    } catch {
      return {};
    }
  };

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: customRequire,
    console,
    process,
    Buffer,
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

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wudi-test-migration-${prefix}-`));
}

test('UserData Migration: skips when isolated dev profile is active', () => {
  const tmpRoot = createTempDir('dev-profile');
  const sourceDir = path.join(tmpRoot, 'SuperCmd');
  const targetDir = path.join(tmpRoot, 'WUDI');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'settings.json'), '{"theme":"dark"}');

  const res = maybeMigrateUserDataFromSuperCmd({
    sourceDir,
    targetDir,
    isDevProfile: true,
  });

  assert.equal(res.migrated, false);
  assert.equal(res.reason, 'dev_profile');
  assert.equal(fs.existsSync(targetDir), false);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('UserData Migration: handles clean install when SuperCmd does not exist', () => {
  const tmpRoot = createTempDir('no-source');
  const sourceDir = path.join(tmpRoot, 'SuperCmd'); // non-existent
  const targetDir = path.join(tmpRoot, 'WUDI');

  const res = maybeMigrateUserDataFromSuperCmd({
    sourceDir,
    targetDir,
    isDevProfile: false,
  });

  assert.equal(res.migrated, false);
  assert.equal(res.reason, 'no_source_dir');
  assert.equal(fs.existsSync(targetDir), true);

  const markerPath = path.join(targetDir, USER_DATA_MIGRATION_MARKER);
  assert.equal(fs.existsSync(markerPath), true);
  const markerData = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.equal(markerData.reason, 'no_source_dir');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('UserData Migration: copies user data non-destructively, preserves cache exclusions', () => {
  const tmpRoot = createTempDir('full-migration');
  const sourceDir = path.join(tmpRoot, 'SuperCmd');
  const targetDir = path.join(tmpRoot, 'WUDI');

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'canvas'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'file-shelf'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'Cache'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'icon-cache'), { recursive: true });

  fs.writeFileSync(path.join(sourceDir, 'settings.json'), '{"migrated":false,"hotkey":"Cmd+Space"}');
  fs.writeFileSync(path.join(sourceDir, 'safe-storage.json'), '{"vault":{"key":"enc:xyz"}}');
  fs.writeFileSync(path.join(sourceDir, 'notes', 'my-note.md'), '# Hello WUDI');
  fs.writeFileSync(path.join(sourceDir, 'canvas', 'board.json'), '{"type":"excalidraw"}');
  fs.writeFileSync(path.join(sourceDir, 'file-shelf', 'state.json'), '{"shelves":[]}');
  // Ephemeral cache files that should NOT be migrated
  fs.writeFileSync(path.join(sourceDir, 'Cache', 'index'), 'binary cache');
  fs.writeFileSync(path.join(sourceDir, 'icon-cache', 'app.png'), 'cached icon');
  fs.writeFileSync(path.join(sourceDir, 'commands-disk-cache.json'), 'cache');

  const res = maybeMigrateUserDataFromSuperCmd({
    sourceDir,
    targetDir,
    isDevProfile: false,
  });

  assert.equal(res.migrated, true);
  assert.equal(res.reason, 'success');
  assert.ok(res.migratedFiles.includes('settings.json'));
  assert.ok(res.migratedFiles.includes('safe-storage.json'));
  assert.ok(res.migratedDirs.includes('notes'));
  assert.ok(res.migratedDirs.includes('canvas'));
  assert.ok(res.migratedDirs.includes('file-shelf'));

  // 1. Verify target has migrated user files
  assert.equal(fs.readFileSync(path.join(targetDir, 'settings.json'), 'utf8'), '{"migrated":false,"hotkey":"Cmd+Space"}');
  assert.equal(fs.readFileSync(path.join(targetDir, 'safe-storage.json'), 'utf8'), '{"vault":{"key":"enc:xyz"}}');
  assert.equal(fs.readFileSync(path.join(targetDir, 'notes', 'my-note.md'), 'utf8'), '# Hello WUDI');
  assert.equal(fs.readFileSync(path.join(targetDir, 'canvas', 'board.json'), 'utf8'), '{"type":"excalidraw"}');

  // 2. Verify target does NOT have ephemeral cache files
  assert.equal(fs.existsSync(path.join(targetDir, 'Cache')), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'icon-cache')), false);
  assert.equal(fs.existsSync(path.join(targetDir, 'commands-disk-cache.json')), false);

  // 3. Verify SOURCE files remain untouched (non-destructive)
  assert.equal(fs.existsSync(path.join(sourceDir, 'settings.json')), true);
  assert.equal(fs.existsSync(path.join(sourceDir, 'notes', 'my-note.md')), true);

  // 4. Verify marker file
  const markerPath = path.join(targetDir, USER_DATA_MIGRATION_MARKER);
  assert.equal(fs.existsSync(markerPath), true);
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.equal(marker.status, 'migrated');
  assert.ok(marker.migratedFiles.length >= 2);

  // 5. Test idempotency: second run does nothing
  fs.writeFileSync(path.join(sourceDir, 'new-file.json'), '{"new":true}');
  const res2 = maybeMigrateUserDataFromSuperCmd({
    sourceDir,
    targetDir,
    isDevProfile: false,
  });
  assert.equal(res2.migrated, false);
  assert.equal(res2.reason, 'already_migrated');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('UserData Migration: does not overwrite existing target files', () => {
  const tmpRoot = createTempDir('no-overwrite');
  const sourceDir = path.join(tmpRoot, 'SuperCmd');
  const targetDir = path.join(tmpRoot, 'WUDI');

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(targetDir, { recursive: true });

  fs.writeFileSync(path.join(sourceDir, 'settings.json'), '{"version":"old-supercmd"}');
  fs.writeFileSync(path.join(sourceDir, 'notes-window-state.json'), '{"bounds":"old"}');
  fs.writeFileSync(path.join(targetDir, 'settings.json'), '{"version":"new-wudi-user-custom"}');

  const res = maybeMigrateUserDataFromSuperCmd({
    sourceDir,
    targetDir,
    isDevProfile: false,
  });

  assert.equal(res.migrated, true);
  // target settings.json must NOT be overwritten
  assert.equal(fs.readFileSync(path.join(targetDir, 'settings.json'), 'utf8'), '{"version":"new-wudi-user-custom"}');
  // but missing notes-window-state.json should be migrated
  assert.equal(fs.readFileSync(path.join(targetDir, 'notes-window-state.json'), 'utf8'), '{"bounds":"old"}');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('UserData Migration: correctly migrates settings-location.json with fallback', () => {
  const tmpRoot = createTempDir('settings-location');
  const sourceDir = path.join(tmpRoot, 'SuperCmd');
  const targetDir = path.join(tmpRoot, 'WUDI');

  fs.mkdirSync(sourceDir, { recursive: true });
  const locationContent = JSON.stringify({ customSettingsPath: '/Users/test/CustomSync' });
  fs.writeFileSync(path.join(sourceDir, 'settings-location.json'), locationContent);

  const res = maybeMigrateUserDataFromSuperCmd({
    sourceDir,
    targetDir,
    isDevProfile: false,
  });

  assert.equal(res.migrated, true);
  assert.equal(res.reason, 'success');
  assert.ok(res.migratedFiles.includes('settings-location.json'));
  assert.equal(fs.readFileSync(path.join(targetDir, 'settings-location.json'), 'utf8'), locationContent);

  // Test legacy fallback when only location.json exists
  const tmpRoot2 = createTempDir('location-fallback');
  const sourceDir2 = path.join(tmpRoot2, 'SuperCmd');
  const targetDir2 = path.join(tmpRoot2, 'WUDI');
  fs.mkdirSync(sourceDir2, { recursive: true });
  fs.writeFileSync(path.join(sourceDir2, 'location.json'), locationContent);

  const res2 = maybeMigrateUserDataFromSuperCmd({
    sourceDir: sourceDir2,
    targetDir: targetDir2,
    isDevProfile: false,
  });
  assert.equal(res2.migrated, true);
  assert.equal(res2.reason, 'success');
  assert.equal(fs.readFileSync(path.join(targetDir2, 'settings-location.json'), 'utf8'), locationContent);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(tmpRoot2, { recursive: true, force: true });
});

test('UserData Migration: handles partial failure with state record, no completion marker, and successful retry', () => {
  const tmpRoot = createTempDir('partial-failure');
  const sourceDir = path.join(tmpRoot, 'SuperCmd');
  const targetDir = path.join(tmpRoot, 'WUDI');

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'extensions'), { recursive: true });

  fs.writeFileSync(path.join(sourceDir, 'settings.json'), '{"theme":"dark"}');
  fs.writeFileSync(path.join(sourceDir, 'notes', 'first.md'), '# First Note');
  fs.writeFileSync(path.join(sourceDir, 'extensions', 'ext.json'), '{"id":"ext1"}');

  // Pre-create target extensions directory as a file to force an intentional write failure
  fs.mkdirSync(targetDir, { recursive: true });
  // Create a read-only un-copyable target path or an unwritable path
  const blockedFile = path.join(targetDir, 'extensions');
  fs.writeFileSync(blockedFile, 'blocking-file-to-cause-error');
  // Make blocked file read-only to ensure conflict or copy error
  fs.chmodSync(blockedFile, 0o444);

  // 1. First run: partial failure expected
  const res1 = maybeMigrateUserDataFromSuperCmd({
    sourceDir,
    targetDir,
    isDevProfile: false,
  });

  assert.equal(res1.migrated, false);
  assert.equal(res1.reason, 'partial');
  assert.ok(res1.errors.length > 0, 'errors must be recorded');

  // Completion marker must NOT be created
  const markerPath = path.join(targetDir, USER_DATA_MIGRATION_MARKER);
  assert.equal(fs.existsSync(markerPath), false, 'completion marker must NOT be created on partial failure');

  // State file must be created
  const statePath = path.join(targetDir, USER_DATA_MIGRATION_STATE_FILE);
  assert.equal(fs.existsSync(statePath), true, 'state file must be created on partial failure');
  const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(stateData.status, 'partial');
  assert.ok(stateData.completedFiles.includes('settings.json'));
  assert.ok(stateData.errors.length > 0);

  // Settings was successfully migrated in first run
  assert.equal(fs.readFileSync(path.join(targetDir, 'settings.json'), 'utf8'), '{"theme":"dark"}');

  // 2. Resolve the blocking condition
  fs.chmodSync(blockedFile, 0o666);
  fs.rmSync(blockedFile, { force: true });

  // 3. Second run: retry succeeds
  const res2 = maybeMigrateUserDataFromSuperCmd({
    sourceDir,
    targetDir,
    isDevProfile: false,
  });

  assert.equal(res2.migrated, true);
  assert.equal(res2.reason, 'success');
  assert.equal(res2.errors.length, 0);

  // Now completion marker MUST exist
  assert.equal(fs.existsSync(markerPath), true, 'completion marker must be created after retry success');
  const finalMarker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.equal(finalMarker.status, 'migrated');

  // State file must have been cleaned up
  assert.equal(fs.existsSync(statePath), false, 'partial state file must be removed upon complete success');

  // Missing extensions directory is now migrated
  assert.equal(fs.readFileSync(path.join(targetDir, 'extensions', 'ext.json'), 'utf8'), '{"id":"ext1"}');

  // 4. Third run: already migrated
  const res3 = maybeMigrateUserDataFromSuperCmd({
    sourceDir,
    targetDir,
    isDevProfile: false,
  });
  assert.equal(res3.migrated, false);
  assert.equal(res3.reason, 'already_migrated');

  // 5. Source directory was NEVER modified
  assert.equal(fs.readFileSync(path.join(sourceDir, 'settings.json'), 'utf8'), '{"theme":"dark"}');
  assert.equal(fs.readFileSync(path.join(sourceDir, 'notes', 'first.md'), 'utf8'), '# First Note');
  assert.equal(fs.readFileSync(path.join(sourceDir, 'extensions', 'ext.json'), 'utf8'), '{"id":"ext1"}');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

