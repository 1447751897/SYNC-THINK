import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { shellRasterAssets } from '../apps/desktop/scripts/shell-raster-assets.mjs';
import { SHELL_ASSET_LOADERS } from '../apps/desktop/scripts/shell-build-config.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(join(root, 'apps/desktop/package.json'))('esbuild');
test('raster icons remain offline file assets for initial and lazy panels, never base64 JavaScript', async () => {
  const out = await mkdtemp(join(tmpdir(), 'sync-think-raster-qa-'));
  await writeFile(join(out, 'package.json'), ' {"type":"module"}');
  const image = JSON.stringify(
    join(root, 'apps/desktop/src/renderer/shell/assets/sync-think-logo.png'),
  );
  const result = await build({
    stdin: {
      contents:
        'import image from ' +
        image +
        '; export {image}; export async function lazy(){return (await import("qa-lazy-panel")).default;}',
      resolveDir: root,
      sourcefile: 'qa-entry.js',
    },
    bundle: true,
    format: 'esm',
    splitting: true,
    outdir: out,
    write: false,
    metafile: true,
    minify: true,
    chunkNames: 'chunks/[name]-[hash]',
    assetNames: 'assets/[name]-[hash]',
    loader: SHELL_ASSET_LOADERS,
    plugins: [
      shellRasterAssets(),
      {
        name: 'qa-panel',
        setup(b) {
          b.onResolve({ filter: /^qa-lazy-panel$/ }, () => ({ path: 'panel', namespace: 'qa' }));
          b.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({
            contents: 'import image from ' + image + ';export default image;',
            loader: 'js',
            resolveDir: root,
          }));
        },
      },
    ],
  });
  for (const file of result.outputFiles) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents);
    if (file.path.endsWith('.js'))
      assert.equal(file.text.includes('data:image/png;base64,'), false);
  }
  const entry = result.outputFiles.find((f) => f.path.endsWith('stdin.js'));
  assert.ok(entry);
  const module = await import(pathToFileURL(entry.path).href);
  assert.match(module.image, /assets\/sync-think-logo-[A-Z0-9]+\.png$/);
  assert.equal(await module.lazy(), module.image);
  assert.ok(module.image.startsWith('file:'));
  const asset = await stat(fileURLToPath(module.image));
  assert.equal(asset.size, (await stat(JSON.parse(image))).size);
});
