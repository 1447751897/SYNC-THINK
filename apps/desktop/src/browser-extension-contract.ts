/**
 * Desktop-side contract for the NewMax-compatible Chrome extension bridge.
 *
 * The Runtime owns the WebSocket host and returns this snapshot to the main
 * process. Keeping the normalization here lets the renderer remain stable
 * while the host is upgraded independently.
 */

import type {
  BrowserExtensionConnectionInfo,
  BrowserExtensionConnectionState,
  BrowserExtensionStatus,
} from '@sync-think/protocol';

export type {
  BrowserExtensionConnectionInfo,
  BrowserExtensionConnectionState,
  BrowserExtensionOpenFolderResult,
  BrowserExtensionStatus,
} from '@sync-think/protocol';

export const DEFAULT_BROWSER_EXTENSION_URL = 'ws://127.0.0.1:17374/browser-extension/v1';

export const BROWSER_EXTENSION_CONNECTION_STATES = [
  'disabled',
  'connecting',
  'connected',
  'disconnected',
  'version-mismatch',
  'authentication-failed',
  'protocol-mismatch',
] as const;

export const DEFAULT_BROWSER_EXTENSION_STATUS: BrowserExtensionStatus = {
  state: 'disconnected',
  hostAvailable: false,
  connected: false,
  installedVersion: null,
  versionMismatch: false,
  busy: false,
  lastErrorCode: null,
  connectionInfo: null,
};

export function isBrowserExtensionConnectionState(
  value: unknown,
): value is BrowserExtensionConnectionState {
  return (
    typeof value === 'string' &&
    (BROWSER_EXTENSION_CONNECTION_STATES as readonly string[]).includes(value)
  );
}

/** Normalize Runtime snapshots, including older hosts that omit `state`. */
export function normalizeBrowserExtensionStatus(value: unknown): BrowserExtensionStatus {
  if (!value || typeof value !== 'object') return DEFAULT_BROWSER_EXTENSION_STATUS;

  const record = value as Record<string, unknown>;
  const hostAvailable = record.hostAvailable === true;
  const connected = record.connected === true;
  const versionMismatch = record.versionMismatch === true;
  const installedVersion =
    typeof record.installedVersion === 'string' && record.installedVersion.trim()
      ? record.installedVersion.trim()
      : null;
  const busy = record.busy === true;
  const lastErrorCode =
    typeof record.lastErrorCode === 'string' && record.lastErrorCode.trim()
      ? record.lastErrorCode.trim()
      : null;
  const state = isBrowserExtensionConnectionState(record.state)
    ? record.state
    : !hostAvailable
      ? 'disconnected'
      : versionMismatch
        ? 'version-mismatch'
        : connected
          ? 'connected'
          : 'disconnected';

  let connectionInfo: BrowserExtensionConnectionInfo | null = null;
  if (record.connectionInfo && typeof record.connectionInfo === 'object') {
    const info = record.connectionInfo as Record<string, unknown>;
    connectionInfo = {
      bundledVersion: typeof info.bundledVersion === 'string' ? info.bundledVersion : '',
      url:
        typeof info.url === 'string' && info.url.trim() ? info.url : DEFAULT_BROWSER_EXTENSION_URL,
      token: typeof info.token === 'string' ? info.token : '',
    };
  }

  return {
    state,
    hostAvailable,
    connected,
    installedVersion,
    versionMismatch,
    busy,
    lastErrorCode,
    connectionInfo,
  };
}
