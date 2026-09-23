import { notarize } from 'electron-builder-notarize';

export default async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  const appBundleId = context.packager.appInfo.appId || 'com.mdical7.wudi';

  await notarize({
    appBundleId,
    appPath: `${appOutDir}/${appName}.app`,
    appleId: '',
    appleIdPassword: '',
  });
}