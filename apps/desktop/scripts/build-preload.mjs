import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');

/** Main-window preload plus the interactive-preview guest preload. The guest
 *  preload is attached by will-attach-webview (see apps/desktop/src/main/index.ts)
 *  only for webviews whose partition carries the visualization prefix. */
const entries = [
  ['index.ts', 'index.cjs'],
  ['visualization.ts', 'visualization.cjs'],
];

for (const [entry, outputName] of entries) {
  const outfile = join(desktopRoot, 'dist', 'preload', outputName);
  mkdirSync(dirname(outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [join(desktopRoot, 'src', 'preload', entry)],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    external: ['electron'],
  });
  console.log(`[desktop] sandbox preload built at ${outfile}`);
}
