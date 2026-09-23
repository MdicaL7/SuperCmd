/**
 * User Data Migration: SuperCmd -> WUDI
 *
 * Automatically and non-destructively copies existing user data (settings,
 * extensions, notes, canvas, clipboard history, snippets, etc.) from
 * legacy SuperCmd userData directory to WUDI userData directory on first run.
 *
 * Guarantees:
 * 1. Strictly one-time and idempotent (persists marker file .wudi-migrated-from-supercmd-v1).
 * 2. Non-destructive: source files are NEVER deleted, moved, or altered.
 * 3. Never overwrites existing target data if WUDI already has configured data.
 * 4. Skips migration in isolated dev profile environments.
 * 5. Safe: catches and logs errors without disrupting app boot.
 */

import * as path from 'path';
import * as fs from 'fs';
import { isIsolatedDevProfile } from './dev-profile';

function getElectronApp(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('electron').app;
  } catch {
    return undefined;
  }
}

export const USER_DATA_MIGRATION_MARKER = '.wudi-migrated-from-supercmd-v1';

export const MIGRATION_FILES = [
  'settings.json',
  'settings.local.json',
  'location.json',
  'window-state.json',
  'notes-window-state.json',
  'safe-storage.json',
  'oauth-tokens.json',
  'extension-preferences.json',
  'extension-catalog.json',
  'ai-chat-conversations.json',
  'local-memories.json',
  'canvas-library.json',
] as const;

export const MIGRATION_DIRS = [
  'notes',
  'canvas',
  'canvas-lib',
  'quicklinks',
  'snippets',
  'extensions',
  'extension-support',
  'clipboard-history',
  'script-commands',
  'browser-search',
  'browser-root',
  'file-shelf',
  'whispercpp',
  'bun',
] as const;

export interface MigrationResult {
  migrated: boolean;
  reason?: 'dev_profile' | 'already_migrated' | 'no_source_dir' | 'same_dir' | 'success' | 'error';
  migratedFiles: string[];
  migratedDirs: string[];
  errors: Array<{ item: string; error: string }>;
}

export interface MigrationOptions {
  sourceDir?: string;
  targetDir?: string;
  isDevProfile?: boolean;
}

/**
 * Recursively copies items from src to dst only if the item does not already exist in dst.
 */
function copyMissingRecursive(src: string, dst: string, errors: Array<{ item: string; error: string }>): void {
  try {
    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcChild = path.join(src, entry.name);
      const dstChild = path.join(dst, entry.name);
      try {
        if (entry.isDirectory()) {
          copyMissingRecursive(srcChild, dstChild, errors);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          if (!fs.existsSync(dstChild)) {
            fs.copyFileSync(srcChild, dstChild);
          }
        }
      } catch (err: any) {
        errors.push({ item: srcChild, error: err?.message || String(err) });
      }
    }
  } catch (err: any) {
    errors.push({ item: src, error: err?.message || String(err) });
  }
}

/**
 * Performs one-time migration of user data from SuperCmd to WUDI.
 */
export function maybeMigrateUserDataFromSuperCmd(options?: MigrationOptions): MigrationResult {
  const result: MigrationResult = {
    migrated: false,
    migratedFiles: [],
    migratedDirs: [],
    errors: [],
  };

  try {
    const devProfileActive = options?.isDevProfile ?? isIsolatedDevProfile;
    if (devProfileActive) {
      result.reason = 'dev_profile';
      console.log('[UserDataMigration] Skipped: isolated dev profile active');
      return result;
    }

    const app = getElectronApp();
    const targetDir = options?.targetDir || (app?.getPath ? app.getPath('userData') : '');
    if (!targetDir) {
      result.reason = 'error';
      result.errors.push({ item: 'targetDir', error: 'Target userData directory could not be resolved' });
      return result;
    }

    const sourceDir = options?.sourceDir || path.join(path.dirname(targetDir), 'SuperCmd');

    if (path.resolve(sourceDir) === path.resolve(targetDir)) {
      result.reason = 'same_dir';
      return result;
    }

    const markerPath = path.join(targetDir, USER_DATA_MIGRATION_MARKER);
    if (fs.existsSync(markerPath)) {
      result.reason = 'already_migrated';
      return result;
    }

    if (!fs.existsSync(sourceDir)) {
      // Legacy data directory does not exist on this machine
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(
        markerPath,
        JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            status: 'skipped',
            reason: 'no_source_dir',
            sourceDir,
            targetDir,
          },
          null,
          2
        )
      );
      result.reason = 'no_source_dir';
      return result;
    }

    console.log(`[UserDataMigration] Migrating existing user data from "${sourceDir}" to "${targetDir}"...`);
    fs.mkdirSync(targetDir, { recursive: true });

    // 1. Migrate single files
    for (const fileName of MIGRATION_FILES) {
      const srcFile = path.join(sourceDir, fileName);
      const dstFile = path.join(targetDir, fileName);

      try {
        if (fs.existsSync(srcFile) && !fs.existsSync(dstFile)) {
          fs.mkdirSync(path.dirname(dstFile), { recursive: true });
          fs.copyFileSync(srcFile, dstFile);
          result.migratedFiles.push(fileName);
        }
      } catch (err: any) {
        result.errors.push({ item: fileName, error: err?.message || String(err) });
      }
    }

    // 2. Migrate directory hierarchies
    for (const dirName of MIGRATION_DIRS) {
      const srcSub = path.join(sourceDir, dirName);
      const dstSub = path.join(targetDir, dirName);

      try {
        if (fs.existsSync(srcSub)) {
          if (!fs.existsSync(dstSub)) {
            fs.cpSync(srcSub, dstSub, { recursive: true });
            result.migratedDirs.push(dirName);
          } else {
            // Target exists, non-destructively fill in missing items
            copyMissingRecursive(srcSub, dstSub, result.errors);
            result.migratedDirs.push(`${dirName} (merged)`);
          }
        }
      } catch (err: any) {
        result.errors.push({ item: dirName, error: err?.message || String(err) });
      }
    }

    // 3. Write migration marker file
    const markerRecord = {
      timestamp: new Date().toISOString(),
      status: 'migrated',
      sourceDir,
      targetDir,
      migratedFiles: result.migratedFiles,
      migratedDirs: result.migratedDirs,
      errors: result.errors,
    };

    fs.writeFileSync(markerPath, JSON.stringify(markerRecord, null, 2));

    result.migrated = true;
    result.reason = 'success';
    console.log(
      `[UserDataMigration] Completed successfully: ${result.migratedFiles.length} files, ${result.migratedDirs.length} directories migrated.`
    );
    return result;
  } catch (globalErr: any) {
    console.error('[UserDataMigration] Unexpected error during migration:', globalErr);
    result.reason = 'error';
    result.errors.push({ item: 'global', error: globalErr?.message || String(globalErr) });
    return result;
  }
}
