import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const outdir = join(desktopRoot, 'dist', 'renderer');

mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [join(desktopRoot, 'src', 'renderer', 'index.tsx')],
  outfile: join(outdir, 'index.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  sourcemap: true,
  jsx: 'automatic',
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.css': 'css',
    '.png': 'dataurl',
    '.svg': 'dataurl',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
});

const sourceHtml = readFileSync(join(desktopRoot, 'src', 'renderer', 'index.html'), 'utf8');
const html = sourceHtml
  .replace('<link rel="stylesheet" href="./renderer.css" />', '<link rel="stylesheet" href="./index.css" />')
  .replace('<script type="module" src="./index.tsx"></script>', '<script src="./index.js"></script>');

writeFileSync(join(outdir, 'index.html'), html);
console.log(`[desktop] renderer assets built at ${outdir}`);
