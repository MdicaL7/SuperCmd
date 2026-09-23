import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { FileShelfAPI, FileShelfSnapshot } from '../../shared/file-shelf';

const api: FileShelfAPI = {
  getState: () => ipcRenderer.invoke('file-shelf:get-state'),
  addFiles: (files) => {
    try {
      const paths = Array.from(files, (file) => {
        try {
          return webUtils.getPathForFile(file) || (file as any).path || '';
        } catch {
          return (file as any).path || '';
        }
      }).filter((p): p is string => Boolean(p && typeof p === 'string'));
      if (!paths.length) {
        return Promise.resolve({ ok: false, error: 'Drop files or folders from Finder.' });
      }
      return ipcRenderer.invoke('file-shelf:add', paths);
    } catch {
      return Promise.resolve({ ok: false, error: 'These items are not files from this computer.' });
    }
  },
  chooseFiles: (kind) => ipcRenderer.invoke('file-shelf:choose', kind),
  remove: (ids) => ipcRenderer.invoke('file-shelf:remove', ids),
  clear: () => ipcRenderer.invoke('file-shelf:clear'),
  copy: (ids) => ipcRenderer.invoke('file-shelf:copy', ids),
  startDrag: (ids) => ipcRenderer.send('file-shelf:drag', ids),
  reveal: (id) => ipcRenderer.invoke('file-shelf:reveal', id),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('file-shelf:set-always-on-top', value),
  setShakeToActivate: (value) => ipcRenderer.invoke('file-shelf:set-shake-to-activate', value),
  showContextMenu: (id) => ipcRenderer.invoke('file-shelf:show-context-menu', id),
  cancelTarget: () => ipcRenderer.invoke('file-shelf:cancel-target'),
  hide: () => ipcRenderer.invoke('file-shelf:hide'),
  onChanged: (callback) => {
    const listener = (_event: unknown, snapshot: FileShelfSnapshot) => callback(snapshot);
    ipcRenderer.on('file-shelf:changed', listener);
    return () => ipcRenderer.removeListener('file-shelf:changed', listener);
  },
  onError: (callback) => {
    const listener = (_event: unknown, message: string) => callback(message);
    ipcRenderer.on('file-shelf:error', listener);
    return () => ipcRenderer.removeListener('file-shelf:error', listener);
  },
};

contextBridge.exposeInMainWorld('fileShelf', api);

// The shared renderer root's I18nProvider needs these read-only settings APIs.
// Keep this file shelf window isolated from the launcher's extension/runtime bridge.
contextBridge.exposeInMainWorld('electron', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  onSettingsUpdated: (callback: (settings: unknown) => void) => {
    const listener = (_event: unknown, settings: unknown) => callback(settings);
    ipcRenderer.on('settings-updated', listener);
    return () => ipcRenderer.removeListener('settings-updated', listener);
  },
});
