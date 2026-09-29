import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
await mkdir(join(root, 'assets'), { recursive: true });
await build({
  entryPoints: [join(root, 'src/main.tsx')],
  outfile: join(root, 'assets/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  minify: false,
  sourcemap: true,
  nodePaths: [join(repo, 'apps/desktop/node_modules')],
  define: { 'process.env.NODE_ENV': '"development"' },
});
console.log('[beui-motion-prototype] built assets/index.js');
