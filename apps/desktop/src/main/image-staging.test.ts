import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { materializeChatImageDataUrl } from './image-staging.js';

describe('materializeChatImageDataUrl', () => {
  it('stores a pasted image in the matching workspace conversation directory', () => {
    const workspacePath = join(tmpdir(), `sync-think-image-workspace-${Date.now()}`);
    try {
      const result = materializeChatImageDataUrl(
        {
          name: 'screen.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
        {
          workspacePath,
          conversationId: 'conv-1',
          attachmentId: 'attachment-1',
        },
      );

      expect(result.stagingPath).toBe(
        join(
          workspacePath,
          '.sync-think',
          'conversations',
          'conv-1',
          'images',
          'attachment-1.png',
        ),
      );
      expect(existsSync(result.stagingPath)).toBe(true);
      expect(result.bytes).toBeGreaterThan(0);
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});
