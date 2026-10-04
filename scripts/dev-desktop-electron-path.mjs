import { readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

function isFile(path) {
  if (!path) return false;
  try { return statSync(path).isFile(); } catch { return false; }
}

/** Reuse complete, same-version local development runtimes without changing ACLs. */
export function resolveDevDesktopElectron({
  packagePath,
  electronVersion,
  env = process.env,
  platform = process.platform,
}) {
  const override = env.SYNC_THINK_DEV_ELECTRON_PATH?.trim();
  if (override) {
    if (!isAbsolute(override) || !isFile(override)) {
      throw new Error('SYNC_THINK_DEV_ELECTRON_PATH must name an existing absolute executable path');
    }
    return { path: override, source: 'override' };
  }
  if (platform === 'win32' && env.LOCALAPPDATA && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(electronVersion ?? '')) {
    const root = join(env.LOCALAPPDATA, 'SYNC-THINK', 'dev-runtime');
    let entries = [];
    try { entries = readdirSync(root, { withFileTypes: true }); } catch { /* No local runtime yet. */ }
    const prefix = `electron-${electronVersion}-`;
    const candidates = entries.filter(entry => entry.isDirectory() && entry.name.startsWith(prefix) &&
      /^\d{8}(?:-[\w.-]+)?$/.test(entry.name.slice(prefix.length)))
      .map(entry => entry.name).sort().reverse();
    for (const name of candidates) {
      const directory = join(root, name);
      // Partial copies are not usable runtimes. Leave Electron's sandbox enabled.
      if (['electron.exe', 'icudtl.dat', 'v8_context_snapshot.bin', 'resources/default_app.asar']
        .every(file => isFile(join(directory, file)))) {
        return { path: join(directory, 'electron.exe'), source: 'local-cache' };
      }
    }
  }
  return isFile(packagePath) ? { path: packagePath, source: 'package' } : undefined;
}
