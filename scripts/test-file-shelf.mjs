import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
async function compile(relative, overrides = {}) {
  const result = await build({ entryPoints: [path.join(root, relative)], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['electron'], plugins: [{
    name: 'clipboard-fixture', setup(builder) {
      builder.onResolve({ filter: /^\.\/file-clipboard$/ }, () => ({ path: 'clipboard-fixture', external: true }));
    },
  }], logLevel: 'silent' });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports,
    require: (id) => overrides[id] ?? require(id), __dirname: path.join(root, path.dirname(relative)),
    process, Buffer, setTimeout, clearTimeout, console,
  });
  return module.exports;
}
const { FileShelfStore, writeShelfDocument } = await compile('src/main/file-shelf/store.ts');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mybar-shelf-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = path.join(dir, '甲', '同名 "quoted".txt');
  const b = path.join(dir, '乙', path.basename(a));
  fs.mkdirSync(path.dirname(a)); fs.mkdirSync(path.dirname(b));
  fs.writeFileSync(a, 'alpha'); fs.writeFileSync(b, 'beta');
  return { dir, a, b, data: path.join(dir, 'data', 'shelf.json') };
}

test('shelf keeps file/folder references, deduplicates paths, and restores window preferences', async (t) => {
  const f = fixture(t);
  const store = new FileShelfStore(f.data);
  const result = await store.addPaths([f.a, f.a, f.b, path.dirname(f.a), path.join(f.dir, 'missing'), 'relative']);
  assert.equal(result.added, 3); assert.equal(result.duplicates, 1); assert.equal(result.skipped.length, 2);
  assert.equal(store.entries.filter((item) => item.kind === 'directory').length, 1);
  assert.equal(store.entries.filter((item) => item.name === path.basename(f.a)).length, 2);
  await store.setAlwaysOnTop(false);
  await store.saveBounds({ x: -1200, y: 90, width: 440, height: 540 });
  const restored = new FileShelfStore(f.data);
  assert.equal(restored.entries.length, 3); assert.equal(restored.alwaysOnTop, false);
  assert.equal(restored.bounds.x, -1200);
  assert.equal(JSON.stringify(restored.entries), JSON.stringify(store.entries));
  assert.ok(fs.statSync(f.data).size < 2000, 'document stores paths, not file contents');
  assert.equal(fs.readFileSync(f.a, 'utf8'), 'alpha');
  assert.equal(fs.readdirSync(path.dirname(f.data)).join(','), 'shelf.json', 'atomic write leaves no temporary file');
});

test('removed or moved sources become unavailable and cannot be resolved for transfer', async (t) => {
  const f = fixture(t); const store = new FileShelfStore(f.data);
  await store.addPaths([f.a, f.b]);
  const [first, second] = store.entries;
  fs.renameSync(f.a, `${f.a}.moved`); fs.unlinkSync(f.b);
  assert.ok(store.getItems().every((item) => !item.available && item.unavailableReason === 'missing'));
  assert.throws(() => store.resolveAvailable([first.id]), /unavailable/);
  assert.throws(() => store.resolveAvailable([second.id]), /unavailable/);
  assert.throws(() => store.resolveAvailable([f.a]), /no longer/);
  assert.throws(() => store.resolveAvailable([]), /Select/);
  assert.throws(() => store.resolveAvailable([{}]), /Select/);
  assert.equal(new FileShelfStore(f.data).entries.length, 2, 'invalid references remain visible after restart');
});

test('remove and clear only remove shelf records, including directory contents', async (t) => {
  const f = fixture(t); const store = new FileShelfStore(f.data);
  await store.addPaths([f.a, f.b, path.dirname(f.a)]);
  await store.remove([store.entries[0].id]); await store.clear();
  assert.equal(new FileShelfStore(f.data).entries.length, 0);
  assert.equal(fs.readFileSync(f.a, 'utf8'), 'alpha');
  assert.equal(fs.readFileSync(f.b, 'utf8'), 'beta');
});

test('failed atomic persistence keeps prior state and does not poison later queued changes', async (t) => {
  const f = fixture(t); let fail = false;
  const store = new FileShelfStore(f.data, async (...args) => {
    if (fail) throw new Error('fixture disk full');
    await writeShelfDocument(...args);
  });
  await store.addPaths([f.a]); const before = fs.readFileSync(f.data, 'utf8');
  fail = true;
  await assert.rejects(store.addPaths([f.b]), /disk full/);
  await assert.rejects(store.clear(), /disk full/);
  await assert.rejects(store.setAlwaysOnTop(false), /disk full/);
  assert.equal(store.entries.length, 1); assert.equal(store.alwaysOnTop, true);
  assert.equal(fs.readFileSync(f.data, 'utf8'), before);
  fail = false;
  await Promise.all([store.addPaths([f.b]), store.setAlwaysOnTop(false), store.saveBounds({ x: 0, y: 0, width: 400, height: 400 })]);
  await store.flush();
  assert.equal(new FileShelfStore(f.data).entries.length, 2);
  assert.equal(new FileShelfStore(f.data).alwaysOnTop, false);
});

