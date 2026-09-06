import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, copyFileSync, cpSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import {
  SHELL_BUDGET,
  assertGeneratedPath,
  assertShellBudget,
  removeGeneratedDirectory,
  shellBuildOptions,
  summarizeShellBuild,
} from './shell-build-config.mjs';

const require = createRequire(import.meta.url);
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const shellSrc = join(desktopRoot, 'src/renderer/shell');
const options = shellBuildOptions(process.argv.slice(2), desktopRoot);
const { mode, optimized, outdir, outputRoot } = options;
mkdirSync(dirname(outdir), { recursive: true });
const staging = mkdtempSync(outdir + '.build-');

try {
  const shared = {
    absWorkingDir: desktopRoot,
    bundle: true,
    platform: 'browser',
    minify: optimized,
    sourcemap: !optimized,
    target: 'chrome120',
    define: { 'process.env.NODE_ENV': JSON.stringify(optimized ? 'production' : 'development') },
    legalComments: 'external',
  };
  const shell = await esbuild.build({
    ...shared,
    entryPoints: { shell: join(shellSrc, mode === 'qa' ? 'qa-entry.tsx' : 'shell-entry.tsx') },
    outdir: staging,
    format: 'esm',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    metafile: true,
    jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'file' },
    assetNames: 'assets/[name]-[hash]',
  });
  const summary = summarizeShellBuild(shell.metafile, desktopRoot, staging);
  const chunkMap = Object.fromEntries(
    summary.files
      .filter((file) => file.entryPoint && !file.initial)
      .map((file) => [basename(file.entryPoint, '.tsx'), './' + file.path]),
  );
  const chunkBootstrap = `window.__syncThinkShellChunks=Object.freeze(${JSON.stringify(chunkMap)});\n`;
  writeFileSync(join(staging, 'shell-chunks.js'), chunkBootstrap);
  const bootstrapBytes = Buffer.byteLength(chunkBootstrap);
  const bootstrapGzipBytes = gzipSync(chunkBootstrap).byteLength;
  summary.files.push({
    path: 'shell-chunks.js',
    bytes: bootstrapBytes,
    gzipBytes: bootstrapGzipBytes,
    initial: true,
    imports: [],
  });
  summary.initialJsBytes += bootstrapBytes;
  summary.initialGzipBytes += bootstrapGzipBytes;
  summary.totalJsBytes += bootstrapBytes;
  if (mode === 'production') {
    assertShellBudget(summary);
    if (
      summary.inputs.some((input) =>
        /(?:Phase3VisualFixture|qa-entry|highlight\.js\/lib\/index)\./.test(input),
      )
    ) {
      throw new Error('shell.build.forbidden_production_input');
    }
  }

  for (const [entry, outfile] of [
    ['xterm-vendor.ts', 'xterm-vendor.js'],
    ['mermaid-vendor.ts', 'mermaid-vendor.js'],
    ['excalidraw-vendor.tsx', 'excalidraw-vendor.js'],
  ]) {
    await esbuild.build({
      ...shared,
      entryPoints: [join(shellSrc, entry)],
      outfile: join(staging, outfile),
      format: 'iife',
      conditions: ['production'],
      jsx: 'automatic',
      loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
    });
  }

  const excalidrawEntry = require.resolve('@excalidraw/excalidraw');
  copyFileSync(join(dirname(excalidrawEntry), 'index.css'), join(staging, 'excalidraw-vendor.css'));
  const cliPkgJson = require.resolve('@tailwindcss/cli/package.json');
  const cliPkg = require(cliPkgJson);
  const tailwindCli = join(dirname(cliPkgJson), cliPkg.bin?.tailwindcss ?? cliPkg.bin);
  execFileSync(
    process.execPath,
    [
      tailwindCli,
      '-i',
      join(shellSrc, 'shell.css'),
      '-o',
      join(staging, 'shell.css'),
      '--cwd',
      shellSrc,
      ...(optimized ? ['--minify'] : []),
    ],
    { stdio: 'inherit' },
  );
  copyFileSync(join(shellSrc, 'index.html'), join(staging, 'index.html'));
  cpSync(join(shellSrc, 'assets/fonts/files'), join(staging, 'files'), { recursive: true });
  writeFileSync(
    join(staging, 'build-manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        mode,
        shell: summary,
        budget: SHELL_BUDGET,
      },
      null,
      2,
    ) + '\n',
  );
  assertGeneratedPath(staging, outputRoot);
  removeGeneratedDirectory(outdir, outputRoot);
  renameSync(staging, outdir);
  console.log(
    `[desktop] ${mode} shell built at ${outdir}; initial JS ${summary.initialJsBytes} bytes, total JS ${summary.totalJsBytes} bytes`,
  );
} finally {
  removeGeneratedDirectory(staging, outputRoot);
}
