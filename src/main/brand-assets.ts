import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import {
  WUDI_ASSETS_DIR,
  WUDI_APP_ICON_CANDIDATES,
  WUDI_MENU_BAR_ICON_CANDIDATES,
} from '../shared/brand';

function getSearchBases(): string[] {
  const bases = [
    process.cwd(),
    app?.getAppPath ? app.getAppPath() : '',
    process.resourcesPath || '',
    path.join(__dirname, '..', '..'),
  ].filter(Boolean);

  const unique: string[] = [];
  for (const b of bases) {
    if (!unique.includes(b)) unique.push(b);
  }
  return unique;
}

/**
 * Resolve WUDI Menu Bar / Tray icon path.
 * Checks assets/wudi/ first, then falls back with a TODO warning.
 */
export function resolveMenuBarIconPath(): string | null {
  const bases = getSearchBases();

  // 1. Check user-provided candidates in assets/wudi/
  for (const base of bases) {
    for (const filename of WUDI_MENU_BAR_ICON_CANDIDATES) {
      const candidate = path.join(base, WUDI_ASSETS_DIR, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  // 2. Development fallback with warning
  const fallbacks = [
    'supercmd.svg',
    'supercmd.png',
    'supercmd.icns',
    'icon.png',
    'icon.icns',
  ];

  for (const base of bases) {
    for (const fb of fallbacks) {
      const candidate = path.join(base, fb);
      if (fs.existsSync(candidate)) {
        console.warn(`[Brand] Using fallback tray icon: ${candidate}. TODO: Replace with WUDI icon.`);
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Resolve WUDI App Icon path.
 * Checks assets/wudi/ first, then falls back with a TODO warning.
 */
export function resolveAppIconPath(): string | null {
  const bases = getSearchBases();

  // 1. Check user-provided candidates in assets/wudi/
  for (const base of bases) {
    for (const filename of WUDI_APP_ICON_CANDIDATES) {
      const candidate = path.join(base, WUDI_ASSETS_DIR, filename);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  // 2. Development fallback with warning
  const fallbacks = [
    'supercmd.png',
    'supercmd.icns',
    'supercmd.svg',
    'icon.png',
  ];

  for (const base of bases) {
    for (const fb of fallbacks) {
      const candidate = path.join(base, fb);
      if (fs.existsSync(candidate)) {
        console.warn(`[Brand] Using fallback app icon: ${candidate}. TODO: Replace with WUDI icon.`);
        return candidate;
      }
    }
  }

  return null;
}
