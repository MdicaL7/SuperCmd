// Import before other application modules: some stores resolve userData on import.
import * as path from 'path';
import * as fs from 'fs';

function getElectronApp(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('electron').app;
  } catch {
    return undefined;
  }
}

const app = getElectronApp();
const requested = process.env.WUDI_DEV_USER_DATA || process.env.SUPERCMD_DEV_USER_DATA;
if (requested && app && !app.isPackaged) {
  if (!path.isAbsolute(requested)) throw new Error('WUDI_DEV_USER_DATA / SUPERCMD_DEV_USER_DATA must be an absolute path');
  fs.mkdirSync(requested, { recursive: true });
  app.setPath('userData', requested);
}

export const isIsolatedDevProfile = Boolean(requested && app && !app.isPackaged);
