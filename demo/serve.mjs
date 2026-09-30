/*
 * serve.mjs — the demo needs an HTTP origin, not file://.
 *
 * Two structural reasons:
 *   1. the real shell build (`shell.js`) is an ES module and Chrome blocks module loading
 *      over file://;
 *   2. the demo page loads the app's OWN compiled `shell.css` and embeds the app's own QA
 *      shell in an iframe, so both the stylesheet and the frame must share its origin.
 *
 *   node demo/serve.mjs              # build the QA shell if missing, serve, open a browser
 *   node demo/serve.mjs --no-open
 *   node demo/serve.mjs --port 4123
 *
 * Mounts:
 *   /       -> demo/
 *   /qa/    -> .data/renderer-builds/qa/    the real shell, from `build:shell:qa`
 *
 * `createDemoServer()` is exported so verify.mjs can run the same server in-process on an
 * ephemeral port instead of shelling out.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
export const QA_ROOT = join(repo, '.data', 'renderer-builds', 'qa');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Build the real shell once if it is not there yet. Returns false when it cannot be had. */
export function ensureQaBuild() {
  if (existsSync(join(QA_ROOT, 'index.html'))) return true;
  console.log('[demo] .data/renderer-builds/qa is missing — building the real shell once…');
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--filter', '@sync-think/desktop', 'build:shell:qa'],
    { cwd: repo, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0 || !existsSync(join(QA_ROOT, 'index.html'))) {
    console.error('[demo] build:shell:qa failed — run it by hand and retry.');
    return false;
  }
  return true;
}

function resolveIn(root, pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  if (rel.split(/[/\\]/).includes('..')) return null;
  const file = join(root, rel);
  return file.startsWith(root) ? file : null;
}

export function createDemoServer() {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const underQa = url.pathname.startsWith('/qa/');
    const root = underQa ? QA_ROOT : here;
    const pathname = underQa ? url.pathname.slice(3) : url.pathname;

    let file = resolveIn(root, pathname);
    if (!file) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    if (pathname === '/' || pathname === '') file = join(here, 'index.html');
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found: ' + url.pathname);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
}

const isCli = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isCli) {
  const args = process.argv.slice(2);
  const portArg = args.indexOf('--port');
  const PORT = portArg >= 0 ? Number(args[portArg + 1]) : 4173;
  if (!ensureQaBuild()) process.exit(1);
  createDemoServer().listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}/`;
    console.log(`[demo] ${url}`);
    console.log(`[demo] 真实 shell  ${url}qa/index.html?phase3-visual=connection-and-code&theme=dark`);
    console.log('[demo] Ctrl+C to stop');
    if (args.includes('--no-open')) return;
    const opener =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    try {
      spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      /* opening is a convenience; the URL is printed either way */
    }
  });
}
