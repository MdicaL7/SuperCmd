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
