// dev:desktop launcher. Ensures the Electron binary exists before starting.
// If the binary is missing (likely because VS Build Tools aren't installed),
// emits an actionable message and exits with code 2 (NOT a crash).

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const desktopDir = join(rootDir, 'apps', 'desktop');
const desktopRequire = createRequire(join(desktopDir, 'package.json'));

let electronPath = null;
try {
  electronPath = desktopRequire('electron');
} catch {
  electronPath = null;
}

if (!electronPath || !existsSync(electronPath)) {
  console.error(
    '\n[dev:desktop] Electron binary is not available on this machine.\n' +
      'Most likely cause: Visual Studio C++ Build Tools are not installed, so the\n' +
      'electron native download step was skipped by pnpm.\n' +
      '\nFix:\n' +
      '  1) Install Visual Studio Build Tools with "Desktop development with C++" workload.\n' +
      '  2) Run: pnpm approve-builds (or rely on the allowed list) and pnpm rebuild electron better-sqlite3 esbuild\n' +
      '  3) Retry: pnpm dev:desktop\n',
  );
  process.exit(2);
}

import { spawn } from 'node:child_process';
const desktopMain = join(desktopDir, 'dist', 'main', 'index.js');
const desktopPreload = join(desktopDir, 'dist', 'preload', 'index.cjs');
// The shell renderer is the only production renderer. Keep this check aligned
// with build-shell.mjs so a stale legacy dist/renderer cannot bypass a rebuild.
const rendererHtml = join(desktopDir, 'dist', 'renderer-shell', 'index.html');
if (!existsSync(desktopMain) || !existsSync(desktopPreload) || !existsSync(rendererHtml)) {
  console.log('[dev:desktop] build outputs missing; running desktop build first...');
  execFileSync('pnpm', ['--filter', '@sync-think/desktop', 'build'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const developmentRenderer = process.argv.includes('--renderer-development');
if (developmentRenderer && !process.env.VITE_DEV_SERVER_URL) {
  execFileSync(process.execPath, ['scripts/build-shell.mjs', '--mode', 'development'], {
    cwd: desktopDir,
    stdio: 'inherit',
  });
}

// Development builds deliberately skip the bundled feed sidecar: `readBundledUpdateFeed`
// in src/main/index.ts starts with `if (!app.isPackaged) return null`. Without a feed URL
// the updater reports itself as unconfigured, so 「设置 → 关于 → 检查更新」 sits permanently
// disabled and the check → download → install path can never be exercised locally. Point
// dev at the published feed and open the dev gate (desktop-updater.ts requires
// SYNC_THINK_UPDATE_ALLOW_DEV=1 whenever !isPackaged) so the button does real work.
//
// Both stay overridable: export either variable yourself to use a different feed, or set
// SYNC_THINK_UPDATE_FEED_URL to an empty string to put the channel back to "unconfigured".
const DEV_UPDATE_FEED_URL = 'https://sync-think.online/updates';

// Dev must not share Chromium's userData directory with an installed build.
// Both ship `name: "@sync-think/desktop"`, so both default to
// %APPDATA%\@sync-think\desktop and the installed app's `lockfile` wins: the dev
// instance still starts, but Chromium cannot take the profile over and dies with
//     Unable to move the cache: 拒绝访问 (0x5)
//     Gpu Cache Creation failed: -2
//     renderer failed to load ERR_FAILED (-2)
// which reads like a broken build and is not one. A per-checkout directory keeps
// the two side by side. Override SYNC_THINK_DEV_USER_DATA_DIR to move it.
const devUserDataDir =
  process.env.SYNC_THINK_DEV_USER_DATA_DIR ?? join(rootDir, '.data', 'desktop-userdata-dev');
mkdirSync(devUserDataDir, { recursive: true });

const child = spawn(electronPath, ['.', `--user-data-dir=${devUserDataDir}`], {
  cwd: desktopDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    SYNC_THINK_INSTALL_ID: process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001',
    SYNC_THINK_DEV_NO_TOKEN: process.env.SYNC_THINK_DEV_NO_TOKEN ?? '1',
    VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL,
    SYNC_THINK_RENDERER_MODE: developmentRenderer ? 'development' : 'production',
    SYNC_THINK_UPDATE_FEED_URL: process.env.SYNC_THINK_UPDATE_FEED_URL ?? DEV_UPDATE_FEED_URL,
    SYNC_THINK_UPDATE_ALLOW_DEV: process.env.SYNC_THINK_UPDATE_ALLOW_DEV ?? '1',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
