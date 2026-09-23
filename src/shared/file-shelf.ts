export interface FileShelfEntry {
  id: string;
  path: string;
  name: string;
  kind: 'file' | 'directory';
  addedAt: number;
}

export interface FileShelfItem extends FileShelfEntry {
  available: boolean;
  unavailableReason?: 'missing' | 'unreadable';
  iconDataUrl?: string;
}

export interface FileShelfBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FileShelfMode = 'target' | 'shelf';

export interface FileShelfSnapshot {
  items: FileShelfItem[];
  alwaysOnTop: boolean;
  mode: FileShelfMode;
  shakeToActivate?: boolean;
  error?: string;
}

export interface FileShelfResult {
  ok: boolean;
  error?: string;
  added?: number;
  duplicates?: number;
  skipped?: Array<{ path: string; reason: string }>;
  cancelled?: boolean;
}

export interface FileShelfAPI {
  getState(): Promise<FileShelfSnapshot>;
  addFiles(files: File[]): Promise<FileShelfResult>;
  chooseFiles(kind: 'files' | 'folders'): Promise<FileShelfResult>;
  remove(ids: string[]): Promise<FileShelfResult>;
  clear(): Promise<FileShelfResult>;
  copy(ids: string[]): Promise<FileShelfResult>;
  startDrag(ids: string[]): void;
  reveal(id: string): Promise<FileShelfResult>;
  setAlwaysOnTop(value: boolean): Promise<FileShelfResult>;
  setShakeToActivate(value: boolean): Promise<FileShelfResult>;
  showContextMenu(id?: string): Promise<void>;
  cancelTarget(): Promise<void>;
  hide(): Promise<void>;
  onChanged(callback: (snapshot: FileShelfSnapshot) => void): () => void;
  onError(callback: (message: string) => void): () => void;
}
