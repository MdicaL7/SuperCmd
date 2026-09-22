import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { CaptureArtifact } from '../shared/screenshot';

/** Owns only files created in its private session directory; never user exports. */
export class ScreenshotStore {
  private items = new Map<string, { artifact: CaptureArtifact; filePath: string; references: number }>();
  constructor(readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  createPath(): string { return path.join(this.directory, `${randomUUID()}.png`); }
  add(filePath: string, image: Omit<CaptureArtifact, 'id'>): CaptureArtifact {
    if (path.dirname(filePath) !== this.directory || !fs.statSync(filePath).isFile()) {
      throw new Error('Invalid screenshot artifact');
    }
    const artifact = { ...image, id: randomUUID() };
    this.items.set(artifact.id, { artifact, filePath, references: 1 });
    return artifact;
  }
  get(id: string): { artifact: CaptureArtifact; filePath: string } | undefined { return this.items.get(id); }
  hasPath(filePath: string): boolean { return [...this.items.values()].some(item => item.filePath === filePath); }
  retain(id: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.references += 1;
    return true;
  }
  release(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    item.references -= 1;
    if (item.references > 0) return;
    this.items.delete(id);
    fs.rmSync(item.filePath, { force: true });
  }
  dispose(): void {
    this.items.clear();
    fs.rmSync(this.directory, { recursive: true, force: true });
  }
}
