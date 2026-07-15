import { tmpdir } from 'node:os';

// Named pipe endpoint convention (TD-006 §2): \\.\pipe\sync-think-<installId>
// We use String.raw so backslashes survive verbatim on Windows.
// pipePath returns the Windows named pipe path on win32 and a Unix socket path
// elsewhere for cross-platform dev/test.

export const PIPE_PREFIX = String.raw`\\.\pipe\sync-think-`;

export function pipePath(installId: string): string {
  if (!installId || /[^A-Za-z0-9._-]/.test(installId)) {
    // installId must be path-safe for the Windows named pipe namespace.
    throw Object.assign(new Error('invalid installId for pipe path'), {
      code: 'PROTOCOL_INVALID_INSTALL_ID',
    });
  }
  return `${PIPE_PREFIX}${installId}`;
}

// Returns the named pipe path on Windows; a unix domain socket path elsewhere.
export function pipePathPortable(installId: string): string {
  if (process.platform === 'win32') return pipePath(installId);
  return `${tmpdir()}/sync-think-${installId}.sock`;
}

export const DEFAULT_DEV_INSTALL_ID = 'dev-0001';
