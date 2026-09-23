#!/usr/bin/env node

// END-TO-END reproduction of the blank-window bug. This launches a real
// Electron process, opens a window, crashes its renderer for real with
// process.crash(), and asserts the window recovers and paints content again —
// running the actual production recovery logic against an actual crashed
// renderer rather than asserting on source text.
//
// It's heavier than the pure-logic tests, so it self-skips when Electron can't
// be launched (e.g. a headless CI box with no display, or
// WUDI_SKIP_ELECTRON_TESTS=1).

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = path.join(root, 'scripts/fixtures/crash-recovery-harness.cjs');

export function resolveElectronBinary() {
  try {
    // The 'electron' package's main export is the path to the binary.
    const require = createRequire(import.meta.url);
    const electronPath = require('electron');
    return typeof electronPath === 'string' ? electronPath : null;
  } catch {
    return null;
  }
}

/**
 * Determines whether a failure is strictly an OS permission or sandbox barrier
 * that warrants skipping in restricted runner environments, vs an unexpected
 * failure (e.g. ENOENT, syntax error, hang) that must fail the build.
 */
export function isExplicitSandboxOrPermissionError(result) {
  if (!result || result.ok) return false;
  const combined = `${result.error || ''} ${result.errorCode || ''} ${result.stderr || ''}`;
  const allowedPatterns = [
    'EPERM',
    'EACCES',
    'Operation not permitted',
    'Permission denied',
  ];
  return allowedPatterns.some((pattern) => combined.includes(pattern));
}

const electronBin = resolveElectronBinary();
const shouldSkip =
  process.env.WUDI_SKIP_ELECTRON_TESTS === '1'
  || process.env.SUPERCMD_SKIP_ELECTRON_TESTS === '1'
  || (process.platform === 'linux' && !process.env.DISPLAY);

function runHarness() {
  return new Promise((resolve) => {
    if (!electronBin) {
      resolve({
        ok: false,
        error: 'spawn-error: Electron binary not found',
        errorCode: 'ENOENT',
        stdout: '',
        stderr: 'Electron binary resolution returned null',
      });
      return;
    }

    // Strip ELECTRON_RUN_AS_NODE — if it leaks in from the parent, Electron runs
    // as plain Node and `require('electron')` yields no app/BrowserWindow.
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronBin, [harness], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const killTimer = setTimeout(() => child.kill('SIGKILL'), 30000);

    child.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({
        ok: false,
        error: 'spawn-error: ' + err.message,
        errorCode: err.code,
        stdout,
        stderr,
      });
    });

    child.on('close', () => {
      clearTimeout(killTimer);
      const line = stdout.split('\n').find((l) => l.startsWith('RESULT '));
      if (!line) {
        resolve({ ok: false, error: 'no-result', stdout, stderr });
        return;
      }
      try {
        resolve(JSON.parse(line.slice('RESULT '.length)));
      } catch (err) {
        resolve({ ok: false, error: 'bad-result: ' + String(err), stdout, stderr });
      }
    });
  });
}

test('isExplicitSandboxOrPermissionError classification unit tests', () => {
  // Must skip on explicit permissions / sandbox errors
  assert.equal(isExplicitSandboxOrPermissionError({ ok: false, errorCode: 'EPERM' }), true);
  assert.equal(isExplicitSandboxOrPermissionError({ ok: false, errorCode: 'EACCES' }), true);
  assert.equal(isExplicitSandboxOrPermissionError({ ok: false, stderr: 'spawn: Operation not permitted' }), true);
  assert.equal(isExplicitSandboxOrPermissionError({ ok: false, stderr: 'Electron: Permission denied' }), true);

  // Must NOT skip on ENOENT or unexpected bugs
  assert.equal(isExplicitSandboxOrPermissionError({ ok: false, errorCode: 'ENOENT', error: 'spawn ENOENT' }), false);
  assert.equal(isExplicitSandboxOrPermissionError({ ok: false, error: 'no-result', stderr: '' }), false);
  assert.equal(isExplicitSandboxOrPermissionError({ ok: false, error: 'bad-result: parse error' }), false);
  assert.equal(isExplicitSandboxOrPermissionError({ ok: true }), false);
  assert.equal(isExplicitSandboxOrPermissionError(null), false);
});

test('Renderer crash recovery (live Electron)', { skip: shouldSkip ? 'Electron not launchable here' : false }, async (t) => {
  const result = await runHarness();

  if (!result.ok) {
    if (isExplicitSandboxOrPermissionError(result)) {
      t.skip(`Skipping live Electron test: sandbox permissions prevent spawning Electron app (${result.errorCode || result.error})`);
      return;
    }
    assert.fail(`Live Electron harness failed unexpectedly: ${result.error || result.stderr || 'unknown error'}`);
  }

  await t.test('the renderer actually crashed', () => {
    assert.equal(result.crashObserved, true, `expected a real crash; got ${JSON.stringify(result)}`);
  });

  await t.test('the window recovered and painted content again (not blank)', () => {
    assert.equal(result.ok, true, `window did not recover: ${JSON.stringify(result)}`);
    assert.equal(result.paintedText, 'RENDERED', 'recovered renderer painted its content');
    assert.ok(result.mountCount >= 2, 'renderer mounted again after the crash');
  });
});
