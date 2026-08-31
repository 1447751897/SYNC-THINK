/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ManagedKernelUpdateSnapshot } from '../../kernel-update-contract.js';
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
  ],
};

const kernelUpdates = {
  getState: vi.fn(async () => state),
  checkForUpdates: vi.fn(async () => ({
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
  it('shows effective versions and checks both private kernels', async () => {
    render(<KernelUpdatePanel />);

    expect(await screen.findByText('Codex 与 Claude Code')).toBeTruthy();
    expect(screen.getByText('v0.149.0')).toBeTruthy();
    expect(screen.getByText('v2.1.241')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '检查内核更新' }));
    await waitFor(() => expect(kernelUpdates.checkForUpdates).toHaveBeenCalledTimes(1));
    expect(await screen.findAllByText('可升级到 9.9.9')).toHaveLength(2);
  });

  it('installs a private kernel without using the global install bridge', async () => {
    render(<KernelUpdatePanel />);
    await screen.findByText('v0.149.0');

    fireEvent.click(screen.getByRole('button', { name: '私有安装 Codex' }));

    await waitFor(() =>
      expect(kernelUpdates.installUpdate).toHaveBeenCalledWith({ kernelId: 'codex' }),
    );
  });

  it('does not present an already activated version as a reinstall action', async () => {
    kernelUpdates.getState.mockResolvedValueOnce({
      ...state,
      items: state.items.map((item) =>
        item.kernelId === 'claude-code'
          ? { ...item, latestVersion: '2.1.241', phase: 'up-to-date' as const }
          : item,
      ),
    });

    render(<KernelUpdatePanel />);

    const button = await screen.findByRole('button', { name: '已是最新 Claude Code' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
