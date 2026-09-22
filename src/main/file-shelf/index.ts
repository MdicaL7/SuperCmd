import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell } from 'electron';
import type { Event, IpcMainEvent, IpcMainInvokeEvent, NativeImage } from 'electron';
import * as path from 'path';
import type { FileShelfBounds, FileShelfResult, FileShelfSnapshot } from '../../shared/file-shelf';
import { FileShelfStore } from './store';
import { copyFileReferences } from './file-clipboard';

interface FileShelfOptions {
  loadWindowUrl: (window: BrowserWindow, hash: string) => void;
}

const channelNames = ['get-state', 'add', 'choose', 'remove', 'clear', 'copy', 'reveal', 'set-always-on-top', 'hide'];

export function registerFileShelf(options: FileShelfOptions): { open(): void; dispose(): void } {
  const store = new FileShelfStore(path.join(app.getPath('userData'), 'file-shelf', 'shelf.json'));
  let window: BrowserWindow | null = null;
  let quitting = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  const iconCache = new Map<string, NativeImage>();
  const pendingIcons = new Set<string>();
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 216; pixels[index + 1] = 148; pixels[index + 2] = 54; pixels[index + 3] = 255;
  }
  const fallbackIcon = nativeImage.createFromBitmap(pixels, { width: 32, height: 32 });

  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => Boolean(
    window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame,
  );
  const reportError = (error: unknown) => {
    if (window && !window.isDestroyed()) window.webContents.send('file-shelf:error', error instanceof Error ? error.message : String(error));
  };
  const snapshot = (): FileShelfSnapshot => ({
    items: store.getItems().map((item) => ({ ...item, iconDataUrl: iconCache.get(item.path)?.toDataURL() })),
    alwaysOnTop: store.alwaysOnTop,
    ...(store.error ? { error: store.error } : {}),
  });
  const broadcast = () => {
    if (window && !window.isDestroyed()) window.webContents.send('file-shelf:changed', snapshot());
    warmIcons();
  };
  const warmIcons = () => {
    const currentPaths = new Set(store.entries.map((entry) => entry.path));
    for (const cached of iconCache.keys()) if (!currentPaths.has(cached)) iconCache.delete(cached);
    for (const entry of store.entries) {
      if (iconCache.has(entry.path) || pendingIcons.has(entry.path)) continue;
      pendingIcons.add(entry.path);
      void app.getFileIcon(entry.path, { size: 'normal' }).then((icon) => {
        iconCache.set(entry.path, icon.isEmpty() ? fallbackIcon : icon);
        if (window && !window.isDestroyed()) window.webContents.send('file-shelf:changed', snapshot());
      }).catch(() => { iconCache.set(entry.path, fallbackIcon); }).finally(() => { pendingIcons.delete(entry.path); });
    }
  };

  const run = async (operation: () => Promise<FileShelfResult | void> | FileShelfResult | void): Promise<FileShelfResult> => {
    try {
      const result = await operation();
      broadcast();
      return result || { ok: true };
    } catch (error) {
      broadcast();
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const saveBounds = async () => {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    if (window && !window.isDestroyed()) await store.saveBounds(window.getBounds()).catch(reportError);
    await store.flush();
  };
  const scheduleBounds = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(saveBounds, 250);
  };
  const applyPin = () => {
    if (!window) return;
    window.setAlwaysOnTop(store.alwaysOnTop, 'floating');
    if (process.platform === 'darwin') {
      window.setVisibleOnAllWorkspaces(store.alwaysOnTop, { visibleOnFullScreen: store.alwaysOnTop });
    }
  };
  const bounds = (): FileShelfBounds => {
    const saved = store.bounds;
    const display = saved ? screen.getDisplayMatching(saved) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const width = Math.min(saved?.width || 440, area.width);
    const height = Math.min(saved?.height || 540, area.height);
    return {
      width, height,
      x: Math.max(area.x, Math.min(saved?.x ?? area.x + area.width - width - 24, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(saved?.y ?? area.y + 72, area.y + area.height - height)),
    };
  };

  function open(): void {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus(); broadcast(); return;
    }
    window = new BrowserWindow({
      ...bounds(), minWidth: 360, minHeight: 320,
      title: 'File Shelf', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 17 },
      backgroundColor: '#17191e', alwaysOnTop: store.alwaysOnTop, show: false, fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    applyPin();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'Escape' || ((input.meta || input.control) && input.key.toLowerCase() === 'w'))) {
        event.preventDefault(); window?.hide(); saveBounds();
      }
    });
    window.on('close', (event) => { if (!quitting) { event.preventDefault(); window?.hide(); saveBounds(); } });
    window.on('closed', () => { window = null; });
    window.on('move', scheduleBounds);
    window.on('resize', scheduleBounds);
    window.on('focus', broadcast);
    window.once('ready-to-show', () => { window?.show(); warmIcons(); });
    options.loadWindowUrl(window, '/file-shelf');
  }

  const handle = (name: string, handler: (event: IpcMainInvokeEvent, value: any) => unknown) => {
    ipcMain.handle(`file-shelf:${name}`, (event, value) => {
      if (!trusted(event)) throw new Error('File shelf request rejected.');
      return handler(event, value);
    });
  };
  handle('get-state', () => { warmIcons(); return snapshot(); });
  handle('add', (_event, paths: unknown) => run(() => store.addPaths(paths)));
  handle('choose', (_event, kind: unknown) => run(async () => {
    if (kind !== 'files' && kind !== 'folders') throw new Error('Invalid file picker.');
    const chosen = await dialog.showOpenDialog(window!, { properties: [kind === 'files' ? 'openFile' : 'openDirectory', 'multiSelections'] });
    return chosen.canceled ? { ok: true, cancelled: true } : store.addPaths(chosen.filePaths);
  }));
  handle('remove', (_event, ids: unknown) => run(() => store.remove(ids)));
  handle('clear', () => run(() => store.clear()));
  handle('copy', (_event, ids: unknown) => run(async () => {
    const entries = store.resolveAvailable(ids);
    await copyFileReferences(entries.map((entry) => entry.path));
  }));
  handle('reveal', (_event, id: unknown) => run(() => {
    const [entry] = store.resolveAvailable([id]);
    shell.showItemInFolder(entry.path);
  }));
  handle('set-always-on-top', (_event, value: unknown) => run(async () => {
    if (typeof value !== 'boolean') throw new Error('Invalid window preference.');
    await store.setAlwaysOnTop(value); applyPin();
  }));
  handle('hide', () => { window?.hide(); saveBounds(); });

  const drag = (event: IpcMainEvent, ids: unknown) => {
    if (!trusted(event)) return;
    try {
      const entries = store.resolveAvailable(ids);
      // Electron v41.2.1 drag_util_mac.mm restricts external drag targets to
      // NSDragOperationCopy. The shelf never offers a move/delete operation.
      event.sender.startDrag({ file: entries[0].path, files: entries.map((entry) => entry.path), icon: iconCache.get(entries[0].path) || fallbackIcon });
    } catch (error) { reportError(error); broadcast(); }
  };
  ipcMain.on('file-shelf:drag', drag);
  const beforeQuit = (event: Event) => {
    if (quitting) return;
    // Electron does not await event handlers. Finish queued reference/window writes
    // before allowing the second quit event to close the application.
    event.preventDefault();
    quitting = true;
    void saveBounds().finally(() => app.quit());
  };
  app.on('before-quit', beforeQuit);

  return {
    open,
    dispose: () => {
      quitting = true;
      if (persistTimer) clearTimeout(persistTimer);
      for (const name of channelNames) ipcMain.removeHandler(`file-shelf:${name}`);
      ipcMain.removeListener('file-shelf:drag', drag);
      app.removeListener('before-quit', beforeQuit);
      window?.destroy(); window = null; iconCache.clear();
    },
  };
}
