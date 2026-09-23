import { notarize } from 'electron-builder-notarize';

export default async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword) {
    console.log('[Notarize] Apple credentials NOT CONFIGURED (APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD missing). Skipping notarization.');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appBundleId = context.packager.appInfo.appId || 'com.mdical7.wudi';

  console.log(`[Notarize] Notarizing ${appName} (${appBundleId})...`);
  await notarize({
    appBundleId,
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    ...(teamId ? { teamId } : {}),
  });
  console.log(`[Notarize] Notarization completed for ${appName}.`);
}