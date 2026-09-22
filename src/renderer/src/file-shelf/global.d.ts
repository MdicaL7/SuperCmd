import type { FileShelfAPI } from '../../../shared/file-shelf';

declare global {
  interface Window { fileShelf: FileShelfAPI; }
}

export {};
