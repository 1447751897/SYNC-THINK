import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEV_INSTALL_ID,
  managedProcessMarker,
  matchesManagedProcessCommandLine,
  pipePath,
  PIPE_PREFIX,
  runtimePidFilePath,
} from './pipe.js';

describe('pipe path', () => {
  it('joins prefix and safe installId', () => {
    expect(pipePath('dev-0001')).toBe(`${PIPE_PREFIX}dev-0001`);
  });
  it('rejects unsafe installId', () => {
    expect(() => pipePath('..\\win')).toThrow();
  });
  it('non-empty default', () => {
    expect(DEFAULT_DEV_INSTALL_ID.length).toBeGreaterThan(0);
  });
  it('places the Runtime pid beside the active database', () => {
    expect(runtimePidFilePath('D:\\custom-data\\sync-think.db', 'install-a')).toBe(
      'D:\\custom-data\\runtime-install-a.pid',
    );
    expect(() => runtimePidFilePath(':memory:', 'install-a')).toThrow(
      'persistent database path required',
    );
  });
  it('builds role-specific non-secret process markers', () => {
    expect(managedProcessMarker('runtime', 'install-a')).toBe(
      'sync-think-managed-runtime=install-a',
    );
    expect(managedProcessMarker('daemon', 'install-a')).toBe('sync-think-managed-daemon=install-a');
  });
  it('rejects PID reuse when the target command line lacks the exact marker', () => {
    expect(
      matchesManagedProcessCommandLine(
        'node runtime/main.js sync-think-managed-runtime=install-a',
        'runtime',
        'install-a',
      ),
    ).toBe(true);
    expect(
      matchesManagedProcessCommandLine(
        'node unrelated.js sync-think-managed-runtime=install-b',
        'runtime',
        'install-a',
      ),
    ).toBe(false);
  });
});
