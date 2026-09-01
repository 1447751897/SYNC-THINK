import { useEffect } from 'react';
import type { ManagedKernelUpdateSnapshot } from '../../kernel-update-contract.js';
import type { KernelInstallState } from './compose-toolbar.js';

export function applyManagedKernelSnapshotToInstallStates(
  current: Readonly<Record<string, KernelInstallState | undefined>>,
  snapshot: ManagedKernelUpdateSnapshot,
): Record<string, KernelInstallState | undefined> {
  const next: Record<string, KernelInstallState | undefined> = { ...current };
  for (const item of snapshot.items) {
    if (item.phase === 'installing' || item.phase === 'checking') {
      next[item.kernelId] = { status: 'installing' };
    } else if (
      item.phase === 'installed' ||
      item.phase === 'up-to-date' ||
      (item.phase === 'available' && item.managedVersion)
    ) {
      next[item.kernelId] = { status: 'success' };
    } else if (item.phase === 'error') {
      next[item.kernelId] = {
        status: 'error',
        error: item.errorCode ?? '安装失败',
      };
    }
  }
  return next;
}

export function useManagedKernelUpdateSync(
  onSnapshot: (snapshot: ManagedKernelUpdateSnapshot) => void,
): void {
  useEffect(() => {
    let active = true;
    const bridge = window.syncThink?.kernelUpdates;
    void bridge?.getState?.()?.then((snapshot) => {
      if (active && snapshot) onSnapshot(snapshot);
    });
    const unsubscribe = bridge?.subscribeState?.(onSnapshot);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [onSnapshot]);
}
