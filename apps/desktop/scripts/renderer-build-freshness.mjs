import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Hash contents, not copied HTML mtimes. Include local dependency builds and CSS/font inputs.
const INPUTS = [
  'apps/desktop/src/renderer', 'apps/desktop/src/browser-session-info.ts', 'apps/desktop/src/local-web-page-contract.ts', 'apps/desktop/scripts', 'apps/desktop/package.json',
  'packages/shared/src', 'packages/shared/dist', 'packages/protocol/src', 'packages/protocol/dist',
  'packages/ui-kit/src', 'docs/releases/CHANGELOG.md', 'scripts/changelog.mjs',
  'scripts/generate-design-catalog.mjs', 'pnpm-lock.yaml',
];
export function rendererSourceFingerprint(root, inputs = INPUTS) {
  const hash = createHash('sha256');
  const files = [];
  const visit = (path) => {
    if (!existsSync(path)) return;
    if (statSync(path).isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (!entry.isSymbolicLink() && entry.name !== 'node_modules') visit(join(path, entry.name));
      }
    } else if (!/\.(?:test|spec)\.[^.]+$/.test(path)) files.push(path);
  };
  for (const input of inputs) visit(resolve(root, input));
  for (const path of [...new Set(files)].sort()) {
    const content = readFileSync(path);
    hash.update(relative(root, path).replaceAll('\\', '/') + '\0' + content.length + '\0');
    hash.update(content);
  }
  return hash.digest('hex');
}
export function rendererBuildIsCurrent(root, outdir, mode = 'production', inputs) {
  try {
    const manifest = JSON.parse(readFileSync(join(outdir, 'build-manifest.json'), 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.mode !== mode ||
      manifest.devSourceFingerprint !== rendererSourceFingerprint(root, inputs)) return false;
    const files = ['index.html', 'shell.js', 'shell.css', ...(manifest.shell?.files ?? []).map(f => f.path)];
    return files.every(file => {
      const path = resolve(outdir, file), rel = relative(outdir, path);
      return rel && !rel.startsWith('..') && existsSync(path) && statSync(path).isFile();
    });
  } catch { return false; }
}

// Fixed entry filenames must not retain references to a previous build's chunks.
// Use one source revision for the entry, chunk map, and CSS; hashed chunks stay reusable.
export function stampRendererAssetUrls(html, fingerprint) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('renderer.invalid_build_revision');
  const revision = fingerprint.slice(0, 20);
  return html.replace(/(["'])\.\/(shell(?:-chunks)?\.js|shell\.css)\1/g,
    (_match, quote, asset) => quote + './' + asset + '?build=' + revision + quote);
}
