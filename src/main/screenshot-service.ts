import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen, systemPreferences } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, type ExecFileException } from 'child_process';
import { randomUUID } from 'crypto';
import { ScreenshotStore } from './screenshot-store';
import { getNativeBinaryPath } from './native-binary';
import type { CaptureMode, CaptureArtifact, CaptureResult, CaptureOCRResult, ScreenshotActionResult } from '../shared/screenshot';

interface Dependencies {
  loadWindowUrl(win: BrowserWindow, hash: string): void;
  prepareCapture(): void;
  translate?(input: { text: string; source: 'screenshot'; captureId: string }): void | Promise<void>;
}

function runFile(binary: string, args: string[], signal?: AbortSignal, timeout = 120000): Promise<{ stdout: string; stderr: string; error: ExecFileException | null }> {
  return new Promise(resolve => {
    execFile(binary, args, { signal, timeout, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export function createScreenshotFeature(deps: Dependencies) {
  const store = new ScreenshotStore(path.join(app.getPath('temp'), `supercmd-captures-${process.pid}-${randomUUID()}`));
  const windows = new Map<number, { win: BrowserWindow; id: string; pinned: boolean; ratio: number; controller: AbortController }>();
  const processes = new Set<AbortController>();
  const pendingShow = new Set<BrowserWindow>();
  let busy = false;
  let disposed = false;

  function imageArtifact(filePath: string): CaptureArtifact {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) throw new Error('Screenshot image is empty');
    const size = image.getSize();
    // Preview remains bounded; original PNG stays at its full native resolution.
    const preview = size.width > 1600 ? image.resize({ width: 1600 }) : image;
    return store.add(filePath, { previewDataUrl: preview.toDataURL(), ...size });
  }

  async function capture(mode: CaptureMode, options: { signal?: AbortSignal } = {}): Promise<CaptureResult> {
    if (disposed) return { status: 'cancelled' };
    if (busy) return { status: 'error', message: 'A screenshot is already in progress.' };
    if (options.signal?.aborted) return { status: 'cancelled' };
    if (process.platform !== 'darwin') return { status: 'error', message: 'Screenshots currently require macOS.' };
    if (systemPreferences.getMediaAccessStatus('screen') === 'denied') {
      return { status: 'error', message: 'Allow SuperCmd in System Settings → Privacy & Security → Screen Recording, then reopen the app.' };
    }
    busy = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    processes.add(controller);
    const output = store.createPath();
    let hidden: BrowserWindow[] = [];
    try {
      // Snapshot the display before hiding the launcher or moving focus.
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      deps.prepareCapture();
      hidden = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed() && win.isVisible());
      hidden.forEach(win => win.hide());
      await new Promise(resolve => setTimeout(resolve, 160));
      if (controller.signal.aborted) return { status: 'cancelled' };
      const args = ['-x', '-t', 'png'];
      if (mode === 'region') args.push('-i', '-s');
      else if (mode === 'window') args.push('-i', '-w', '-o');
      else {
        const { x, y, width, height } = display.bounds;
        args.push(`-R${x},${y},${width},${height}`);
      }
      args.push(output);
      const result = await runFile('/usr/sbin/screencapture', args, controller.signal);
      if (controller.signal.aborted || disposed) return { status: 'cancelled' };
      if (!fs.existsSync(output)) {
        // macOS returns either 0 or 1 for Escape. Actual errors carry stderr.
        if (mode !== 'fullscreen' && !result.stderr.trim() && (!result.error || Number(result.error.code) === 1)) {
          return { status: 'cancelled' };
        }
        return { status: 'error', message: result.stderr.trim() || result.error?.message || 'Unable to capture the screen. Check Screen Recording permission.' };
      }
      if (result.error) return { status: 'error', message: result.stderr.trim() || result.error.message };
      const artifact = imageArtifact(output);
      return { status: 'ok', artifact };
    } catch (error) {
      return { status: 'error', message: String((error as Error).message || error) };
    } finally {
      // Only a registered artifact outlives the capture operation.
      if (!store.hasPath(output)) fs.rmSync(output, { force: true });
      busy = false;
      hidden.forEach(win => {
        try { if (!disposed && !win.isDestroyed()) win.showInactive(); } catch { /* Window may close during restore. */ }
      });
      for (const win of pendingShow) {
        try { if (!disposed && !win.isDestroyed()) win.showInactive(); } catch { /* Window closed during restore. */ }
      }
      pendingShow.clear();
      options.signal?.removeEventListener('abort', abort);
      processes.delete(controller);
      busy = false;
    }
  }

  async function recognize(id: string, signal?: AbortSignal): Promise<ScreenshotActionResult> {
    const item = store.get(id);
    if (!item || !store.retain(id)) return { status: 'error', message: 'This screenshot is no longer available.' };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    processes.add(controller);
    try {
      const binary = getNativeBinaryPath('screenshot-ocr');
      if (!fs.existsSync(binary)) return { status: 'error', message: 'The screenshot OCR helper is missing. Rebuild the native helpers.' };
      const result = await runFile(binary, [item.filePath], controller.signal, 60000);
      if (controller.signal.aborted || disposed) return { status: 'cancelled' };
      if (result.error) return { status: 'error', message: result.stderr.trim() || result.error.message };
      const parsed = JSON.parse(result.stdout);
      if (parsed.status !== 'ok') return { status: 'error', message: String(parsed.message || 'Text recognition failed.') };
      return { status: 'ok', text: String(parsed.text || '') };
    } catch (error) {
      return { status: 'error', message: String((error as Error).message || error) };
    } finally {
      signal?.removeEventListener('abort', abort);
      processes.delete(controller);
      store.release(id);
    }
  }

  async function captureAndRecognize(options: { signal?: AbortSignal } = {}): Promise<CaptureOCRResult> {
    const result = await capture('region', options);
    if (result.status !== 'ok') return result;
    const ocr = await recognize(result.artifact.id, options.signal);
    if (ocr.status !== 'ok') { store.release(result.artifact.id); return ocr; }
    return { status: 'ok', artifact: result.artifact, text: ocr.text || '' };
  }

  function showArtifact(artifact: CaptureArtifact, pinned: boolean): void {
    const work = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const maxWidth = Math.max(200, work.width - 100);
    const maxHeight = Math.max(160, work.height - 140);
    const ratio = artifact.width / artifact.height;
    const factor = Math.min(1, Math.min(900, maxWidth) / artifact.width, maxHeight / artifact.height);
    const width = Math.max(280, Math.round(artifact.width * factor));
    const height = Math.max(140, Math.round(artifact.height * factor)) + 58;
    const win = new BrowserWindow({
      width, height, x: Math.round(work.x + (work.width - width) / 2), y: Math.round(work.y + (work.height - height) / 2),
      minWidth: 180, minHeight: 110, frame: false, backgroundColor: '#202027',
      alwaysOnTop: pinned, show: false, fullscreenable: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
    });
    if (pinned) {
      win.setAlwaysOnTop(true, 'floating');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      win.setAspectRatio(ratio, { width: 0, height: 58 });
    }
    const senderId = win.webContents.id;
    const controller = new AbortController();
    windows.set(senderId, { win, id: artifact.id, pinned, ratio, controller });
    win.on('closed', () => { controller.abort(); pendingShow.delete(win); windows.delete(senderId); store.release(artifact.id); });
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && (input.key === 'Escape' || (input.meta && input.key.toLowerCase() === 'w'))) win.close();
    });
    win.once('ready-to-show', () => {
      if (win.isDestroyed() || disposed) return;
      if (busy) pendingShow.add(win);
      else win.show();
    });
    deps.loadWindowUrl(win, `/screenshot${pinned ? '-pin' : ''}`);
  }

  async function action(senderId: number, operation: 'copy' | 'save' | 'pin' | 'recognize' | 'translate'): Promise<ScreenshotActionResult> {
    const source = windows.get(senderId);
    const item = source && store.get(source.id);
    if (!source || !item) return { status: 'error', message: 'This screenshot is no longer available.' };
    store.retain(source.id);
    try {
      if (operation === 'copy') { clipboard.writeImage(nativeImage.createFromPath(item.filePath)); return { status: 'ok' }; }
      if (operation === 'save') {
        const result = await dialog.showSaveDialog(source.win, { defaultPath: `Screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] });
        if (result.canceled || !result.filePath) return { status: 'cancelled' };
        if (disposed) return { status: 'cancelled' };
        await fs.promises.copyFile(item.filePath, result.filePath);
        return { status: 'ok' };
      }
      if (operation === 'pin') {
        store.retain(source.id);
        try { showArtifact(item.artifact, true); } catch (error) { store.release(source.id); throw error; }
        return { status: 'ok' };
      }
      const ocr = await recognize(source.id, source.controller.signal);
      if (windows.get(senderId) !== source || source.win.isDestroyed()) return { status: 'cancelled' };
      if (ocr.status !== 'ok' || operation === 'recognize' || !ocr.text?.trim()) return ocr;
      if (!deps.translate) return { status: 'error', message: 'Translation is not available.' };
      store.retain(source.id);
      try { await deps.translate({ text: ocr.text, source: 'screenshot', captureId: source.id }); }
      catch (error) { store.release(source.id); throw error; }
      return { status: 'ok', text: ocr.text };
    } catch (error) { return { status: 'error', message: String((error as Error).message || error) }; }
    finally { store.release(source.id); }
  }

  ipcMain.handle('screenshot:current', event => {
    const source = windows.get(event.sender.id);
    const item = source && store.get(source.id);
    return source && item ? { artifact: item.artifact, pinned: source.pinned } : null;
  });
  const operations = ['copy', 'save', 'pin', 'recognize', 'translate'] as const;
  for (const operation of operations) ipcMain.handle(`screenshot:${operation}`, event => action(event.sender.id, operation));
  ipcMain.on('screenshot:close', event => windows.get(event.sender.id)?.win.close());
  ipcMain.on('screenshot:zoom', (event, factor: number) => {
    const source = windows.get(event.sender.id);
    if (!source?.pinned || !Number.isFinite(factor)) return;
    const [width, height] = source.win.getSize();
    const next = Math.max(180, Math.min(2400, width * Math.max(0.5, Math.min(2, factor))));
    source.win.setSize(Math.round(next), Math.max(110, Math.round((height - 58) * next / width + 58)));
  });

  return {
    captureAndRecognize, recognize,
    retain: (id: string) => store.retain(id), release: (id: string) => store.release(id),
    async executeCommand(commandId: string): Promise<boolean> {
      const modes: Record<string, CaptureMode> = { 'system-screenshot-region': 'region', 'system-screenshot-window': 'window', 'system-screenshot-fullscreen': 'fullscreen' };
      if (commandId === 'system-screenshot-pin-clipboard') {
        const image = clipboard.readImage();
        if (image.isEmpty()) { await dialog.showMessageBox({ type: 'info', message: 'The clipboard does not contain an image.' }); return true; }
        const filePath = store.createPath();
        fs.writeFileSync(filePath, image.toPNG());
        const artifact = imageArtifact(filePath);
        try { showArtifact(artifact, true); } catch (error) { store.release(artifact.id); throw error; }
        return true;
      }
      if (!(commandId in modes)) return false;
      const result = await capture(modes[commandId]);
      if (result.status === 'ok') {
        try { showArtifact(result.artifact, false); } catch (error) { store.release(result.artifact.id); throw error; }
      }
      else if (result.status === 'error') await dialog.showMessageBox({ type: 'error', message: result.message });
      return true;
    },
    dispose() {
      disposed = true;
      processes.forEach(controller => controller.abort());
      for (const source of windows.values()) if (!source.win.isDestroyed()) source.win.destroy();
      windows.clear();
      pendingShow.clear();
      for (const operation of ['current', ...operations]) ipcMain.removeHandler(`screenshot:${operation}`);
      ipcMain.removeAllListeners('screenshot:close');
      ipcMain.removeAllListeners('screenshot:zoom');
      store.dispose();
    },
  };
}
