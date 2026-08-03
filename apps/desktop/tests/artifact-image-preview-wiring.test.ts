import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('artifact image preview wiring', () => {
  it('keeps contentRef in Main and exposes only a typed opaque grant', () => {
    const root = process.cwd();
    const main = readFileSync(join(root, 'src/main/index.ts'), 'utf8');
    const preload = readFileSync(join(root, 'src/preload/index.ts'), 'utf8');
    const global = readFileSync(join(root, 'src/renderer/global.d.ts'), 'utf8');
    const renderer = readFileSync(join(root, 'src/renderer/index.tsx'), 'utf8');
    expect(main).toContain("ipcMain.handle('runtime:artifact-image-preview'");
    expect(main).toContain("'artifact.getVersion'");
    expect(main).toContain("url.hostname === 'artifact'");
    expect(main).toContain('artifactImagePreviewRegistry.read(token)');
    expect(preload).toContain("ipcRenderer.invoke(\n        'runtime:artifact-image-preview'");
    expect(preload).toContain('getArtifactImagePreview');
    expect(global).toContain('getArtifactImagePreview(');
    expect(preload).not.toContain('contentRef: string');
    expect(renderer).toContain('runtime.getArtifactImagePreview({');
    expect(renderer).toContain('version.hasContentRef');
    expect(renderer).toContain('version.imageGeneration');
    expect(renderer).toContain('(?:png|jpeg|webp)');
    expect(renderer).toContain('artifactLoadGateRef.current.isCurrent(requestToken)');
    expect(renderer).not.toContain('.contentRef');
  });
});
