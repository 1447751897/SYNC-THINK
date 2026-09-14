import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildWebsiteDemo } from '../desktop/scripts/build-website-demo.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, 'dist');
const spec = JSON.parse(
  await readFile(path.join(root, '../../docs/product/16-shell-design-tokens.json'), 'utf8'),
);
const tokenGroups = [
  'fonts',
  'website',
  'surfaces',
  'panels',
  'borders',
  'text',
  'accent',
  'states',
  'radius',
  'layout',
];
const groups = spec.groups.filter((group) => tokenGroups.includes(group.id));
if (groups.length !== tokenGroups.length) throw new Error('Website design tokens are missing');
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
for (const stale of ['demo.js', 'demo.css']) await rm(path.join(output, stale), { force: true });
for (const file of [
  'index.html',
  'auth.html',
  'styles.css',
  'site.js',
  'auth.js',
  'auth-client.js',
  'demo.html',
]) {
  await cp(path.join(root, file), path.join(output, file), { recursive: true });
}
await mkdir(path.join(output, 'assets', 'kernels'), { recursive: true });
for (const file of [
  'hero-alpine-painted.webp',
  'footer-meadow-painted.webp',
  'demo-wallpaper-chat.jpg',
  'demo-wallpaper-kernels.jpg',
  'demo-wallpaper-agents.jpg',
  'demo-wallpaper-teams.jpg',
  'kernels/claude-code.svg',
  'kernels/codex.svg',
  'sync-think-logo.png',
  'instrument-serif.ttf',
  'instrument-serif-OFL.txt',
]) {
  await cp(path.join(root, 'assets', file), path.join(output, 'assets', file));
}
for (const stale of [
  'hero-alpine-painted.png',
  'workspace-preview.png',
  'hero-landscape.png',
  'anime-lake.png',
  'night-lake.png',
  'oilpainting-lake.png',
  'kernels/gemini-cli.svg',
  'kernels/openclaw.svg',
  'kernels/opencode.svg',
]) {
  await rm(path.join(output, 'assets', stale), { force: true });
}
await writeFile(
  path.join(output, 'tokens.css'),
  `/* Generated from the shared token JSON. */\n:root {\n  color-scheme: light;\n${declarations(0)}\n}\n`,
);
console.log('Website built: apps/website/dist');
await buildWebsiteDemo(output);
