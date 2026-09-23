import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArchitectureSource } from './architecture-rules.mjs';
import { checkSourceDependencyCycles } from './architecture-dependency-graph.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.turbo'].includes(entry.name)) continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(target);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
      yield target;
  }
}
const errors = [];
let count = 0;
const sources = new Map();
for (const file of [...files(path.join(root, 'apps')), ...files(path.join(root, 'packages'))]) {
  const relative = path.relative(root, file).replaceAll('\\', '/');
  if (!relative.includes('/src/')) continue;
  count++;
  const source = readFileSync(file, 'utf8');
  sources.set(relative, source);
  errors.push(...checkArchitectureSource(relative, source));
}
const workspaceAliases = new Map();
for (const directory of ['apps', 'packages']) {
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, directory, entry.name, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const index = `${directory}/${entry.name}/src/index.ts`;
      if (typeof manifest.name === 'string' && sources.has(index)) {
        workspaceAliases.set(manifest.name, index);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
workspaceAliases.set(
  '@sync-think/desktop-demo-surface',
  'apps/desktop/src/renderer/shell/website-demo-surface.ts',
);
errors.push(...checkSourceDependencyCycles(sources, workspaceAliases));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Architecture boundaries passed (${count} source files).`);
