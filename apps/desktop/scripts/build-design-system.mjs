import { buildDesignPreviews } from './build-design-previews.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { generateDesignCatalog } from '../../../scripts/generate-design-catalog.mjs';
const desktop = fileURLToPath(new URL('..', import.meta.url));
const shell = join(desktop, 'src/renderer/shell');
const out = join(desktop, 'dist/design-system');
const require = createRequire(import.meta.url);
generateDesignCatalog();
mkdirSync(out, { recursive: true });
await build({
  absWorkingDir: desktop,
  entryPoints: [join(shell, 'design-system-entry.tsx')],
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: out,
  jsx: 'automatic',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl' },
});
const pkg = require.resolve('@tailwindcss/cli/package.json');
const bin = require(pkg).bin;
execFileSync(
  process.execPath,
  [
    join(dirname(pkg), typeof bin === 'string' ? bin : bin.tailwindcss),
    '-i',
    join(shell, 'shell.css'),
    '-o',
    join(out, 'shell.css'),
    '--cwd',
    shell,
    '--minify',
  ],
  { stdio: 'inherit' },
);
cpSync(join(shell, 'assets/fonts/files'), join(out, 'files'), { recursive: true });
writeFileSync(
  join(out, 'index.html'),
  '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SYNC-THINK · 组件库</title><link rel="stylesheet" href="./shell.css"></head><body><div id="root"></div><script type="module" src="./design-system-entry.js"></script></body></html>',
);
await buildDesignPreviews(desktop, out);
console.log('Design system built: ' + out);
if (process.argv.includes('--serve')) {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.woff2': 'font/woff2',
  };
  const server = createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const target = resolve(out, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(out + sep) || !existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.setHeader('Content-Type', types[extname(target)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(readFileSync(target));
  });
  server.listen(4318, '127.0.0.1', () => console.log('Design system: http://127.0.0.1:4318'));
}
