import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readStagedImageAsDataUrl,
  resolveAppendMessageImageDataUrl,
  resolveAppendMessageImageStagingPath,
  resolveChatImageStagingDir,
  resolveStagedImageWorkspaceRelativePath,
} from './chat-image-staging.js';

describe('chat-image-staging', () => {
  it('reads staged images only from the staging directory', () => {
    const staging = join(tmpdir(), `sync-think-img-stage-${Date.now()}`);
    mkdirSync(staging, { recursive: true });
    const file = join(staging, 'a.png');
    // Minimal PNG header-ish bytes — only need non-empty for base64 conversion.
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
    process.env.SYNC_THINK_CHAT_IMAGE_STAGING = staging;
    try {
      expect(resolveChatImageStagingDir()).toContain('sync-think-img-stage');
      const dataUrl = readStagedImageAsDataUrl(file);
      expect(dataUrl?.startsWith('data:image/png;base64,')).toBe(true);

      const outside = join(tmpdir(), `outside-${Date.now()}.png`);
      writeFileSync(outside, Buffer.from([1, 2, 3, 4]));
      expect(readStagedImageAsDataUrl(outside)).toBeUndefined();

      expect(
        resolveAppendMessageImageDataUrl({
          stagingPath: file,
          mimeType: 'image/png',
        })?.startsWith('data:image/png;base64,'),
      ).toBe(true);
      expect(
        resolveAppendMessageImageDataUrl({
          dataUrl: 'data:image/jpeg;base64,abc',
        }),
      ).toBe('data:image/jpeg;base64,abc');
    } finally {
      delete process.env.SYNC_THINK_CHAT_IMAGE_STAGING;
      rmSync(staging, { recursive: true, force: true });
    }
  });

  it('accepts only the matching conversation image directory inside the workspace', () => {
    const workspace = join(tmpdir(), `sync-think-workspace-image-${Date.now()}`);
    const conversationId = 'conv-image-1';
    const imageDir = join(workspace, '.sync-think', 'conversations', conversationId, 'images');
    const file = join(imageDir, 'attachment-1.png');
    const wrongConversationFile = join(
      workspace,
      '.sync-think',
      'conversations',
      'conv-other',
      'images',
      'attachment-1.png',
    );
    mkdirSync(imageDir, { recursive: true });
    mkdirSync(join(wrongConversationFile, '..'), { recursive: true });
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]));
    writeFileSync(wrongConversationFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 2]));

    try {
      const trust = { workspaceRoot: workspace, conversationId };
      expect(resolveAppendMessageImageStagingPath({ stagingPath: file }, trust)).toBe(file);
      expect(
        resolveAppendMessageImageDataUrl({ stagingPath: file, mimeType: 'image/png' }, trust),
      ).toMatch(/^data:image\/png;base64,/);
      expect(
        resolveAppendMessageImageStagingPath({ stagingPath: wrongConversationFile }, trust),
      ).toBeUndefined();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('derives a workspace-relative path only for attachments inside the workspace', () => {
    const workspace = join(tmpdir(), `sync-think-materialized-${Date.now()}`);
    const conversationId = 'conv-materialized';
    const imageDir = join(workspace, '.sync-think', 'conversations', conversationId, 'images');
    const file = join(imageDir, 'attachment-9.png');
    mkdirSync(imageDir, { recursive: true });
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 9]));

    // App-managed but outside the workspace: a path relative to the workspace
    // root would be meaningless to the model, so it must be rejected.
    const sharedStaging = join(tmpdir(), `sync-think-shared-staging-${Date.now()}`);
    mkdirSync(sharedStaging, { recursive: true });
    const sharedFile = join(sharedStaging, 'shared.png');
    writeFileSync(sharedFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 8]));

    try {
      expect(
        resolveStagedImageWorkspaceRelativePath(file, { workspaceRoot: workspace, conversationId }),
      ).toBe(`.sync-think/conversations/${conversationId}/images/attachment-9.png`);
      // No bound workspace -> nothing to hand the model.
      expect(resolveStagedImageWorkspaceRelativePath(file, { conversationId })).toBeUndefined();

      process.env.SYNC_THINK_CHAT_IMAGE_STAGING = sharedStaging;
      expect(resolveAppendMessageImageStagingPath({ stagingPath: sharedFile })).toBe(sharedFile);
      expect(
        resolveStagedImageWorkspaceRelativePath(sharedFile, { workspaceRoot: workspace }),
      ).toBeUndefined();
      expect(
        resolveStagedImageWorkspaceRelativePath(sharedFile, { workspaceRoot: sharedStaging }),
      ).toBe('shared.png');
    } finally {
      delete process.env.SYNC_THINK_CHAT_IMAGE_STAGING;
      rmSync(workspace, { recursive: true, force: true });
      rmSync(sharedStaging, { recursive: true, force: true });
    }
  });
});
