const { basename, dirname, isAbsolute, join } = require('node:path');
const { createRequire } = require('node:module');

/** Build-time only: use electron-builder's existing PE/NSIS reader instead of
 * running its temporary BUILD_UNINSTALLER stub on a restricted Windows host.
 * NsisTarget still signs the extracted uninstaller and verifies the final build.
 */
function wrapUninstallerExec(originalExec, readUninstaller, platform = process.platform) {
  return function exec(file, args, options, ...rest) {
    if (platform === 'win32' && typeof file === 'string' && isAbsolute(file) &&
        /\.exe$/i.test(file) && Array.isArray(args) && args.length === 0 &&
        options?.env?.__COMPAT_LAYER === 'RunAsInvoker') {
      const uninstaller = join(dirname(file), `${basename(file, 'exe')}__uninstaller.exe`);
      return readUninstaller(file, uninstaller);
    }
    return originalExec.call(this, file, args, options, ...rest);
  };
}
module.exports = { wrapUninstallerExec };

if (process.platform === 'win32' && process.env.SYNC_THINK_NSIS_READONLY_UNINSTALLER === '1') {
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const { WineVmManager } = builderRequire('app-builder-lib/out/vm/WineVm.js');
  const { UninstallerReader } = builderRequire('app-builder-lib/out/targets/nsis/nsisUtil.js');
  WineVmManager.prototype.exec = wrapUninstallerExec(
    WineVmManager.prototype.exec,
    (file, output) => UninstallerReader.exec(file, output),
  );
}
