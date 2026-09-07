import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist');
const spec = JSON.parse(
  await readFile(path.join(root, '../../docs/product/16-shell-design-tokens.json'), 'utf8'),
);
const groups = spec.groups.filter((group) => ['fonts', 'website'].includes(group.id));
if (groups.length !== 2) throw new Error('Website design tokens are missing');
function declarations(theme) {
  return groups
    .flatMap((group) =>
      Object.entries(group.tokens).flatMap(([key, value]) => {
        const resolved = Array.isArray(value) ? value[theme] : theme === 0 ? value : null;
        return resolved === null ? [] : [`  ${group.prefix}${key}: ${resolved};`];
      }),
    )
    .join('\n');
}
await mkdir(output, { recursive: true });
for (const file of [
  'index.html',
  'auth.html',
  'styles.css',
  'site.js',
  'auth.js',
  'auth-client.js',
  'demo.html',
  'demo.js',
  'demo.css',
]) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
await mkdir(path.join(output, 'assets'), { recursive: true });
for (const file of [
  'hero-alpine-painted.webp',
  'sync-think-logo.png',
  'instrument-serif.ttf',
  'instrument-serif-OFL.txt',
]) {
  await cp(path.join(root, 'assets', file), path.join(output, 'assets', file));
}
for (const stale of ['hero-landscape.png', 'hero-alpine-painted.png', 'workspace-preview.png']) {
  await rm(path.join(output, 'assets', stale), { force: true });
}
await writeFile(
  path.join(output, 'tokens.css'),
  `/* Generated from the shared token JSON. */\n:root {\n${declarations(0)}\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${declarations(1)}\n  }\n}\n`,
);
console.log('Website built: apps/website/dist');
