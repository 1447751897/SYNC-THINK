export type ManagedKernelUpdateId = 'codex' | 'claude-code';

export type ManagedKernelUpdatePhase =
  'idle' | 'checking' | 'available' | 'up-to-date' | 'installing' | 'installed' | 'error';

export interface ManagedKernelUpdateItem {
  kernelId: ManagedKernelUpdateId;
  name: string;
  packageName: string;
  managedVersion: string | null;
  latestVersion: string | null;
  phase: ManagedKernelUpdatePhase;
  errorCode: string | null;
}

export interface ManagedKernelUpdateSnapshot {
  schemaVersion: 1;
  installerAvailable: boolean;
  checkedAt: string | null;
  items: ManagedKernelUpdateItem[];
}

export interface ManagedKernelUpdateActionResult {
  ok: boolean;
  state: ManagedKernelUpdateSnapshot;
  errorCode: string | null;
}

export interface ManagedKernelUpdateBridge {
  getState(): Promise<ManagedKernelUpdateSnapshot>;
  checkForUpdates(): Promise<ManagedKernelUpdateActionResult>;
  installUpdate(payload: {
    kernelId: ManagedKernelUpdateId;
  }): Promise<ManagedKernelUpdateActionResult>;
}
