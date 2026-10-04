import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, isAbsolute } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { SHELL_ASSET_LOADERS } from './shell-build-config.mjs';
import { shellRasterAssets } from './shell-raster-assets.mjs';

test('packaged Provider logos resolve against their JS chunk under file: URLs', async () => {
  const scratchRoot = fileURLToPath(new URL('../../../.data/renderer-builds/', import.meta.url));
  mkdirSync(scratchRoot, { recursive: true });
  const workspace = mkdtempSync(join(scratchRoot, 'sync-think-asset-url-test-'));
  const outdir = join(workspace, 'output');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';
  try {
    writeFileSync(join(workspace, 'main.js'), "import initialBrand from './initial.brand.svg'; import regularSvg from './regular.svg'; export { initialBrand, regularSvg }; export const lazy = () => import('./lazy.js');");
    writeFileSync(join(workspace, 'lazy.js'), "import brand from './lazy.brand.svg'; import png from './lazy.png'; export {brand, png};");
    writeFileSync(join(workspace, 'initial.brand.svg'), svg);
    writeFileSync(join(workspace, 'lazy.brand.svg'), svg);
    writeFileSync(join(workspace, 'regular.svg'), svg);
    writeFileSync(join(workspace, 'lazy.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    await build({
      entryPoints: { main: join(workspace, 'main.js') },
      outdir,
      bundle: true,
      format: 'esm',
      splitting: true,
      chunkNames: 'chunks/[name]-[hash]',
      assetNames: 'assets/[name]-[hash]',
      outExtension: { '.js': '.mjs' },
      loader: SHELL_ASSET_LOADERS,
      plugins: [shellRasterAssets()],
    });
    const initial = await import(pathToFileURL(join(outdir, 'main.mjs')).href);
    const lazy = await initial.lazy();
    for (const url of [initial.initialBrand, lazy.brand, lazy.png]) {
      assert.equal(new URL(url).protocol, 'file:');
      const file = fileURLToPath(url);
      const relativeFile = relative(outdir, file);
      assert.ok(!isAbsolute(relativeFile) && !relativeFile.startsWith('..'));
      assert.ok(existsSync(file), `Emitted image exists: ${url}`);
    }
    assert.equal(readFileSync(fileURLToPath(lazy.brand), 'utf8'), svg);
    assert.match(initial.regularSvg, /^data:image\/svg\+xml/);
  } finally {
    assert.ok(basename(workspace).startsWith('sync-think-asset-url-test-'));
    assert.equal(relative(scratchRoot, workspace), basename(workspace));
    rmSync(workspace, { recursive: true, force: true });
  }
});
