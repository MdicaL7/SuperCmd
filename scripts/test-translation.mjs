import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importTs } from './lib/ts-import.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { TranslationController } = await importTs(path.join(root, 'src/main/translation-controller.ts'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness(stream = async function* () { yield '你好'; }, available = true) {
  const updates = [], requests = [];
  const controller = new TranslationController({
    isAvailable: () => available,
    stream(options) { requests.push(options); return stream(options); },
    onState(state) { updates.push(state); },
  });
  return { controller, updates, requests };
}

test('translation streams only source text and target instructions without memory', async () => {
  const h = harness(async function* () { yield '你'; yield '好'; });
  h.controller.setSource('Hello\nWorld', 'screenshot');
  await h.controller.translate('Hello\nWorld', 'zh-Hans');
  assert.equal(h.controller.snapshot().result, '你好');
  assert.equal(h.controller.snapshot().phase, 'done');
  assert.equal(h.requests[0].prompt, 'Hello\nWorld');
  assert.match(h.requests[0].systemPrompt, /Simplified Chinese/);
  assert.equal(h.requests[0].creativity, 0.1);
  assert.deepEqual(h.updates.filter(s => s.phase === 'translating').map(s => s.result), ['', '你', '你好']);
});

test('empty input and missing provider never make a model call', async () => {
  const empty = harness();
  await empty.controller.translate('  ', 'en');
  assert.equal(empty.controller.snapshot().error, 'no-text');
  assert.equal(empty.requests.length, 0);
  const unavailable = harness(undefined, false);
  await unavailable.controller.translate('Keep me', 'en');
  assert.equal(unavailable.controller.snapshot().error, 'not-configured');
  assert.equal(unavailable.controller.snapshot().text, 'Keep me');
  assert.equal(unavailable.requests.length, 0);
});

test('cancel aborts transport and ignores delayed chunks', async () => {
  const wait = deferred();
  const h = harness(async function* () { yield 'partial'; await wait.promise; yield 'too late'; });
  const running = h.controller.translate('text', 'en');
  await new Promise(r => setImmediate(r));
  h.controller.cancel();
  const snapshot = h.controller.snapshot();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(snapshot.phase, 'cancelled');
  wait.resolve();
  await running;
  assert.deepEqual(h.controller.snapshot(), snapshot);
});

test('new request wins even if old provider ignores cancellation', async () => {
  const wait = deferred();
  const h = harness(async function* ({ prompt }) { if (prompt === 'old') await wait.promise; yield prompt; });
  const old = h.controller.translate('old', 'en');
  await h.controller.translate('new', 'zh-Hans');
  wait.resolve(); await old;
  assert.equal(h.controller.snapshot().text, 'new');
  assert.equal(h.controller.snapshot().result, 'new');
  assert.equal(h.controller.snapshot().target, 'zh-Hans');
});

test('new source clears stale output and cancellation cannot refill it', async () => {
  const wait = deferred();
  const h = harness(async function* () { await wait.promise; yield 'old output'; });
  const run = h.controller.translate('old', 'en');
  h.controller.setSource('', 'selection');
  wait.resolve(); await run;
  assert.equal(h.controller.snapshot().text, '');
  assert.equal(h.controller.snapshot().result, '');
  assert.equal(h.controller.snapshot().phase, 'idle');
});

test('transport failure keeps editable source and retries with selected target', async () => {
  let calls = 0;
  const h = harness(async function* () { if (++calls === 1) throw new Error('Offline'); yield 'Translated'; });
  await h.controller.translate('原文', 'en');
  assert.equal(h.controller.snapshot().error, 'request-failed');
  assert.equal(h.controller.snapshot().text, '原文');
  await h.controller.translate('编辑后', 'en');
  assert.equal(h.controller.snapshot().result, 'Translated');
  assert.equal(h.controller.snapshot().error, undefined);
  assert.match(h.requests[1].systemPrompt, /English/);
});

test('empty model response is a recoverable failure', async () => {
  const h = harness(async function* () {});
  await h.controller.translate('source', 'en');
  assert.equal(h.controller.snapshot().error, 'empty-result');
});
