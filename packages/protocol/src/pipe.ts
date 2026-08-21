import { dirname, join } from 'node:path';
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

/** Runtime/daemon process identity files share the active database directory. */
export function runtimePidFilePath(databasePath: string, installId: string): string {
  if (!databasePath || databasePath === ':memory:') {
    throw new Error('persistent database path required for Runtime pid file');
  }
  // Reuse the same install-id validation as the pipe namespace.
  pipePath(installId);
  return join(dirname(databasePath), `runtime-${installId}.pid`);
}

export type ManagedProcessRole = 'runtime' | 'daemon';

export function managedProcessMarker(role: ManagedProcessRole, installId: string): string {
  pipePath(installId);
  return `sync-think-managed-${role}=${installId}`;
}

export function matchesManagedProcessCommandLine(
  commandLine: string | undefined,
  role: ManagedProcessRole,
  installId: string,
): boolean {
  if (!commandLine) return false;
  const expected = managedProcessMarker(role, installId);
  return commandLine
    .split(/\s+/u)
    .map((token) => token.replace(/^["']|["']$/gu, ''))
    .includes(expected);
}

export const DEFAULT_DEV_INSTALL_ID = 'dev-0001';
