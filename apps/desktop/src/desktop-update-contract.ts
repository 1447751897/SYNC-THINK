export type DesktopUpdatePhase =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface DesktopUpdateSnapshot {
  schemaVersion: 1;
  phase: DesktopUpdatePhase;
  configured: boolean;
  currentVersion: string;
  channel: string;
  availableVersion: string | null;
  progressPercent: number | null;
  checkedAt: string | null;
  downloadedAt: string | null;
  errorCode: string | null;
}

export interface DesktopUpdateActionResult {
  ok: boolean;
  state: DesktopUpdateSnapshot;
  errorCode: string | null;
}

export interface DesktopUpdateAutoCheckPreference {
  enabled: boolean;
}

export interface DesktopUpdateOpenResult {
  opened: boolean;
  error: string | null;
}
