import { readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

export function isDemoPath(pathname: string) {
  return pathname === '/demo' || pathname === '/demo.html';
}

const ROUTES = new Map([
  ['/', 'index.html'],
  ['/demo', 'demo.html'],
  ['/demo.html', 'demo.html'],
  ['/login', 'auth.html'],
  ['/register', 'auth.html'],
  ['/forgot-password', 'auth.html'],
  ['/reset-password', 'auth.html'],
  ['/account', 'auth.html'],
  ['/auth.js', 'auth.js'],
  ['/auth-client.js', 'auth-client.js'],
  ['/site.js', 'site.js'],
  ['/styles.css', 'styles.css'],
  ['/tokens.css', 'tokens.css'],
]);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

export async function readWebsiteFile(directory: string, pathname: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return undefined;
  let file = ROUTES.get(pathname);
  if (!file && decoded.startsWith('/assets/')) {
    const segments = decoded.slice(1).split('/');
    if (segments.some((segment) => !segment || segment.startsWith('.'))) return undefined;
    if (!MIME_TYPES[extname(decoded).toLowerCase()]) return undefined;
    file = segments.join('/');
  }
  if (!file) return undefined;
  try {
    const root = await realpath(directory);
    const target = await realpath(resolve(root, file));
    const withinRoot = relative(root, target);
    if (
      !withinRoot ||
      withinRoot === '..' ||
      withinRoot.startsWith(`..${sep}`) ||
      isAbsolute(withinRoot)
    )
      return undefined;
    return { body: await readFile(target), type: MIME_TYPES[extname(file).toLowerCase()] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return undefined;
    throw error;
  }
}
