import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
/** Keep PNG and Provider SVG file URLs relative to their emitting JS chunk.
 * esbuild emits file-loader paths relative to their JS chunk, not the HTML.
 * Resolve the file in the same chunk via import.meta.url, including lazy panels. */
export function shellRasterAssets() {
  return {
    name: 'shell-raster-url',
    setup(build) {
      build.onResolve({ filter: /\.(?:png|brand\.svg)$/ }, (args) => {
        if (args.kind === 'url-token' || args.namespace === 'raster-url') return;
        return {
          path: isAbsolute(args.path) ? args.path : resolve(args.resolveDir, args.path),
          namespace: 'raster-url',
        };
      });
      build.onResolve({ filter: /^raster-url-helper$/, namespace: 'raster-url' }, () => ({
        path: 'raster-url-helper',
        namespace: 'raster-url-helper',
      }));
      build.onLoad({ filter: /.*/, namespace: 'raster-url-helper' }, () => ({
        contents: 'export default function resolveAsset(asset, base) { return new URL(asset, base).href; }',
        loader: 'js',
      }));
      build.onResolve({ filter: /^raster-file:/, namespace: 'raster-url' }, (args) => ({
        path: args.path.slice('raster-file:'.length),
        namespace: 'raster-file',
      }));
      build.onLoad({ filter: /.*/, namespace: 'raster-url' }, (args) => ({
        contents:
          'import asset from ' +
          JSON.stringify('raster-file:' + args.path) +
          ';import resolveAsset from "raster-url-helper";export default resolveAsset(asset,import.meta.url);',
        loader: 'js',
        watchFiles: [args.path],
      }));
      build.onLoad({ filter: /.*/, namespace: 'raster-file' }, async (args) => ({
        contents: await readFile(args.path),
        loader: 'file',
        watchFiles: [args.path],
      }));
    },
  };
}
