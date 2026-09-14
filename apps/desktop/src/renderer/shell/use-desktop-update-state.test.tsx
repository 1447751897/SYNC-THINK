/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { DesktopUpdateSnapshot } from '../../desktop-update-contract.js';
import {
  resolvePendingUpdateVersion,
  useDesktopUpdateState,
} from './use-desktop-update-state.js';

const baseSnapshot: DesktopUpdateSnapshot = {
  schemaVersion: 1,
  phase: 'idle',
  configured: true,
  currentVersion: '0.1.0-rc.5',
  channel: 'latest',
  availableVersion: null,
  releaseNotes: null,
  progressPercent: null,
  checkedAt: null,
  downloadedAt: null,
  errorCode: null,
};

function setBridge(updates: unknown) {
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { updates } });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // 每个用例自己决定要不要注入 preload bridge，用例之间不能互相看到。
  Object.defineProperty(window, 'syncThink', { configurable: true, value: undefined });
});

describe('resolvePendingUpdateVersion', () => {
  it('only reports a version while a pending update can still be installed', () => {
    for (const phase of ['available', 'downloading', 'downloaded'] as const) {
      expect(
        resolvePendingUpdateVersion({ ...baseSnapshot, phase, availableVersion: '0.1.0-rc.6' }),
      ).toBe('0.1.0-rc.6');
    }

    // 这些阶段里残留的 availableVersion 不构成「有新版本」：已经在装、检查中、已最新、
    // 或者上一次检查失败，都不该继续对外提示可以升级。
    for (const phase of [
      'idle',
      'checking',
      'up-to-date',
      'error',
      'disabled',
      'installing',
    ] as const) {
      expect(
        resolvePendingUpdateVersion({ ...baseSnapshot, phase, availableVersion: '0.1.0-rc.6' }),
      ).toBeNull();
    }

    expect(resolvePendingUpdateVersion(null)).toBeNull();
    expect(
      resolvePendingUpdateVersion({ ...baseSnapshot, phase: 'available', availableVersion: null }),
    ).toBeNull();
  });
});

describe('useDesktopUpdateState', () => {
  it('stays inert when the preload bridge is missing', () => {
    const { result } = renderHook(() => useDesktopUpdateState());

    expect(result.current.snapshot).toBeNull();
    expect(result.current.loadFailed).toBe(false);
  });

  it('loads the initial snapshot and follows pushed updates until unmount', async () => {
    let listener: ((snapshot: DesktopUpdateSnapshot) => void) | undefined;
    const updates = {
      getState: vi.fn().mockResolvedValue(baseSnapshot),
      subscribeState: vi.fn((next: (snapshot: DesktopUpdateSnapshot) => void) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      }),
    };
    setBridge(updates);

    const { result, unmount } = renderHook(() => useDesktopUpdateState());
    await waitFor(() => expect(result.current.snapshot).toEqual(baseSnapshot));

    act(() => {
      listener?.({ ...baseSnapshot, phase: 'available', availableVersion: '0.1.0-rc.6' });
    });
    expect(result.current.snapshot?.availableVersion).toBe('0.1.0-rc.6');
    expect(resolvePendingUpdateVersion(result.current.snapshot)).toBe('0.1.0-rc.6');

    unmount();
    // 卸载后必须真的退订，否则重复挂载会累积监听器。
    expect(listener).toBeUndefined();
  });

  it('reports an initialization failure instead of a silent null snapshot', async () => {
    const updates = {
      getState: vi.fn().mockRejectedValue(new Error('boom')),
      subscribeState: vi.fn().mockReturnValue(() => undefined),
    };
    setBridge(updates);

    const { result } = renderHook(() => useDesktopUpdateState());

    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    expect(result.current.snapshot).toBeNull();
  });

  it('lets an action result override the snapshot without waiting for a push', async () => {
    const updates = {
      getState: vi.fn().mockResolvedValue(baseSnapshot),
      subscribeState: vi.fn().mockReturnValue(() => undefined),
    };
    setBridge(updates);

    const { result } = renderHook(() => useDesktopUpdateState());
    await waitFor(() => expect(result.current.snapshot).toEqual(baseSnapshot));

    act(() => {
      result.current.applySnapshot({
        ...baseSnapshot,
        phase: 'downloaded',
        availableVersion: '0.1.0-rc.6',
        progressPercent: 100,
      });
    });

    expect(result.current.snapshot?.phase).toBe('downloaded');
  });
});
