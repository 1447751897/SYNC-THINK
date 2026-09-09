/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Conversation } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import {
  hasShellBootSnapshot,
  readShellBootSnapshot,
  SHELL_BOOT_SNAPSHOT_KEY,
  writeShellBootSnapshot,
} from './shell-boot-snapshot.js';

beforeEach(() => {
  window.localStorage.clear();
});

describe('shell boot snapshot', () => {
  it('round-trips the last sidebar payload', () => {
    writeShellBootSnapshot({
      conversations: [
        {
          id: 'conv-a',
          workspaceId: 'ws-a',
          track: 'model',
          targetRef: 'model-a',
          title: '缓存对话',
          executionMode: 'full-access',
          createdAt: '2026-07-25T00:00:00.000Z',
          updatedAt: '2026-07-25T00:00:00.000Z',
        } as Conversation,
      ],
      agents: [],
      teams: [],
      modelNames: new Map([['model-a', 'Model A']]),
      models: [{ modelId: 'model-a', displayName: 'Model A', providerName: 'Local' }],
      workspaces: [
        {
          workspaceId: 'ws-a',
          name: 'A',
          folderPath: 'D:\\a',
          createdAt: '2026-07-25T00:00:00.000Z',
          updatedAt: '2026-07-25T00:00:00.000Z',
        } as WorkspaceSummary,
      ],
      skills: [],
    });

    const restored = readShellBootSnapshot();
    expect(hasShellBootSnapshot(restored)).toBe(true);
    expect(restored?.conversations[0]?.title).toBe('缓存对话');
    expect(restored?.modelNames.get('model-a')).toBe('Model A');
    expect(window.localStorage.getItem(SHELL_BOOT_SNAPSHOT_KEY)).toContain('conv-a');
  });
});
