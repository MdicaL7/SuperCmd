import { execFile } from 'child_process';
import { getNativeBinaryPath } from './native-binary';

/** Only the current AX selection: never synthesizes Copy or falls back to history. */
export async function readCurrentTranslationSelection(): Promise<string> {
  return new Promise((resolve) => {
    execFile(getNativeBinaryPath('translation-selected-text'), [], { timeout: 1500, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? '' : String(stdout || ''));
    });
  });
}
