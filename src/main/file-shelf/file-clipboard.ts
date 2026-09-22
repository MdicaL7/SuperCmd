import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Write NSURL file references, including image files, never a text list or bitmap. */
export async function copyFileReferences(paths: string[]): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('File shelf copying currently requires macOS.');
  const helper = path.join(__dirname, '..', '..', 'native', 'file-shelf-clipboard')
    .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
  if (!fs.existsSync(helper)) {
    throw new Error('The file clipboard helper is missing. Rebuild the app’s native tools.');
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    let errorOutput = '';
    const timer = setTimeout(() => child.kill(), 10_000);
    child.stderr.on('data', (data) => { errorOutput = (errorOutput + data.toString()).slice(-4096); });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || 'Could not copy the selected files.'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(paths));
  });
}
