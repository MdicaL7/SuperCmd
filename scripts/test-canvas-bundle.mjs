#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'canvas-app', 'excalidraw-bundle.tgz');
const mainTsPath = path.join(root, 'src', 'main', 'main.ts');

test('Canvas local bundle file exists and has valid size', () => {
  assert.ok(fs.existsSync(bundlePath), `Expected canvas bundle at ${bundlePath}`);
  const stat = fs.statSync(bundlePath);
  assert.ok(stat.size > 500_000, `Expected bundle tarball size > 500KB, got ${stat.size} bytes`);
});

test('Canvas tarball listing contains excalidraw-bundle.js', () => {
  const listing = execFileSync('/usr/bin/tar', ['-tzf', bundlePath], { encoding: 'utf8' });
  assert.ok(listing.includes('excalidraw-bundle.js'), 'Tarball must contain excalidraw-bundle.js');
});

test('Canvas bundle extracts successfully and contains valid JavaScript', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wudi-test-canvas-'));
  try {
    execFileSync('/usr/bin/tar', ['-xzf', bundlePath, '-C', tmpDir], { timeout: 30000 });
    const extractedFile = path.join(tmpDir, 'excalidraw-bundle.js');
    assert.ok(fs.existsSync(extractedFile), 'Extracted file must exist');

    const stat = fs.statSync(extractedFile);
    assert.ok(stat.size > 1_000_000, `Extracted bundle size should be > 1MB, got ${stat.size} bytes`);

    const head = fs.readFileSync(extractedFile, 'utf8').slice(0, 500);
    assert.ok(head.length > 50, 'Extracted JS file should have content');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Source code in main.ts has zero references to SuperCmd S3 canvas bucket', () => {
  const mainTs = fs.readFileSync(mainTsPath, 'utf8');
  assert.equal(
    mainTs.includes('supercmd-extensions.s3.amazonaws.com'),
    false,
    'main.ts must not contain remote fallback to SuperCmd S3 bucket'
  );
});
