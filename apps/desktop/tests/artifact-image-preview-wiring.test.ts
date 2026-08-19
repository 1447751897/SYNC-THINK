import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('artifact image preview wiring', () => {
  it('keeps contentRef in Main and exposes only a typed opaque grant', () => {
    const root = process.cwd();
    const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8');
    const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf8');
    const global = readFileSync(join(root, 'src/renderer/global.d.ts'), 'utf8');
    expect(main).toContain("ipcMain.handle('runtime:artifact-image-preview'");
    expect(main).toContain("'artifact.getVersion'");
    expect(main).toContain("url.hostname === 'artifact'");
    expect(main).toContain('artifactImagePreviewRegistry.read(token)');
    expect(preload).toContain("ipcRenderer.invoke(\n        'runtime:artifact-image-preview'");
    expect(preload).toContain('getArtifactImagePreview');
    expect(global).toContain('getArtifactImagePreview(');
    expect(preload).not.toContain('contentRef: string');
    // KNOWN GAP: nothing in src/renderer/shell/ calls getArtifactImagePreview, so
    // artifact image preview is currently unreachable from the shipping UI. The
    // renderer-side assertions that used to live here only passed because the
    // legacy renderer (deleted 2026-08-18) had an Artifact rail.
    //
    // The Main/preload assertions above are kept regardless: they guard the
    // security property that contentRef never crosses the bridge and the renderer
    // only ever receives an opaque, typed, short-lived grant. That contract must
    // hold before a shell surface is built on top of it, not after.
  });
});
