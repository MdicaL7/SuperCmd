import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mockElectron = `
import { EventEmitter } from 'node:events';
export const __test = { windows: [], handlers: new Map(), modelCalls: [], copied: [], selection: '' };
export class BrowserWindow extends EventEmitter {
  constructor() { super(); this.webContents={ send(){} }; this.dead=false; this.visible=false; __test.windows.push(this); }
  isDestroyed(){ return this.dead; } setVisibleOnAllWorkspaces(){} show(){ this.visible=true; } hide(){ this.visible=false; } focus(){}
  close(){ this.dead=true; this.emit('closed'); } destroy(){ this.close(); }
}
export const ipcMain={handle:(k,f)=>__test.handlers.set(k,f),removeHandler:k=>__test.handlers.delete(k)};
export const screen={getCursorScreenPoint:()=>({x:0,y:0}),getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1440,height:900}})};
export const clipboard={writeText:text=>__test.copied.push(text)};
`;
const result = await build({
  stdin: { contents: "export { createTranslationFeature } from './src/main/translation-feature'; export { __test } from 'electron';", resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', define: { __dirname: JSON.stringify(path.join(root, 'dist/main')) },
  plugins: [{ name: 'offline-desktop', setup(build) {
    build.onResolve({ filter: /^(electron|\.\/ai-provider|\.\/settings-store|\.\/translation-selection)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path === 'electron' ? mockElectron
      : args.path === './settings-store' ? 'export const loadSettings=()=>({ai:{}});'
      : args.path === './translation-selection' ? "import {__test} from 'electron'; export const readCurrentTranslationSelection=async()=>__test.selection;"
      : "import {__test} from 'electron'; export const isAIAvailable=()=>true; export async function* streamAI(config, options){__test.modelCalls.push(options); yield 'translated';}", loader: 'js' }));
  } }],
});
const { createTranslationFeature, __test } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const wait = () => new Promise(r => setImmediate(r));
function harness(capture = async () => ({ status: 'cancelled' }), autoReady = true) {
  __test.windows.length = 0; __test.modelCalls.length = 0; __test.selection = ''; __test.copied.length = 0;
  const releases = [], preparations = [];
  const feature = createTranslationFeature({
    loadWindowUrl(window) { if (autoReady) window.emit('ready-to-show'); },
    async prepareSelection(source) { preparations.push(source); },
    captureAndRecognize: capture, releaseCapture: id => releases.push(id), openAISettings() {},
  });
  const invoke = (name, ...args) => __test.handlers.get(`translation:${name}`)({ sender: __test.windows.at(-1).webContents }, ...args);
  return { feature, releases, preparations, invoke };
}

test('translation captures once, passes only OCR text to provider, and releases on close', async () => {
  let captures = 0;
  const h = harness(async () => { captures++; return { status: 'ok', text: 'OCR words', artifact: { id: 'capture-1', previewDataUrl: 'not-for-model', width: 100, height: 100 } }; });
  await h.feature.executeCommand('system-translation-capture'); await wait();
  assert.equal(captures, 1);
  assert.equal(__test.modelCalls.length, 1);
  assert.equal(__test.modelCalls[0].prompt, 'OCR words');
  assert.equal(h.invoke('get-state').source, 'screenshot');
  await h.invoke('copy'); assert.deepEqual(__test.copied, ['translated']);
  h.invoke('close'); assert.deepEqual(h.releases, ['capture-1']);
  h.feature.dispose(); assert.deepEqual(h.releases, ['capture-1']);
});

test('capture cancellation opens no window and sends no model request', async () => {
  const h = harness();
  await h.feature.executeCommand('system-translation-capture');
  assert.equal(__test.windows.length, 0); assert.equal(__test.modelCalls.length, 0);
  h.feature.dispose();
});

test('late capture result is released and cannot replace a new translation', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  const capture = h.feature.executeCommand('system-translation-capture');
  h.feature.openTranslation({ text: 'new source', source: 'manual' });
  finish({ status: 'ok', text: 'old OCR', artifact: { id: 'late' } });
  await capture; await wait();
  assert.deepEqual(h.releases, ['late']);
  assert.equal(h.invoke('get-state').text, 'new source');
  assert.equal(__test.modelCalls.length, 1);
  h.feature.dispose();
});

test('missing current selection does not reuse previous text or request model', async () => {
  const h = harness();
  h.feature.openTranslation({ text: 'old selection', source: 'selection' }); await wait();
  __test.modelCalls.length = 0;
  await h.feature.executeCommand('system-translation-selection', 'launcher');
  const state = h.invoke('get-state');
  assert.equal(state.text, ''); assert.equal(state.error, 'no-selection');
  assert.deepEqual(h.preparations, ['launcher']); assert.equal(__test.modelCalls.length, 0);
  h.feature.dispose();
});

test('empty OCR keeps source editable without model request', async () => {
  const h = harness(async () => ({ status: 'ok', text: '', artifact: { id: 'empty-ocr' } }));
  await h.feature.executeCommand('system-translation-capture');
  assert.equal(h.invoke('get-state').error, 'no-text'); assert.equal(__test.modelCalls.length, 0);
  h.feature.dispose(); assert.deepEqual(h.releases, ['empty-ocr']);
});

test('capture source ownership transfers and is released on replacement or disposal', async () => {
  const h = harness();
  h.feature.openTranslation({ text: 'one', source: 'screenshot', captureId: 'one' });
  h.feature.openTranslation({ text: 'two', source: 'screenshot', captureId: 'two' });
  assert.deepEqual(h.releases, ['one']);
  h.feature.dispose(); assert.deepEqual(h.releases, ['one', 'two']);
  h.feature.openTranslation({ text: 'late', source: 'screenshot', captureId: 'late' });
  assert.deepEqual(h.releases, ['one', 'two', 'late']);
  assert.equal(__test.handlers.size, 0);
});

test('translation IPC rejects unrelated renderer', () => {
  const h = harness(); h.feature.openTranslation({ text: '', source: 'manual' });
  assert.throws(() => __test.handlers.get('translation:get-state')({ sender: {} }), /Invalid translation window/);
  h.feature.dispose();
});

test('late ready event cannot show a closed window or intrude on capture', async () => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }), false);
  h.feature.openTranslation({ text: '', source: 'manual' });
  const window = __test.windows.at(-1);
  const capture = h.feature.executeCommand('system-translation-capture');
  window.emit('ready-to-show');
  assert.equal(window.visible, false);
  finish({ status: 'cancelled' }); await capture;
  window.close(); window.emit('ready-to-show');
  assert.equal(window.visible, false);
  h.feature.dispose();
});
