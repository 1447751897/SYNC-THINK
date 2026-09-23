import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildImageProcessEntries } from './image-process-events.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('buildImageProcessEntries', () => {
  it('records a workspace-relative path for Codex native image input', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'sync-think-image-process-'));
    temporaryDirectories.push(workspace);
    const conversationId = 'conversation-1';
    const directory = join(workspace, '.sync-think', 'conversations', conversationId, 'images');
    mkdirSync(directory, { recursive: true });
    const stagingPath = join(directory, 'attachment.png');
    writeFileSync(stagingPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    expect(
      buildImageProcessEntries({
        images: [{ name: '截图.png', mimeType: 'image/png', stagingPath }],
        mode: 'forwarded',
        trust: { workspaceRoot: workspace, conversationId },
        kernelId: 'codex',
        providerModelId: 'gpt-5.6-sol',
      }),
    ).toEqual([
      expect.objectContaining({
        path: `.sync-think/conversations/${conversationId}/images/attachment.png`,
        route: 'forwarded',
        preview: expect.stringContaining('Codex localImage'),
      }),
    ]);
  });

  it('describes the text-model materialization route without claiming a tool already ran', () => {
    const [entry] = buildImageProcessEntries({
      images: [{ name: 'diagram.jpg', mimeType: 'image/jpeg' }],
      mode: 'materialized',
      providerModelId: 'text-only-model',
    });

    expect(entry).toMatchObject({
      path: 'diagram.jpg',
      route: 'materialized',
    });
    expect(entry?.preview).toContain('将按需调用 describe_image 或 ocr_image');
    expect(entry?.preview).not.toContain('已调用');
  });
});
