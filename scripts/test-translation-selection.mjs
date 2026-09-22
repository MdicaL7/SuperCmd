import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('native selection policy reads only explicit focus and the focused PDF document', { skip: process.platform !== 'darwin' }, () => {
  const source = readFileSync(path.join(root, 'src/native/translation-selected-text.swift'), 'utf8');
  const start = source.indexOf('private func strictFocusedSelection(');
  const end = source.indexOf('// Do not prompt or synthesize Copy.', start);
  assert.ok(start >= 0 && end > start);
  const fixture = readFileSync(path.join(root, 'scripts/fixtures/translation-selection.swift'), 'utf8');
  const directory = mkdtempSync(path.join(os.tmpdir(), 'mybar-translation-selection-'));
  try {
    const main = path.join(directory, 'main.swift');
    const binary = path.join(directory, 'selection-test');
    writeFileSync(main, fixture.replace('// INSERT_POLICY', source.slice(start, end)));
    execFileSync('swiftc', ['-module-cache-path', path.join(os.tmpdir(), 'mybar-translation-swift-cache'), '-o', binary, main], { timeout: 60_000 });
    assert.match(execFileSync(binary, { encoding: 'utf8', timeout: 5_000 }), /8 strict focus selection cases passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
