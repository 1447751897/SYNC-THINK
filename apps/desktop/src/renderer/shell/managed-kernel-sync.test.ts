import { describe, expect, it } from 'vitest';
import type { ManagedKernelUpdateSnapshot } from '../../kernel-update-contract.js';
import { applyManagedKernelSnapshotToInstallStates } from './managed-kernel-sync.js';

const snapshot = (
  phase: ManagedKernelUpdateSnapshot['items'][number]['phase'],
  errorCode: string | null = null,
): ManagedKernelUpdateSnapshot => ({
  schemaVersion: 1,
  installerAvailable: true,
  checkedAt: null,
  items: [
    {
      kernelId: 'codex',
      name: 'Codex',
      packageName: '@openai/codex',
      managedVersion: phase === 'installed' ? '0.151.0' : null,
      latestVersion: '0.151.0',
      phase,
      errorCode,
    },
  ],
});

describe('applyManagedKernelSnapshotToInstallStates', () => {
  it('marks installing private kernels so the picker can show progress', () => {
    expect(applyManagedKernelSnapshotToInstallStates({}, snapshot('installing'))).toEqual({
      codex: { status: 'installing' },
    });
  });

  it('promotes an in-flight install to success once the private version is active', () => {
    expect(
      applyManagedKernelSnapshotToInstallStates(
        { codex: { status: 'installing' } },
        snapshot('installed'),
      ),
    ).toEqual({
      codex: { status: 'success' },
    });
  });

  it('clears a leftover picker error after the private kernel is actually activated', () => {
    expect(
      applyManagedKernelSnapshotToInstallStates(
        { pi: { status: 'error', error: 'kernel.update.install-failed' } },
        {
          schemaVersion: 1,
          installerAvailable: true,
          checkedAt: null,
          items: [
            {
              kernelId: 'pi',
              name: 'Pi',
              packageName: '@earendil-works/pi-coding-agent',
              managedVersion: '0.84.4',
              latestVersion: '0.84.4',
              phase: 'installed',
              errorCode: null,
            },
          ],
        },
      ),
    ).toEqual({
      pi: { status: 'success' },
    });
  });

  it('treats an already managed kernel as installed even when a newer version is available', () => {
    expect(
      applyManagedKernelSnapshotToInstallStates(
        { pi: { status: 'error', error: '安装完成，但仍未检测到内核' } },
        {
          schemaVersion: 1,
          installerAvailable: true,
          checkedAt: null,
          items: [
            {
              kernelId: 'pi',
              name: 'Pi',
              packageName: '@earendil-works/pi-coding-agent',
              managedVersion: '0.84.4',
              latestVersion: '0.90.0',
              phase: 'available',
              errorCode: null,
            },
          ],
        },
      ),
    ).toEqual({
      pi: { status: 'success' },
    });
  });
});
