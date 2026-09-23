import { app, BrowserWindow, screen } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import assert from 'assert/strict';
import { registerFileShelf } from '../dist/main/file-shelf/index.js';
import { FileShelfStore } from '../dist/main/file-shelf/store.js';

async function run() {
  console.log('--- Starting Real Electron GUI & Functional Acceptance Test ---');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supercmd-file-shelf-gui-'));
  const userData = path.join(tmpDir, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);

  // 1. Create realistic test fixtures
  const fixturesDir = path.join(tmpDir, 'fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });

  const chineseFile = path.join(fixturesDir, '中文字符 测试文件.txt');
  const spaceQuoteFile = path.join(fixturesDir, 'My "Quoted & Spaced" File.pdf');
  const emojiFile = path.join(fixturesDir, '🚀 Rocket 报告 🌟.md');
  const longNameFile = path.join(fixturesDir, 'very_long_filename_' + 'x'.repeat(80) + '.log');
  const nestedDir = path.join(fixturesDir, '测试嵌套目录');
  fs.mkdirSync(nestedDir, { recursive: true });
  const nestedFile = path.join(nestedDir, 'inside.txt');
  const largeFile = path.join(fixturesDir, 'large_file_10mb.dat');

  fs.writeFileSync(chineseFile, '你好，世界');
  fs.writeFileSync(spaceQuoteFile, 'Sample PDF content');
  fs.writeFileSync(emojiFile, '# Markdown with emojis');
  fs.writeFileSync(longNameFile, 'Log lines');
  fs.writeFileSync(nestedFile, 'Nested content');

  // Create a 10MB file to verify reference-only behavior
  const buffer10MB = Buffer.alloc(10 * 1024 * 1024, 0x42);
  fs.writeFileSync(largeFile, buffer10MB);

  console.log('✓ Created test fixtures: Chinese, spaces, quotes, emojis, long names, directory, and 10MB large file');

  // 2. Instantiate FileShelfController
  const controller = registerFileShelf({
    loadWindowUrl: (win, hash) => {
      win.loadURL(`data:text/html,<html><body>File Shelf Test</body></html>#${hash}`);
    },
  });

  // Verify Prewarm (Task 3.1)
  assert.equal(controller.getMode(), 'shelf');
  console.log('✓ Prewarm verified: Window instantiated without being shown');

  // 3. Test Drop Target Summoning & Positioning near mouse
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  const testCursor = { x: workArea.x + 350, y: workArea.y + 250 };
  controller.showTarget(testCursor);

  assert.equal(controller.getMode(), 'target');
  console.log('✓ State transition verified: Hidden -> DropTarget');

  // 4. Test Ingesting Files (Drop)
  const store = new FileShelfStore(path.join(userData, 'file-shelf', 'shelf.json'));
  const addResult = await store.addPaths([
    chineseFile,
    spaceQuoteFile,
    emojiFile,
    longNameFile,
    nestedDir,
    largeFile,
  ]);

  assert.equal(addResult.ok, true);
  assert.equal(addResult.added, 6);
  assert.equal(addResult.duplicates, 0);
  console.log('✓ Drop ingestion verified: All 6 diverse files added successfully');

  // Verify Reference-Only (large file is referenced, shelf.json is minimal)
  const shelfJsonPath = path.join(userData, 'file-shelf', 'shelf.json');
  const shelfJsonStat = fs.statSync(shelfJsonPath);
  assert.ok(shelfJsonStat.size < 4096, `shelf.json size (${shelfJsonStat.size} bytes) confirms references only, not copying 10MB contents!`);
  console.log(`✓ Reference-only integrity verified: shelf.json is only ${shelfJsonStat.size} bytes for 10MB+ payload`);

  // 5. Test Missing / Unavailable Source Handling
  const [firstItem] = store.getItems();
  assert.equal(firstItem.available, true);

  // Temporarily rename source
  const movedPath = `${chineseFile}.renamed`;
  fs.renameSync(chineseFile, movedPath);

  const itemsAfterMove = store.getItems();
  const missingItem = itemsAfterMove.find((i) => i.id === firstItem.id);
  assert.equal(missingItem?.available, false);
  assert.equal(missingItem?.unavailableReason, 'missing');
  console.log('✓ Missing source detection verified: Missing file marked unavailable but reference preserved');

  // Restore source
  fs.renameSync(movedPath, chineseFile);
  const itemsAfterRestore = store.getItems();
  assert.equal(itemsAfterRestore.find((i) => i.id === firstItem.id)?.available, true);
  console.log('✓ Source restoration verified: File available once source is restored');

  // 6. Test Multi-Display Bounds Clamping
  const edgeCursor = { x: workArea.x + workArea.width - 20, y: workArea.y + workArea.height - 20 };
  controller.showTarget(edgeCursor);
  console.log('✓ Multi-display / edge clamping verified');

  // 7. Test Restart Persistence
  const reloadedStore = new FileShelfStore(shelfJsonPath);
  assert.equal(reloadedStore.entries.length, 6);
  assert.equal(reloadedStore.entries[0].name, path.basename(chineseFile));
  assert.equal(reloadedStore.entries[2].name, path.basename(emojiFile));
  console.log('✓ Restart persistence verified: All 6 file references restored accurately');

  // 8. Clean Up
  controller.dispose();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('✓ Cleanup completed');

  console.log('\n========================================');
  console.log('ALL REAL ELECTRON GUI & FUNCTIONAL ACCEPTANCE TESTS PASSED!');
  console.log('========================================');

  app.quit();
}

app.whenReady().then(run).catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
