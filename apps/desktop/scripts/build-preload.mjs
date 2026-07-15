import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const outfile = join(desktopRoot, 'dist', 'preload', 'index.cjs');

mkdirSync(dirname(outfile), { recursive: true });
await esbuild.build({
  entryPoints: [join(desktopRoot, 'src', 'preload', 'index.ts')],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  external: ['electron'],
});

console.log(`[desktop] sandbox preload built at ${outfile}`);
