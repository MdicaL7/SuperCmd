// Import before other application modules: some stores resolve userData on import.
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

const requested = process.env.SUPERCMD_DEV_USER_DATA;
if (requested && !app.isPackaged) {
  if (!path.isAbsolute(requested)) throw new Error('SUPERCMD_DEV_USER_DATA must be an absolute path');
  fs.mkdirSync(requested, { recursive: true });
  app.setPath('userData', requested);
}

export const isIsolatedDevProfile = Boolean(requested && !app.isPackaged);