test('corrupt and unsupported saved data are reported and preserved', async (t) => {
  const f = fixture(t); fs.mkdirSync(path.dirname(f.data));
  for (const contents of ['{broken', JSON.stringify({ version: 999, items: [], alwaysOnTop: true })]) {
    fs.writeFileSync(f.data, contents);
    const store = new FileShelfStore(f.data);
    assert.match(store.error, /preserved/);
    await assert.rejects(store.addPaths([f.a]), /preserved/);
    await assert.rejects(store.clear(), /preserved/);
    assert.equal(fs.readFileSync(f.data, 'utf8'), contents);
  }
});

async function controllerFixture(t, options = {}) {
  const { openInitially = true, screenOverrides = {} } = options;
  const f = fixture(t); const windows = []; const handlers = new Map(); const copied = []; const revealed = []; const popups = [];
  const ipcMain = new EventEmitter(); ipcMain.handle = (name, fn) => handlers.set(name, fn); ipcMain.removeHandler = (name) => handlers.delete(name);
  const icon = { isEmpty: () => false, toDataURL: () => 'fixture-icon' };
  const app = new EventEmitter(); app.getPath = () => f.dir; app.getFileIcon = async () => icon; app.quit = () => { app.quitCount = (app.quitCount || 0) + 1; };
  class BrowserWindow extends EventEmitter {
    constructor(opts) { super(); this.options = opts; this.bounds = opts; this.visible = false; this.destroyed = false;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.send = () => {}; this.webContents.setWindowOpenHandler = (fn) => { this.openHandler = fn; }; this.webContents.startDrag = (data) => { this.dragged = data; }; windows.push(this); }
    isDestroyed() { return this.destroyed; } isMinimized() { return false; }
    isVisible() { return this.visible; }
    show() { this.visible = true; } showInactive() { this.visible = true; } hide() { this.visible = false; } focus() {}
    setBounds(b) { this.bounds = { ...this.bounds, ...b }; }
    setAlwaysOnTop(value) { this.pinned = value; } setVisibleOnAllWorkspaces() {}
    getBounds() { const { x, y, width, height } = this.bounds; return { x, y, width, height }; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const Menu = {
    buildFromTemplate: (template) => ({
      template,
      popup: (opts) => popups.push({ opts, template }),
    }),
  };
  const defaultScreen = {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 })
  };
  const electron = {
    app, ipcMain, BrowserWindow, Menu, nativeImage: { createFromBitmap: () => icon },
    screen: { ...defaultScreen, ...screenOverrides },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [f.a, f.b] }) },
    shell: { showItemInFolder: (file) => revealed.push(file) }
  };
  const { registerFileShelf } = await compile('src/main/file-shelf/index.ts', { electron, 'clipboard-fixture': { copyFileReferences: async (paths) => copied.push(...paths) } });
  const controller = registerFileShelf({ loadWindowUrl: (window, hash) => { window.hash = hash; } });
  t.after(() => controller.dispose());
  const window = windows[0]; window.emit('ready-to-show');
  if (openInitially) controller.open();
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { ...f, app, controller, windows, window, handlers, ipcMain, event, copied, revealed, popups,
    invoke: (name, value, source = event) => handlers.get(`file-shelf:${name}`)(source, value) };
}

