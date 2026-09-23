import * as path from 'path';
import * as fs from 'fs';

export function parseGithubRepository(input: string): { owner: string; repo: string } | null {
  const value = String(input || '').trim();
  if (!value) return null;
  const direct = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(value);
  if (direct) {
    return { owner: direct[1], repo: direct[2] };
  }
  const match = /github\.com[/:]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/|$)/i.exec(value);
  if (!match) return null;
  return {
    owner: match[1],
    repo: match[2],
  };
}

export function readAppPackageJson(customPaths?: string[]): Record<string, any> | null {
  const candidatePaths = customPaths && customPaths.length > 0 ? customPaths : [
    path.join(process.cwd(), 'package.json'),
  ];

  for (const filePath of candidatePaths) {
    try {
      if (!fs.existsSync(filePath)) continue;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {}
  }

  return null;
}

export const APP_UPDATES_ENABLED = false;
export const UPDATE_PROVIDER = 'github' as const;
export const UPDATE_OWNER = 'MdicaL7';
export const UPDATE_REPO = 'WUDI';

export function resolveAppUpdaterFeedConfig(
  pkgInput?: Record<string, any> | null,
  customPaths?: string[],
  overrideUpdatesEnabled?: boolean
): Record<string, any> | null {
  const updatesEnabled = overrideUpdatesEnabled ?? APP_UPDATES_ENABLED;
  if (!updatesEnabled) {
    return null;
  }

  const pkg = pkgInput || readAppPackageJson(customPaths);
  if (!pkg || typeof pkg !== 'object') return null;

  const publishFromRoot = Array.isArray((pkg as any).publish) ? (pkg as any).publish[0] : (pkg as any).publish;
  const publishFromBuild = Array.isArray((pkg as any).build?.publish) ? (pkg as any).build?.publish[0] : (pkg as any).build?.publish;
  const publish = (publishFromRoot && typeof publishFromRoot === 'object')
    ? publishFromRoot
    : (publishFromBuild && typeof publishFromBuild === 'object' ? publishFromBuild : null);
  if (!publish) return null;

  const provider = String((publish as any).provider || '').trim().toLowerCase();
  if (provider !== 'github') {
    return publish;
  }

  const repositoryRaw = typeof (pkg as any).repository === 'string'
    ? (pkg as any).repository
    : String((pkg as any).repository?.url || '');
  const parsedRepo = parseGithubRepository(repositoryRaw);
  const owner = String((publish as any).owner || parsedRepo?.owner || UPDATE_OWNER).trim();
  const repo = String((publish as any).repo || parsedRepo?.repo || UPDATE_REPO).trim();
  if (!owner || !repo) {
    return null;
  }

  // Strict guard: Never allow SuperCmdLabs or legacy SuperCmd as update source
  if (owner.toLowerCase() === 'supercmdlabs' || repo.toLowerCase() === 'supercmd') {
    console.error('[Updater] Rejected legacy SuperCmd / SuperCmdLabs feed configuration.');
    return null;
  }

  return {
    ...publish,
    provider: 'github',
    owner,
    repo,
  };
}
