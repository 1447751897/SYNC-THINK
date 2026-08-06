// Builds the NEW shell renderer (2026-07-22 rewrite): esbuild bundle + Tailwind v4 CSS.
// Output lands in dist/renderer-shell; the legacy renderer keeps dist/renderer
// until the shell reaches feature parity and the switchover removes it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const shellSrc = join(desktopRoot, 'src', 'renderer', 'shell');
const outdir = join(desktopRoot, 'dist', 'renderer-shell');

mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [join(shellSrc, 'shell-entry.tsx')],
  outfile: join(outdir, 'shell.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.png': 'dataurl', '.svg': 'dataurl' },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
});

// Keep xterm out of the first-viewport shell bundle. TerminalPane injects this
// script and its generated CSS only when a terminal tab is mounted.
await esbuild.build({
  entryPoints: [join(shellSrc, 'xterm-vendor.ts')],
  outfile: join(outdir, 'xterm-vendor.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  loader: { '.ts': 'ts', '.css': 'css' },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
});

// Mermaid is ~hundreds of KB; keep it out of the first-viewport shell bundle too.
// MermaidChart mounts the vendor script lazily via mermaid-vendor-loader.
await esbuild.build({
  entryPoints: [join(shellSrc, 'mermaid-vendor.ts')],
  outfile: join(outdir, 'mermaid-vendor.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  loader: { '.ts': 'ts' },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
});

// Tailwind v4 CLI scans the shell sources referenced from shell.css.
const require = createRequire(import.meta.url);
const cliPkgJson = require.resolve('@tailwindcss/cli/package.json');
const cliPkg = require(cliPkgJson);
const tailwindCli = join(dirname(cliPkgJson), cliPkg.bin?.tailwindcss ?? cliPkg.bin);
execFileSync(process.execPath, [
  tailwindCli,
  '-i', join(shellSrc, 'shell.css'),
  '-o', join(outdir, 'shell.css'),
  '--cwd', shellSrc,
], { stdio: 'inherit' });

copyFileSync(join(shellSrc, 'index.html'), join(outdir, 'index.html'));
console.log(`[desktop] shell renderer built at ${outdir}`);
