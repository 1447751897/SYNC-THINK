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
  /**
   * Release notes for the pending version, taken from the update feed. Plain
   * text only: the Main process normalizes and caps it before it reaches the
   * renderer, which never interprets it as markup.
   */
  releaseNotes: string | null;
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
