import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { build } from 'esbuild';
import { writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
export async function buildDesignPreviews(desktop, out, includeVendors = true) {
  const shell = join(desktop, 'src/renderer/shell');
  const result = await build({
    absWorkingDir: desktop,
    entryPoints: { 'design-preview': join(shell, 'design-system/fixtures/entry.tsx') },
    bundle: true,
    metafile: true,
    format: 'esm',
    splitting: true,
    chunkNames: 'preview-chunks/[name]-[hash]',
    outdir: out,
    jsx: 'automatic',
    platform: 'browser',
    target: 'chrome120',
    minify: true,
    charset: 'utf8',
    define: { 'process.env.NODE_ENV': '"production"', __SYNC_THINK_RELEASE_HISTORY__: '"[]"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl' },
  });
  const previewJsBytes = Object.entries(result.metafile.outputs)
    .filter(([path]) => path.endsWith('.js'))
    .reduce((sum, [, output]) => sum + output.bytes, 0);
  writeFileSync(
    join(out, 'design-preview-build.json'),
    JSON.stringify({ previewJsBytes, isolatedFromShell: true }, null, 2),
  );
  console.log(
    `Isolated design preview JS: ${previewJsBytes.toLocaleString()} bytes (not loaded at app startup).`,
  );
  if (includeVendors) {
    for (const [entry, name] of [
      ['xterm-vendor.ts', 'xterm-vendor.js'],
      ['mermaid-vendor.ts', 'mermaid-vendor.js'],
      ['excalidraw-vendor.tsx', 'excalidraw-vendor.js'],
    ])
      await build({
        absWorkingDir: desktop,
        entryPoints: [join(shell, entry)],
        outfile: join(out, name),
        bundle: true,
        format: 'iife',
        jsx: 'automatic',
        platform: 'browser',
        minify: true,
        define: { 'process.env.NODE_ENV': '"production"' },
        loader: { '.css': 'css' },
      });
    const require = createRequire(import.meta.url);
    copyFileSync(
      join(dirname(require.resolve('@excalidraw/excalidraw')), 'index.css'),
      join(out, 'excalidraw-vendor.css'),
    );
  }
  copyFileSync(join(shell, 'design-system/fixtures/preview.css'), join(out, 'design-preview.css'));
  const csp =
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'self' blob:; frame-src 'self' blob: data:; form-action 'none'; base-uri 'none'";
  writeFileSync(
    join(out, 'design-preview.html'),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Sync-Think · 隔离组件预览</title><link rel="stylesheet" href="./shell.css"><link rel="stylesheet" href="./design-preview.css"></head><body><div id="root"></div><script type="module" src="./design-preview.js"></script></body></html>`,
  );
}
