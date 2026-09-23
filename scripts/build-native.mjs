import { execSync } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

const require = createRequire(import.meta.url);

mkdirSync('dist/native', { recursive: true });

const electronVersion = require('../node_modules/electron/package.json').version;
const arch = process.arch;

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function getNodeGypCmd() {
  const homebrewGyp = '/opt/homebrew/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js';
  if (existsSync(homebrewGyp)) {
    return `node "${homebrewGyp}"`;
  }
  const localGyp = path.resolve('node_modules/.bin/node-gyp');
  if (existsSync(localGyp)) {
    return `"${localGyp}"`;
  }
  return 'npx --no-install node-gyp';
}

const swift = [
  ['dist/native/get-selected-text', 'src/native/get-selected-text.swift',
    '-framework Foundation -framework ApplicationServices -framework AppKit'],
  ['dist/native/translation-selected-text', 'src/native/translation-selected-text.swift',
    '-framework Foundation -framework ApplicationServices -framework AppKit'],
  ['dist/native/file-shelf-clipboard', 'src/native/file-shelf-clipboard.swift',
    '-framework AppKit -framework Foundation'],
  ['dist/native/file-shelf-gesture-monitor', 'src/native/file-shelf-gesture-monitor.swift',
    '-framework AppKit -framework Foundation -framework CoreGraphics'],
  ['dist/native/color-picker', 'src/native/color-picker.swift',
    '-framework AppKit'],
  ['dist/native/keyboard-lock', 'src/native/keyboard-lock.swift',
    '-framework CoreGraphics -framework Foundation'],
  ['dist/native/screen-ocr', 'src/native/screen-ocr.swift',
    '-framework AppKit -framework CoreGraphics -framework Foundation -framework Vision'],
  ['dist/native/screenshot-ocr', 'src/native/screenshot-ocr.swift',
    '-framework AppKit -framework Foundation -framework Vision'],
  ['dist/native/snippet-expander', 'src/native/snippet-expander.swift',
    '-framework AppKit'],
  ['dist/native/menu-item-search', 'src/native/menu-item-search.swift',
    '-framework AppKit -framework ApplicationServices'],
  ['dist/native/emoji-trigger-monitor',
    'src/native/emoji-trigger-monitor.swift src/native/ax-caret-query.swift',
    '-framework AppKit -framework ApplicationServices'],
  ['dist/native/hotkey-hold-monitor', 'src/native/hotkey-hold-monitor.swift',
    '-framework CoreGraphics -framework AppKit -framework Carbon'],
  ['dist/native/speech-recognizer', 'src/native/speech-recognizer.swift',
    '-framework Speech -framework AVFoundation'],
  ['dist/native/microphone-access', 'src/native/microphone-access.swift',
    '-framework AVFoundation'],
  ['dist/native/input-monitoring-request', 'src/native/input-monitoring-request.swift',
    '-framework CoreGraphics'],
  ['dist/native/window-adjust', 'src/native/window-adjust.swift',
    '-framework ApplicationServices -framework AppKit'],
  ['dist/native/calendar-events', 'src/native/calendar-events.swift',
    '-framework EventKit'],
  ['dist/native/settings-coordinator', 'src/native/settings-coordinator.swift',
    '-framework Foundation'],
  ['dist/native/audio-capturer', 'src/native/audio-capturer.swift',
    '-framework AVFoundation -framework Foundation'],
];

mkdirSync('.tmp/swift-cache', { recursive: true });
const toolboxOnly = process.argv.includes('--toolbox-only');
const toolboxHelpers = new Set(['screenshot-ocr', 'translation-selected-text', 'file-shelf-clipboard', 'file-shelf-gesture-monitor']);
for (const [out, src, frameworks] of swift) {
  if (toolboxOnly && !toolboxHelpers.has(out.split('/').pop())) continue;
  run(`swiftc -module-cache-path .tmp/swift-cache -O -o ${out} ${src} ${frameworks}`);
}

// The toolbox has no model downloads or native Node addon dependency.
if (toolboxOnly) process.exit(0);

// Build native Node addon (native_helpers.node)
const nodeGypCmd = getNodeGypCmd();
const pythonBin = existsSync('/usr/bin/python3') ? '--python=/usr/bin/python3' : '';
const xcodeDevDir = existsSync('/Applications/Xcode.app/Contents/Developer')
  ? '/Applications/Xcode.app/Contents/Developer'
  : '';
const sdkRootEnv = xcodeDevDir
  ? `DEVELOPER_DIR="${xcodeDevDir}" SDKROOT="$(DEVELOPER_DIR="${xcodeDevDir}" xcrun --sdk macosx --show-sdk-path)" `
  : '';
run(
  `cd src/native/native-helpers-addon && ` +
  `${sdkRootEnv}` +
  `HOME=~/.electron-gyp ${nodeGypCmd} rebuild ${pythonBin} ` +
  `--target=${electronVersion} --arch=${arch} ` +
  `--dist-url=https://electronjs.org/headers && ` +
  `cp build/Release/native_helpers.node ../../../dist/native/native_helpers.node`
);

run('node scripts/build-whispercpp.mjs');
run('node scripts/build-parakeet.mjs');
run('node scripts/build-soulver-calculator.mjs');
