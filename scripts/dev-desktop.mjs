// dev:desktop launcher. Ensures the Electron binary exists before starting.
// If the binary is missing (likely because VS Build Tools aren't installed),
// emits an actionable message and exits with code 2 (NOT a crash).

import { existsSync } from 'node:fs';
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

const child = spawn(electronPath, ['.'], {
  cwd: desktopDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    SYNC_THINK_INSTALL_ID: process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001',
    SYNC_THINK_DEV_NO_TOKEN: process.env.SYNC_THINK_DEV_NO_TOKEN ?? '1',
    VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL,
    SYNC_THINK_RENDERER_MODE: developmentRenderer ? 'development' : 'production',
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
