import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell } from 'electron';
import type { Event, IpcMainEvent, IpcMainInvokeEvent, NativeImage } from 'electron';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { FileShelfBounds, FileShelfMode, FileShelfResult, FileShelfSnapshot } from '../../shared/file-shelf';
import { FileShelfStore } from './store';
import { copyFileReferences } from './file-clipboard';

interface GestureConfig {
  baseRestartMs?: number;
  maxRestartMs?: number;
  maxRestartAttempts?: number;
  healthyThresholdMs?: number;
  degradedRestartMs?: number;
}

interface FileShelfOptions {
  loadWindowUrl: (window: BrowserWindow, hash: string) => void;
  gestureConfig?: GestureConfig;
}

const channelNames = [
  'get-state', 'add', 'choose', 'remove', 'clear', 'copy', 'reveal',
  'set-always-on-top', 'set-shake-to-activate', 'show-context-menu',
  'cancel-target', 'hide',
];

export function registerFileShelf(options: FileShelfOptions): {
  open(): void;
  hide(): void;
  dispose(): void;
  getMode(): FileShelfMode;
  showTarget(cursor?: { x: number; y: number }): void;
} {
  const store = new FileShelfStore(path.join(app.getPath('userData'), 'file-shelf', 'shelf.json'));
  let window: BrowserWindow | null = null;
  let currentMode: FileShelfMode = 'shelf';
  let quitting = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let dismissTimer: ReturnType<typeof setTimeout> | null = null;
  let gestureProcess: ChildProcess | null = null;
  let gestureDisposed = false;
  let gestureRestartTimer: ReturnType<typeof setTimeout> | null = null;
  let gestureHealthyTimer: ReturnType<typeof setTimeout> | null = null;
  let gestureRestartAttempts = 0;
  let gestureFatalError = false;
  let gestureGeneration = 0;

  const GESTURE_MAX_RESTART_ATTEMPTS = options.gestureConfig?.maxRestartAttempts ?? 5;
  const GESTURE_RESTART_BASE_MS = options.gestureConfig?.baseRestartMs ?? 2000;
  const GESTURE_RESTART_MAX_MS = options.gestureConfig?.maxRestartMs ?? 30_000;
  const GESTURE_HEALTHY_THRESHOLD_MS = options.gestureConfig?.healthyThresholdMs ?? 30_000;
  const GESTURE_DEGRADED_RESTART_MS = options.gestureConfig?.degradedRestartMs ?? 5 * 60 * 1000;

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
    if (window && !window.isDestroyed()) {
      window.webContents.send('file-shelf:error', error instanceof Error ? error.message : String(error));
    }
  };

  const snapshot = (): FileShelfSnapshot => ({
    items: store.getItems().map((item) => ({ ...item, iconDataUrl: iconCache.get(item.path)?.toDataURL() })),
    alwaysOnTop: store.alwaysOnTop,
    shakeToActivate: store.shakeToActivate,
    mode: currentMode,
    ...(store.error ? { error: store.error } : {}),
  });

  const broadcast = () => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('file-shelf:changed', snapshot());
    }
    warmIcons();
  };

  const warmIcons = () => {
    const currentPaths = new Set(store.entries.map((entry) => entry.path));
    for (const cached of iconCache.keys()) {
      if (!currentPaths.has(cached)) iconCache.delete(cached);
    }
    for (const entry of store.entries) {
      if (iconCache.has(entry.path) || pendingIcons.has(entry.path)) continue;
      pendingIcons.add(entry.path);

      const isImage = /\.(jpe?g|png|gif|webp|bmp|heic|tiff?)$/i.test(entry.path);
      if (isImage) {
        try {
          const img = nativeImage.createFromPath(entry.path);
          if (!img.isEmpty()) {
            const size = img.getSize();
            const targetW = 200;
            const targetH = Math.round((size.height / (size.width || 1)) * targetW);
            const resized = img.resize({ width: targetW, height: Math.min(260, Math.max(120, targetH)), quality: 'good' });
            iconCache.set(entry.path, resized);
            pendingIcons.delete(entry.path);
            if (window && !window.isDestroyed()) window.webContents.send('file-shelf:changed', snapshot());
            continue;
          }
        } catch {}
      }

      void app.getFileIcon(entry.path, { size: 'normal' }).then((icon) => {
        iconCache.set(entry.path, icon.isEmpty() ? fallbackIcon : icon);
        if (window && !window.isDestroyed()) window.webContents.send('file-shelf:changed', snapshot());
      }).catch(() => {
        iconCache.set(entry.path, fallbackIcon);
      }).finally(() => {
        pendingIcons.delete(entry.path);
      });
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
    if (window && !window.isDestroyed() && currentMode === 'shelf') {
      try {
        const b = window.getBounds();
        if (b.width >= 100 && b.height >= 100) {
          await store.saveBounds(b);
        }
      } catch (err) {
        console.warn('[FileShelf] bounds save skipped:', err);
      }
    }
    try {
      await store.flush();
    } catch {}
  };

  const scheduleBounds = () => {
    if (currentMode !== 'shelf') return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(saveBounds, 250);
  };

  const applyPin = () => {
    if (!window || window.isDestroyed()) return;
    window.setAlwaysOnTop(store.alwaysOnTop, 'floating');
    if (process.platform === 'darwin' && typeof window.setVisibleOnAllWorkspaces === 'function') {
      window.setVisibleOnAllWorkspaces(store.alwaysOnTop, { visibleOnFullScreen: store.alwaysOnTop });
    }
  };

  const getTargetBounds = (cursorPoint?: { x: number; y: number }): FileShelfBounds => {
    const pt = cursorPoint || (screen.getCursorScreenPoint ? screen.getCursorScreenPoint() : { x: 0, y: 0 });
    const display = screen.getDisplayNearestPoint
      ? screen.getDisplayNearestPoint(pt)
      : { workArea: { x: 0, y: 0, width: 1440, height: 900 } };
    const area = display.workArea;
    const width = 180;
    const height = 180;

    let x = Math.round(pt.x - width / 2);
    let y = Math.round(pt.y + 15);

    if (y + height > area.y + area.height) {
      y = Math.round(pt.y - height - 15);
    }

    x = Math.max(area.x + 8, Math.min(x, area.x + area.width - width - 8));
    y = Math.max(area.y + 8, Math.min(y, area.y + area.height - height - 8));

    return { x, y, width, height };
  };

  const getShelfBounds = (_itemCount = store.entries.length, referenceBounds?: FileShelfBounds): FileShelfBounds => {
    const width = 180;
    const height = 180;

    const saved = referenceBounds || store.bounds;
    const basePoint = saved
      ? { x: saved.x, y: saved.y }
      : (screen.getCursorScreenPoint ? screen.getCursorScreenPoint() : { x: 0, y: 0 });

    const display = saved && screen.getDisplayMatching
      ? screen.getDisplayMatching(saved)
      : (screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint(basePoint) : { workArea: { x: 0, y: 0, width: 1440, height: 900 } });

    const area = display.workArea;

    let x = saved ? saved.x : Math.round(basePoint.x - width / 2);
    let y = saved ? saved.y : Math.round(basePoint.y + 15);

    x = Math.max(area.x + 8, Math.min(x, area.x + area.width - width - 8));
    y = Math.max(area.y + 8, Math.min(y, area.y + area.height - height - 8));

    return { x, y, width, height };
  };

  const updateShelfBounds = () => {
    if (!window || window.isDestroyed()) return;
    const bounds = getShelfBounds(store.entries.length, window.getBounds());
    if (typeof window.setBounds === 'function') {
      window.setBounds(bounds);
    }
  };

  const isWindowVisible = (): boolean => {
    if (!window || window.isDestroyed()) return false;
    return typeof window.isVisible === 'function' ? window.isVisible() : Boolean((window as any).visible);
  };

  function prewarm(): void {
    if (window && !window.isDestroyed()) return;

    const initialBounds = getTargetBounds();
    window = new BrowserWindow({
      ...initialBounds,
      minWidth: 140,
      minHeight: 140,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      backgroundColor: '#00000000',
      alwaysOnTop: store.alwaysOnTop,
      show: false,
      focusable: true,
      acceptFirstMouse: true,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    applyPin();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'Escape' || ((input.meta || input.control) && input.key.toLowerCase() === 'w'))) {
        event.preventDefault();
        hide();
      }
    });

    window.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        hide();
      }
    });

    window.on('closed', () => { window = null; });
    window.on('move', scheduleBounds);
    window.on('resize', scheduleBounds);
    window.on('focus', broadcast);
    window.once('ready-to-show', () => { warmIcons(); });
    options.loadWindowUrl(window, '/file-shelf');
  }

  function showTarget(cursorPoint?: { x: number; y: number }): void {
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    if (!window || window.isDestroyed()) prewarm();
    if (!window) return;

    currentMode = 'target';
    const bounds = getTargetBounds(cursorPoint);
    if (typeof window.setBounds === 'function') {
      window.setBounds(bounds);
    }
    applyPin();
    broadcast();

    if (typeof window.showInactive === 'function') {
      window.showInactive();
    } else {
      window.show();
    }
  }

  function open(): void {
    if (!window || window.isDestroyed()) prewarm();
    if (!window) return;

    if (isWindowVisible() && currentMode === 'shelf') {
      hide();
      return;
    }

    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    currentMode = 'shelf';
    if (window.isMinimized()) window.restore();
    updateShelfBounds();
    applyPin();
    window.show();
    window.focus();
    broadcast();
  }

  function hide(): void {
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    if (window && !window.isDestroyed()) {
      window.hide();
      if (currentMode === 'shelf') saveBounds();
    }
    if (store.entries.length > 0) {
      void store.clear().then(() => {
        iconCache.clear();
        broadcast();
      }).catch(() => {});
    }
  }

  const scheduleGestureRestart = () => {
    if (gestureDisposed || quitting || gestureFatalError || !store.shakeToActivate) {
      return;
    }

    if (gestureRestartTimer) {
      clearTimeout(gestureRestartTimer);
      gestureRestartTimer = null;
    }

    let delay: number;
    if (gestureRestartAttempts >= GESTURE_MAX_RESTART_ATTEMPTS) {
      console.warn('[FileShelf] Gesture monitor restart limit reached; entering degraded retry mode (every 5m).');
      delay = GESTURE_DEGRADED_RESTART_MS;
    } else {
      delay = Math.min(
        GESTURE_RESTART_BASE_MS * 2 ** gestureRestartAttempts,
        GESTURE_RESTART_MAX_MS,
      );
      gestureRestartAttempts += 1;
    }

    gestureRestartTimer = setTimeout(() => {
      gestureRestartTimer = null;
      startGestureMonitor();
    }, delay);
  };

  const startGestureMonitor = () => {
    if (
      process.platform !== 'darwin'
      || gestureDisposed
      || quitting
      || !store.shakeToActivate
      || gestureFatalError
      || gestureProcess
    ) {
      return;
    }

    if (gestureRestartTimer) {
      clearTimeout(gestureRestartTimer);
      gestureRestartTimer = null;
    }

    const helperCandidates = [
      path.join(__dirname, '..', '..', 'native', 'file-shelf-gesture-monitor'),
      path.join(__dirname, '..', '..', 'dist', 'native', 'file-shelf-gesture-monitor'),
      path.join(__dirname, '..', '..', '..', 'dist', 'native', 'file-shelf-gesture-monitor'),
    ].map((p) => p.replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'));

    const helper = helperCandidates.find((candidate) => fs.existsSync(candidate));
    if (!helper) return;

    const generation = ++gestureGeneration;
    const startedAt = Date.now();
    let exitedOrErrored = false;

    try {
      const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      gestureProcess = child;
      let buffer = '';

      child.stdout?.on('data', (chunk: Buffer | string) => {
        if (generation !== gestureGeneration) return;
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const payload = JSON.parse(trimmed);

            if (payload.type === 'ready') {
              gestureFatalError = false;
              if (gestureHealthyTimer) clearTimeout(gestureHealthyTimer);
              gestureHealthyTimer = setTimeout(() => {
                gestureHealthyTimer = null;
                if (generation === gestureGeneration && gestureProcess === child) {
                  gestureRestartAttempts = 0;
                }
              }, GESTURE_HEALTHY_THRESHOLD_MS);
              continue;
            }

            if (payload.type === 'error') {
              gestureFatalError = true;
              console.warn('[FileShelf] Gesture monitor unavailable:', payload.message);
              continue;
            }

            if (payload.type === 'shake') {
              if (store.shakeToActivate) {
                showTarget({ x: payload.x, y: payload.y });
              }
            } else if (payload.type === 'drag_end') {
              if (currentMode === 'target' && isWindowVisible()) {
                if (dismissTimer) clearTimeout(dismissTimer);
                dismissTimer = setTimeout(() => {
                  dismissTimer = null;
                  if (currentMode === 'target' && isWindowVisible()) {
                    hide();
                  }
                }, 250);
              }
            }
          } catch {}
        }
      });

      child.on('error', (error) => {
        console.warn('[FileShelf] Gesture monitor process error:', error);
        if (gestureHealthyTimer) {
          clearTimeout(gestureHealthyTimer);
          gestureHealthyTimer = null;
        }

        if (gestureProcess === child) {
          gestureProcess = null;
        }

        if (generation !== gestureGeneration || gestureDisposed || quitting) {
          return;
        }

        if (!exitedOrErrored) {
          exitedOrErrored = true;
          scheduleGestureRestart();
        }
      });

      child.on('exit', (code, signal) => {
        if (gestureHealthyTimer) {
          clearTimeout(gestureHealthyTimer);
          gestureHealthyTimer = null;
        }

        if (gestureProcess === child) {
          gestureProcess = null;
        }

        if (generation !== gestureGeneration || gestureDisposed || quitting) {
          return;
        }

        const uptime = Date.now() - startedAt;
        if (uptime >= GESTURE_HEALTHY_THRESHOLD_MS) {
          gestureRestartAttempts = 0;
        }

        // Swift helper exits with code 2 on permission / event tap failure
        if (code === 2 || gestureFatalError) {
          gestureFatalError = true;
          console.warn(`[FileShelf] Gesture monitor stopped due to non-recoverable startup error (${code ?? signal}).`);
          return;
        }

        if (!exitedOrErrored) {
          exitedOrErrored = true;
          scheduleGestureRestart();
        }
      });
    } catch (error) {
      console.warn('[FileShelf] Failed to spawn gesture monitor synchronously:', error);
      if (generation === gestureGeneration) {
        gestureProcess = null;
        scheduleGestureRestart();
      }
    }
  };

  const updateShakeToActivate = async (value: boolean) => {
    await store.setShakeToActivate(value);
    if (value) {
      gestureFatalError = false;
      gestureRestartAttempts = 0;
      if (gestureRestartTimer) {
        clearTimeout(gestureRestartTimer);
        gestureRestartTimer = null;
      }
      if (!gestureProcess) {
        startGestureMonitor();
      }
    } else {
      gestureGeneration += 1;
      if (gestureRestartTimer) {
        clearTimeout(gestureRestartTimer);
        gestureRestartTimer = null;
      }
      if (gestureHealthyTimer) {
        clearTimeout(gestureHealthyTimer);
        gestureHealthyTimer = null;
      }
      const proc = gestureProcess;
      gestureProcess = null;
      proc?.kill();
    }
    broadcast();
  };

  const handle = (name: string, handler: (event: IpcMainInvokeEvent, value: any) => unknown) => {
    ipcMain.handle(`file-shelf:${name}`, (event, value) => {
      if (!trusted(event)) throw new Error('File shelf request rejected.');
      return handler(event, value);
    });
  };

  handle('get-state', () => { warmIcons(); return snapshot(); });

  handle('add', (_event, paths: unknown) => run(async () => {
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
    currentMode = 'shelf';
    const result = await store.addPaths(paths);
    updateShelfBounds();
    return result;
  }));

  handle('choose', (_event, kind: unknown) => run(async () => {
    if (kind !== 'files' && kind !== 'folders') throw new Error('Invalid file picker.');
    const chosen = await dialog.showOpenDialog(window!, { properties: [kind === 'files' ? 'openFile' : 'openDirectory', 'multiSelections'] });
    if (chosen.canceled) return { ok: true, cancelled: true };
    currentMode = 'shelf';
    const result = await store.addPaths(chosen.filePaths);
    updateShelfBounds();
    return result;
  }));

  handle('remove', (_event, ids: unknown) => run(async () => {
    await store.remove(ids);
    updateShelfBounds();
  }));

  handle('clear', () => run(async () => {
    await store.clear();
    hide();
  }));

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
    await store.setAlwaysOnTop(value);
    applyPin();
  }));

  handle('set-shake-to-activate', (_event, value: unknown) => run(async () => {
    if (typeof value !== 'boolean') throw new Error('Invalid preference.');
    await updateShakeToActivate(value);
  }));

  handle('show-context-menu', (_event, itemId: unknown) => {
    if (!window || window.isDestroyed() || !Menu) return;
    const isItem = typeof itemId === 'string' && itemId;

    const template: Electron.MenuItemConstructorOptions[] = isItem ? [
      {
        label: 'Show in Finder',
        click: () => {
          try {
            const [entry] = store.resolveAvailable([itemId]);
            shell.showItemInFolder(entry.path);
          } catch (err) { reportError(err); }
        },
      },
      {
        label: 'Copy Reference',
        accelerator: 'CmdOrCtrl+C',
        click: () => {
          void run(async () => {
            const entries = store.resolveAvailable([itemId]);
            await copyFileReferences(entries.map((e) => e.path));
          });
        },
      },
      { type: 'separator' },
      {
        label: 'Remove from Shelf',
        click: () => {
          void run(async () => {
            await store.remove([itemId]);
            updateShelfBounds();
          });
        },
      },
    ] : [
      {
        label: 'Add Files…',
        click: () => {
          void run(async () => {
            const chosen = await dialog.showOpenDialog(window!, { properties: ['openFile', 'multiSelections'] });
            if (!chosen.canceled) {
              await store.addPaths(chosen.filePaths);
              updateShelfBounds();
            }
          });
        },
      },
      {
        label: 'Add Folder…',
        click: () => {
          void run(async () => {
            const chosen = await dialog.showOpenDialog(window!, { properties: ['openDirectory', 'multiSelections'] });
            if (!chosen.canceled) {
              await store.addPaths(chosen.filePaths);
              updateShelfBounds();
            }
          });
        },
      },
      { type: 'separator' },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: store.alwaysOnTop,
        click: (menuItem) => {
          void run(async () => {
            await store.setAlwaysOnTop(menuItem.checked);
            applyPin();
          });
        },
      },
      {
        label: 'Shake to Activate',
        type: 'checkbox',
        checked: store.shakeToActivate,
        click: (menuItem) => {
          void run(() => updateShakeToActivate(menuItem.checked));
        },
      },
      { type: 'separator' },
      {
        label: 'Clear Shelf',
        enabled: store.entries.length > 0,
        click: () => {
          void run(async () => {
            await store.clear();
            hide();
          });
        },
      },
      {
        label: 'Hide Shelf',
        accelerator: 'Esc',
        click: () => { hide(); },
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window });
  });

  handle('cancel-target', () => { hide(); });
  handle('hide', () => { hide(); });

  const drag = (event: IpcMainEvent, ids: unknown) => {
    if (!trusted(event)) return;
    try {
      const entries = store.resolveAvailable(ids);
      event.sender.startDrag({
        file: entries[0].path,
        files: entries.map((entry) => entry.path),
        icon: iconCache.get(entries[0].path) || fallbackIcon,
      });
    } catch (error) {
      reportError(error);
      broadcast();
    }
  };

  ipcMain.on('file-shelf:drag', drag);

  const beforeQuit = (event: Event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void saveBounds().finally(() => app.quit());
  };
  app.on('before-quit', beforeQuit);

  // Prewarm window on creation
  prewarm();
  if (store.shakeToActivate) {
    startGestureMonitor();
  }

  return {
    open,
    hide,
    dispose: () => {
      quitting = true;
      gestureDisposed = true;
      gestureGeneration += 1;
      if (gestureRestartTimer) {
        clearTimeout(gestureRestartTimer);
        gestureRestartTimer = null;
      }
      if (gestureHealthyTimer) {
        clearTimeout(gestureHealthyTimer);
        gestureHealthyTimer = null;
      }
      if (dismissTimer) clearTimeout(dismissTimer);
      if (persistTimer) clearTimeout(persistTimer);
      if (gestureProcess) {
        const proc = gestureProcess;
        gestureProcess = null;
        proc.kill();
      }
      for (const name of channelNames) ipcMain.removeHandler(`file-shelf:${name}`);
      ipcMain.removeListener('file-shelf:drag', drag);
      app.removeListener('before-quit', beforeQuit);
      window?.destroy();
      window = null;
      iconCache.clear();
    },
    getMode: () => currentMode,
    showTarget,
  };
}
