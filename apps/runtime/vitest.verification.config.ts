// Explicit verification config for Windows environments where esbuild cannot remove its
// temporary transform file for the large Runtime module. It changes only the TS loader;
// production sources, RPC/storage paths, test discovery, and assertions remain unchanged.
// A separate `pnpm --filter @sync-think/runtime build` checks the complete types.
import { defineConfig } from 'vitest/config';
import ts from 'typescript';
export default defineConfig({
  esbuild: { exclude: /\/apps\/runtime\/src\/runtime\.ts$/ },
  plugins: [{ name: 'verify-large-runtime-with-typescript', enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/apps/runtime/src/runtime.ts')) return;
      const result = ts.transpileModule(source, { fileName: id, compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: true,
      } });
      return { code: result.outputText, map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null };
    },
  }],
  test: { testTimeout: 15000, hookTimeout: 15000 },
});
