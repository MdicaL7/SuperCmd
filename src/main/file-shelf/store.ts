import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { FileShelfBounds, FileShelfEntry, FileShelfItem, FileShelfResult } from '../../shared/file-shelf';

interface ShelfDocument {
  version: 1;
  items: FileShelfEntry[];
  alwaysOnTop: boolean;
  bounds?: FileShelfBounds;
  shakeToActivate?: boolean;
}

const emptyDocument = (): ShelfDocument => ({ version: 1, items: [], alwaysOnTop: true, shakeToActivate: true });

function isBounds(value: unknown): value is FileShelfBounds {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as FileShelfBounds;
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    && bounds.width >= 100 && bounds.height >= 100;
}

export async function writeShelfDocument(filePath: string, document: ShelfDocument): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.promises.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(document, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temporary, filePath);
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
}

/** References only: this class never copies, moves or removes a user's file. */
export class FileShelfStore {
  private document: ShelfDocument = emptyDocument();
  private queue: Promise<unknown> = Promise.resolve();
  private loadError?: string;

  constructor(
    private readonly filePath: string,
    private readonly persist: typeof writeShelfDocument = writeShelfDocument,
  ) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ShelfDocument;
      if (parsed.version !== 1 || !Array.isArray(parsed.items) || typeof parsed.alwaysOnTop !== 'boolean') {
        throw new Error('Unsupported file shelf data');
      }
      const paths = new Set<string>();
      const ids = new Set<string>();
      for (const entry of parsed.items) {
        if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)
          || typeof entry.path !== 'string' || !path.isAbsolute(entry.path) || entry.path.includes('\0')
          || typeof entry.name !== 'string' || !Number.isFinite(entry.addedAt)
          || !['file', 'directory'].includes(entry.kind)) throw new Error('Invalid file shelf item');
        const normalized = path.normalize(entry.path);
        if (paths.has(normalized)) throw new Error('Duplicate file shelf path');
        paths.add(normalized);
        ids.add(entry.id);
      }
      this.document = {
        version: 1,
        items: parsed.items.map((entry) => ({ ...entry, path: path.normalize(entry.path) })),
        alwaysOnTop: parsed.alwaysOnTop,
        shakeToActivate: typeof parsed.shakeToActivate === 'boolean' ? parsed.shakeToActivate : true,
        ...(isBounds(parsed.bounds) ? { bounds: parsed.bounds } : {}),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Preserve corrupt/newer data rather than silently replacing it with an empty shelf.
        this.loadError = 'The saved file shelf could not be read. Its data has been preserved.';
      }
    }
  }

  get error(): string | undefined { return this.loadError; }
  get alwaysOnTop(): boolean { return this.document.alwaysOnTop; }
  get shakeToActivate(): boolean { return this.document.shakeToActivate ?? true; }
  get bounds(): FileShelfBounds | undefined { return this.document.bounds ? { ...this.document.bounds } : undefined; }
  get entries(): FileShelfEntry[] { return this.document.items.map((entry) => ({ ...entry })); }
  async flush(): Promise<void> { await this.queue; }

  getItems(): FileShelfItem[] {
    return this.entries.map((entry) => {
      try {
        const stat = fs.statSync(entry.path);
        fs.accessSync(entry.path, fs.constants.R_OK);
        if (!stat.isFile() && !stat.isDirectory()) throw new Error('Unsupported file type');
        return { ...entry, kind: stat.isDirectory() ? 'directory' : 'file', available: true };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return { ...entry, available: false, unavailableReason: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable' };
      }
    });
  }

  /** Resolve registered IDs again immediately before clipboard/drag/reveal operations. */
  resolveAvailable(ids: unknown): FileShelfEntry[] {
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
      throw new Error('Select at least one file.');
    }
    const uniqueIds = [...new Set(ids as string[])];
    const items = new Map(this.getItems().map((item) => [item.id, item]));
    return uniqueIds.map((id) => {
      const item = items.get(id);
      if (!item) throw new Error('This item is no longer in the file shelf.');
      if (!item.available) throw new Error(`Source file unavailable: ${item.name}`);
      return item;
    });
  }

  private mutate<T>(operation: (document: ShelfDocument) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (this.loadError) throw new Error(this.loadError);
      const draft: ShelfDocument = { ...this.document, items: this.entries };
      const result = await operation(draft);
      // Update memory only after a durable write succeeds.
      await this.persist(this.filePath, draft);
      this.document = draft;
      return result;
    });
    this.queue = next.catch(() => {});
    return next;
  }

  addPaths(value: unknown): Promise<FileShelfResult> {
    return this.mutate(async (draft) => {
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('Invalid file selection.');
      const paths = new Set(draft.items.map((item) => item.path));
      const skipped: NonNullable<FileShelfResult['skipped']> = [];
      let added = 0;
      let duplicates = 0;
      for (const candidate of value as string[]) {
        if (!path.isAbsolute(candidate) || candidate.includes('\0')) {
          skipped.push({ path: candidate, reason: 'Choose a file or folder from this computer.' });
          continue;
        }
        const normalized = path.normalize(candidate);
        if (paths.has(normalized)) { duplicates++; continue; }
        try {
          const stat = await fs.promises.stat(normalized);
          await fs.promises.access(normalized, fs.constants.R_OK);
          if (!stat.isFile() && !stat.isDirectory()) throw new Error('Unsupported file type');
          draft.items.push({ id: randomUUID(), path: normalized, name: path.basename(normalized) || normalized, kind: stat.isDirectory() ? 'directory' : 'file', addedAt: Date.now() });
          paths.add(normalized);
          added++;
        } catch {
          skipped.push({ path: normalized, reason: 'The source is unavailable or cannot be read.' });
        }
      }
      return { ok: true, added, duplicates, skipped };
    });
  }

  remove(ids: unknown): Promise<void> {
    return this.mutate(async (draft) => {
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('Invalid file selection.');
      const selected = new Set(ids);
      draft.items = draft.items.filter((entry) => !selected.has(entry.id));
    });
  }

  clear(): Promise<void> { return this.mutate(async (draft) => { draft.items = []; }); }
  setAlwaysOnTop(value: boolean): Promise<void> { return this.mutate(async (draft) => { draft.alwaysOnTop = value; }); }
  setShakeToActivate(value: boolean): Promise<void> { return this.mutate(async (draft) => { draft.shakeToActivate = value; }); }
  saveBounds(bounds: FileShelfBounds): Promise<void> {
    return this.mutate(async (draft) => {
      if (!isBounds(bounds)) throw new Error('Invalid window bounds.');
      draft.bounds = { ...bounds };
    });
  }
}
