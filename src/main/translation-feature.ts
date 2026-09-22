import { BrowserWindow, clipboard, ipcMain, screen } from 'electron';
import * as path from 'path';
import { isAIAvailable, streamAI } from './ai-provider';
import { loadSettings } from './settings-store';
import { TranslationController } from './translation-controller';
import { readCurrentTranslationSelection } from './translation-selection';
import type { CaptureOCRResult } from '../shared/screenshot';
import type { TranslationInput, TranslationTarget } from '../shared/translation';

export interface TranslationFeatureDependencies {
  loadWindowUrl(window: BrowserWindow, route: string): void;
  /** Hides the launcher and restores the source app before a fresh AX read. */
  prepareSelection(source: 'launcher' | 'hotkey' | 'widget'): Promise<void>;
  captureAndRecognize(options?: { signal?: AbortSignal }): Promise<CaptureOCRResult>;
  releaseCapture(id: string): void;
  openAISettings(): void;
}

export function createTranslationFeature(deps: TranslationFeatureDependencies) {
  let window: BrowserWindow | null = null;
  let captureId: string | undefined;
  let captureController: AbortController | null = null;
  let operation = 0;
  let disposed = false;
  let wantsVisible = false;
  const channels: string[] = [];
  const controller = new TranslationController({
    isAvailable: () => isAIAvailable(loadSettings().ai),
    stream: (options) => streamAI(loadSettings().ai, options),
    onState: (state) => {
      if (window && !window.isDestroyed()) window.webContents.send('translation:state', state);
    },
  });

  function releaseCapture() {
    if (captureId) deps.releaseCapture(captureId);
    captureId = undefined;
  }

  function invalidate() {
    operation += 1;
    captureController?.abort();
    captureController = null;
    controller.cancel();
    releaseCapture();
  }

  function show() {
    if (disposed) return;
    wantsVisible = true;
    if (!window || window.isDestroyed()) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      const width = Math.min(680, area.width);
      const height = Math.min(660, area.height);
      window = new BrowserWindow({
        width, height, minWidth: 420, minHeight: 380,
        x: area.x + Math.round((area.width - width) / 2),
        y: area.y + Math.round((area.height - height) / 2),
        title: 'Translate', frame: false, resizable: true, alwaysOnTop: true,
        skipTaskbar: true, show: false, backgroundColor: '#101113',
        webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
      });
      const created = window;
      created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      created.once('ready-to-show', () => {
        if (!disposed && wantsVisible && window === created && !created.isDestroyed()) { created.show(); created.focus(); }
      });
      created.on('closed', () => {
        if (window !== created) return;
        wantsVisible = false;
        invalidate();
        window = null;
      });
      deps.loadWindowUrl(created, '/translation');
    } else { window.show(); window.focus(); }
  }

  function openTranslation(input: TranslationInput) {
    invalidate();
    if (disposed) { if (input.captureId) deps.releaseCapture(input.captureId); return; }
    captureId = input.captureId;
    controller.setSource(input.text, input.source);
    show();
    if (input.text.trim()) void controller.translate(input.text, controller.snapshot().target);
  }

  async function executeCommand(commandId: string, source: 'launcher' | 'hotkey' | 'widget' = 'hotkey'): Promise<boolean> {
    if (!['system-translation-open', 'system-translation-selection', 'system-translation-capture'].includes(commandId)) return false;
    if (disposed) return false;
    if (commandId === 'system-translation-open') { openTranslation({ text: '', source: 'manual' }); return true; }
    invalidate();
    const currentOperation = operation;
    if (commandId === 'system-translation-selection') {
      controller.setSource('', 'selection');
      wantsVisible = false;
      window?.hide();
      try {
        await deps.prepareSelection(source);
        if (currentOperation !== operation || disposed) return true;
        const text = await readCurrentTranslationSelection();
        if (currentOperation !== operation || disposed) return true;
        controller.setSource(text, 'selection');
        show();
        if (text.trim()) void controller.translate(text, controller.snapshot().target);
        else controller.fail('no-selection');
      } catch (error) {
        if (currentOperation === operation && !disposed) {
          controller.fail('no-selection', error instanceof Error ? error.message : String(error));
          show();
        }
      }
      return true;
    }
    controller.setSource('', 'screenshot', 'capturing');
    wantsVisible = false;
    window?.hide();
    const abort = new AbortController();
    captureController = abort;
    try {
      const result = await deps.captureAndRecognize({ signal: abort.signal });
      if (currentOperation !== operation || disposed || abort.signal.aborted) {
        if (result.status === 'ok') deps.releaseCapture(result.artifact.id);
        return true;
      }
      if (result.status === 'cancelled') { controller.cancel(); return true; }
      if (result.status === 'error') { controller.fail('capture-failed', result.message); show(); return true; }
      captureId = result.artifact.id;
      controller.setSource(result.text, 'screenshot');
      show();
      if (!result.text.trim()) controller.fail('no-text');
      else void controller.translate(result.text, controller.snapshot().target);
    } catch (error) {
      if (currentOperation === operation && !disposed && !abort.signal.aborted) {
        controller.fail('capture-failed', error instanceof Error ? error.message : String(error));
        show();
      }
    } finally {
      if (captureController === abort) captureController = null;
    }
    return true;
  }

  function handle(channel: string, action: (...args: any[]) => any) {
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args) => {
      if (!window || window.isDestroyed() || event.sender !== window.webContents) throw new Error('Invalid translation window');
      return action(...args);
    });
  }
  handle('translation:get-state', () => controller.snapshot());
  handle('translation:translate', (text: unknown, target: TranslationTarget) => {
    if (typeof text !== 'string' || !['zh-Hans', 'en'].includes(target)) throw new Error('Invalid translation request');
    void controller.translate(text, target);
  });
  handle('translation:cancel', () => {
    operation += 1;
    captureController?.abort();
    controller.cancel();
  });
  handle('translation:close', () => { window?.close(); });
  handle('translation:copy', () => {
    const text = controller.snapshot().result;
    if (text) clipboard.writeText(text);
  });
  handle('translation:open-settings', () => deps.openAISettings());

  return {
    executeCommand, openTranslation,
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      window?.destroy();
      window = null;
      for (const channel of channels) ipcMain.removeHandler(channel);
    },
  };
}
