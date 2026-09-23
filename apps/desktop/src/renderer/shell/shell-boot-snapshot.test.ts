/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import {
  hasShellBootSnapshot,
  createShellBootSnapshotWriter,
  readShellBootSnapshot,
  SHELL_BOOT_SNAPSHOT_KEY,
  writeShellBootSnapshot,
} from './shell-boot-snapshot.js';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function bootData(title: string): Parameters<typeof writeShellBootSnapshot>[0] {
  return {
    conversations: [
      {
        id: 'conv-a',
        workspaceId: 'ws-a',
        track: 'model',
        targetRef: 'model-a',
        title,
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
  };
}

describe('shell boot snapshot', () => {
  it('round-trips the last sidebar payload', () => {
    writeShellBootSnapshot(bootData('缓存对话'));

    const restored = readShellBootSnapshot();
    expect(hasShellBootSnapshot(restored)).toBe(true);
    expect(restored?.conversations[0]?.title).toBe('缓存对话');
    expect(restored?.modelNames.get('model-a')).toBe('Model A');
    expect(window.localStorage.getItem(SHELL_BOOT_SNAPSHOT_KEY)).toContain('conv-a');
  });

  it('debounces writes and persists only the latest refresh payload', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const writer = createShellBootSnapshotWriter(250, write);

    writer.schedule(bootData('旧标题'));
    vi.advanceTimersByTime(200);
    writer.schedule(bootData('新标题'));
    vi.advanceTimersByTime(249);
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0].conversations[0]?.title).toBe('新标题');
  });

  it('flushes the latest pending payload immediately without a duplicate timer write', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const writer = createShellBootSnapshotWriter(250, write);

    writer.schedule(bootData('最后版本'));
    writer.flush();
    vi.runAllTimers();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0].conversations[0]?.title).toBe('最后版本');
  });
});
