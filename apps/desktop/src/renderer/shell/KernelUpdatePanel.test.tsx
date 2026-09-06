/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  ManagedKernelUpdateActionResult,
  ManagedKernelUpdateSnapshot,
} from '../../kernel-update-contract.js';
import { KernelUpdatePanel } from './KernelUpdatePanel.js';

const state: ManagedKernelUpdateSnapshot = {
  schemaVersion: 1,
  installerAvailable: true,
  checkedAt: null,
  items: [
    {
      kernelId: 'codex',
      name: 'Codex',
      packageName: '@openai/codex',
      managedVersion: null,
      latestVersion: null,
      phase: 'idle',
      errorCode: null,
    },
    {
      kernelId: 'claude-code',
      name: 'Claude Code',
      packageName: '@anthropic-ai/claude-code',
      managedVersion: '2.1.241',
      latestVersion: null,
      phase: 'idle',
      errorCode: null,
    },
    {
      kernelId: 'pi',
      name: 'Pi',
      packageName: '@earendil-works/pi-coding-agent',
      managedVersion: null,
      latestVersion: null,
      phase: 'idle',
      errorCode: null,
    },
  ],
};

const kernelUpdates = {
  getState: vi.fn(async () => state),
  checkForUpdates: vi.fn(async (): Promise<ManagedKernelUpdateActionResult> => ({
    ok: true,
    errorCode: null,
    state: {
      ...state,
      items: state.items.map((item) => ({
        ...item,
        latestVersion: '9.9.9',
        phase: 'available' as const,
      })),
    },
  })),
  installUpdate: vi.fn(async () => ({ ok: true, errorCode: null, state })),
  subscribeState: vi.fn(() => () => undefined),
};

beforeEach(() => {
  Object.defineProperty(window, 'syncThink', {
    configurable: true,
    value: {
      kernelUpdates,
      runtime: {
        detectKernels: vi.fn(async () => ({
          kernels: [
            { kernelId: 'codex', version: '0.149.0' },
            { kernelId: 'claude-code', version: '2.1.241' },
          ],
        })),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('KernelUpdatePanel', () => {
  it('auto-checks each private kernel and shows brand marks', async () => {
    render(<KernelUpdatePanel />);

    expect(await screen.findByRole('heading', { name: '核心运行环境' })).toBeTruthy();
    expect(screen.getByText('GPT')).toBeTruthy();
    expect(screen.getByText('ClaudeCode')).toBeTruthy();
    expect(screen.queryByText('Pi')).toBeNull();
    expect(screen.getByText('v0.149.0')).toBeTruthy();
    expect(screen.getByText('v2.1.241')).toBeTruthy();
    expect(screen.queryByText('未检测到版本')).toBeNull();
    expect(screen.getByLabelText('GPT')).toBeTruthy();
    expect(screen.getByAltText('ClaudeCode')).toBeTruthy();
    expect(screen.queryByLabelText('Pi')).toBeNull();

    await waitFor(() => expect(kernelUpdates.checkForUpdates).toHaveBeenCalled());
    expect(kernelUpdates.checkForUpdates.mock.calls[0]).toEqual([]);
    expect(await screen.findAllByText('可升级到 9.9.9')).toHaveLength(2);
    const checkGpt = screen.getByRole('button', { name: '检查更新 GPT' });
    await waitFor(() => expect((checkGpt as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(checkGpt);
    await waitFor(() =>
      expect(kernelUpdates.checkForUpdates).toHaveBeenCalledWith({ kernelId: 'codex' }),
    );
  });

  it('installs a private kernel without using the global install bridge', async () => {
    render(<KernelUpdatePanel />);
    await screen.findByText('v0.149.0');
    await waitFor(() => expect(kernelUpdates.checkForUpdates).toHaveBeenCalled());
    const install = screen.getByRole('button', { name: '私有安装 GPT' });
    await waitFor(() => expect((install as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(install);

    await waitFor(() =>
      expect(kernelUpdates.installUpdate).toHaveBeenCalledWith({ kernelId: 'codex' }),
    );
  });

  it('keeps other kernel install actions available while one private install is running', async () => {
    let releaseCodex: (() => void) | undefined;
    const codexGate = new Promise<void>((resolve) => {
      releaseCodex = resolve;
    });
    kernelUpdates.installUpdate.mockImplementation(async (payload?: { kernelId?: string }) => {
      if (payload?.kernelId === 'codex') await codexGate;
      return { ok: true, errorCode: null, state };
    });

    render(<KernelUpdatePanel />);
    await waitFor(() => expect(kernelUpdates.checkForUpdates).toHaveBeenCalled());
    const installGpt = await screen.findByRole('button', { name: '私有安装 GPT' });
    await waitFor(() => expect((installGpt as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(installGpt);

    const installClaude = screen.getByRole('button', { name: '升级 ClaudeCode' });
    await waitFor(() => expect((installClaude as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(installClaude);

    await waitFor(() =>
      expect(kernelUpdates.installUpdate).toHaveBeenCalledWith({ kernelId: 'claude-code' }),
    );
    releaseCodex?.();
    await waitFor(() =>
      expect(kernelUpdates.installUpdate).toHaveBeenCalledWith({ kernelId: 'codex' }),
    );
  });

  it('does not present an already activated version as a reinstall action', async () => {
    const upToDate = {
      ...state,
      items: state.items.map((item) =>
        item.kernelId === 'claude-code'
          ? { ...item, latestVersion: '2.1.241', phase: 'up-to-date' as const }
          : item,
      ),
    };
    kernelUpdates.getState.mockResolvedValueOnce(upToDate);
    kernelUpdates.checkForUpdates.mockResolvedValueOnce({
      ok: true,
      errorCode: null,
      state: upToDate,
    });

    render(<KernelUpdatePanel />);

    const button = await screen.findByRole('button', { name: '已是最新 ClaudeCode' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
