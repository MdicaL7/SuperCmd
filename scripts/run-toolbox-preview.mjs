#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.env.SUPERCMD_DEV_USER_DATA || path.join(os.tmpdir(), 'supercmd-toolbox-preview-profile');
if (!path.isAbsolute(profile)) throw new Error('SUPERCMD_DEV_USER_DATA must be an absolute path');
for (const file of ['dist/main/main.js', 'dist/renderer/index.html', ...['screenshot-ocr', 'translation-selected-text', 'file-shelf-clipboard', 'file-shelf-gesture-monitor'].map(name => `dist/native/${name}`)]) {
  if (!existsSync(path.join(root, file))) throw new Error(`Missing ${file}. Run build:main, build:renderer and build:toolbox-native first.`);
}
const require = createRequire(import.meta.url);
const env = { ...process.env, NODE_ENV: 'production', SUPERCMD_DEV_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
console.log(`Starting local toolbox preview. Isolated profile: ${profile}`);
const child = spawn(require('electron'), [root], { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