test('window stays on blur, hides on close, reuses one instance and persists pin/bounds', async (t) => {
  const f = await controllerFixture(t);
  assert.equal(f.window.hash, '/file-shelf'); assert.equal(f.window.pinned, true);
  f.window.emit('blur'); assert.equal(f.window.visible, true);
  let prevented = false; f.window.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(f.window.visible, false);
  f.controller.open(); assert.equal(f.windows.length, 1); assert.equal(f.window.visible, true);
  await f.invoke('set-always-on-top', false); assert.equal(f.window.pinned, false);
  f.window.bounds = { x: 90, y: 110, width: 460, height: 590 };
  await f.invoke('hide');
  let quitPrevented = false;
  f.app.emit('before-quit', { preventDefault: () => { quitPrevented = true; } });
  for (let index = 0; index < 100 && !f.app.quitCount; index++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(quitPrevented); assert.equal(f.app.quitCount, 1, 'quit resumes after outstanding saves');
  const restored = new FileShelfStore(path.join(f.dir, 'file-shelf', 'shelf.json'));
  assert.equal(restored.alwaysOnTop, false); assert.equal(restored.bounds.x, 90); assert.equal(restored.bounds.width, 460);
});

test('IPC rejects unrelated windows/frames and transfer operations accept registered available IDs only', async (t) => {
  const f = await controllerFixture(t);
  assert.throws(() => f.invoke('add', [f.a], { sender: {}, senderFrame: {} }), /rejected/);
  assert.throws(() => f.invoke('add', [f.a], { ...f.event, senderFrame: {} }), /rejected/);
  await f.invoke('choose', 'files');
  const state = f.invoke('get-state'); const ids = state.items.map((item) => item.id);
  assert.equal((await f.invoke('copy', [f.a])).ok, false); assert.equal(f.copied.length, 0);
  assert.equal((await f.invoke('copy', ids)).ok, true); assert.equal(f.copied.length, 2);
  f.ipcMain.emit('file-shelf:drag', f.event, ids);
  assert.equal(f.window.dragged.files.length, 2); assert.equal(f.window.dragged.file, f.a);
  assert.equal(f.invoke('get-state').items.length, 2, 'native drag retains shelf references');
  await f.invoke('reveal', ids[0]); assert.equal(f.revealed[0], f.a);
  fs.unlinkSync(f.a);
  assert.equal((await f.invoke('copy', ids)).ok, false); assert.equal(f.copied.length, 2);
  assert.equal((await f.invoke('reveal', ids[0])).ok, false); assert.equal(f.revealed.length, 1);
  assert.equal(f.window.openHandler().action, 'deny');
});

test('prewarm lifecycle creates hidden instance without popping up on desktop', async (t) => {
  const f = await controllerFixture(t, { openInitially: false });
  assert.equal(f.windows.length, 1, 'window prewarmed on controller creation');
  assert.equal(f.window.visible, false, 'prewarmed window remains hidden on creation');
  assert.equal(f.window.hash, '/file-shelf');
  assert.equal(f.controller.getMode(), 'shelf');
});

test('state transitions: hidden -> drop target -> shelf -> toggle hide/show', async (t) => {
  const f = await controllerFixture(t, { openInitially: false });
  assert.equal(f.window.visible, false);

  // Transition 1: Hidden -> Drop Target via shake/gesture
  f.controller.showTarget({ x: 300, y: 400 });
  assert.equal(f.window.visible, true);
  assert.equal(f.controller.getMode(), 'target');
  assert.equal(f.window.bounds.width, 180);
  assert.equal(f.window.bounds.height, 180);
  assert.equal(f.invoke('get-state').mode, 'target');

  // Transition 2: Drop Target -> Shelf on file drop
  const addResult = await f.invoke('add', [f.a]);
  assert.equal(addResult.ok, true);
  assert.equal(f.controller.getMode(), 'shelf');
  assert.equal(f.window.visible, true);
  assert.equal(f.invoke('get-state').mode, 'shelf');
  assert.equal(f.window.bounds.width, 180, 'bounds morphed to shelf size');

  // Transition 3: Cancel / hide
  await f.invoke('cancel-target');
  assert.equal(f.window.visible, false);

  // Transition 4: Launcher toggle (open -> hide -> open)
  f.controller.open();
  assert.equal(f.window.visible, true);
  assert.equal(f.controller.getMode(), 'shelf');
  f.controller.open();
  assert.equal(f.window.visible, false, 'second open call toggles off');
});

test('bounds clamping and multi-display coordinate support', async (t) => {
  const f = await controllerFixture(t, { openInitially: false });

  // Test edge clamping near bottom-right on 1440x900 display
  f.controller.showTarget({ x: 1430, y: 890 });
  const bounds = f.window.bounds;
  assert.ok(bounds.x + bounds.width <= 1440, 'x clamped within display width');
  assert.ok(bounds.y + bounds.height <= 900, 'y clamped within display height');
  assert.ok(bounds.x >= 0 && bounds.y >= 0);

  // Test secondary display with negative coordinates (-1920 to 0)
  const f2 = await controllerFixture(t, {
    openInitially: false,
    screenOverrides: {
      getDisplayNearestPoint: () => ({ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } }),
    },
  });
  f2.controller.showTarget({ x: -400, y: 300 });
  const negBounds = f2.window.bounds;
  assert.ok(negBounds.x >= -1920, 'negative x coordinates handled');
  assert.ok(negBounds.x + negBounds.width <= 0, 'stay within secondary monitor bounds');
});

test('settings and context menu dispatch correctly', async (t) => {
  const f = await controllerFixture(t);
  const state = f.invoke('get-state');
  assert.equal(state.shakeToActivate, true, 'shake to activate enabled by default');

  await f.invoke('set-shake-to-activate', false);
  assert.equal(f.invoke('get-state').shakeToActivate, false);

  await f.invoke('set-shake-to-activate', true);
  assert.equal(f.invoke('get-state').shakeToActivate, true);

  // Background context menu
  f.invoke('show-context-menu');
  assert.ok(f.popups.length >= 1, 'context menu popup displayed');
});

test('native shake detector self-test passes', async () => {
  const binary = path.join(root, 'dist', 'native', 'file-shelf-gesture-monitor');
  if (fs.existsSync(binary)) {
    const out = execFileSync(binary, ['--test'], { encoding: 'utf8' });
    assert.match(out, /SHAKE_DETECTOR_TESTS_PASSED/);
  }
});

