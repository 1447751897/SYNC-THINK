import { describe, expect, it } from 'vitest';
import {
  buildDaemonAutostartCommand,
  buildDaemonRegistryAutostartCommand,
  buildManagedRuntimeEnvironment,
  buildRuntimeSpawnOptions,
  daemonRestartDelayMs,
  managedRuntimeCommandLineMatches,
  resolveDaemonAutostartStartupAction,
} from './runtime-supervisor.js';

// Existing spawn contracts remain deliberately pure so lifecycle changes can
// be checked without creating real detached processes in unit tests.
describe('buildRuntimeSpawnOptions', () => {
  it('makes the Runtime independent from the Desktop process lifetime', () => {
    expect(buildRuntimeSpawnOptions()).toMatchObject({
      detached: true,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
  });
});

describe('daemon supervised restart', () => {
  it('uses bounded backoff independent from the cold-start spawn debounce', () => {
    expect(daemonRestartDelayMs(1)).toBe(1_000);
    expect(daemonRestartDelayMs(2)).toBe(2_000);
    expect(daemonRestartDelayMs(10)).toBe(5_000);
  });
});

describe('daemon autostart default', () => {
  it('enables on first run, repairs an enabled registration, and preserves opt-out', () => {
    expect(resolveDaemonAutostartStartupAction(undefined, false)).toBe('enable');
    expect(resolveDaemonAutostartStartupAction(true, false)).toBe('enable');
    expect(resolveDaemonAutostartStartupAction(true, true)).toBe('none');
    expect(resolveDaemonAutostartStartupAction(false, false)).toBe('none');
    expect(resolveDaemonAutostartStartupAction(false, true)).toBe('disable');
  });
});

describe('managed Runtime identity matching', () => {
  it('requires an exact role and install marker token', () => {
    expect(
      managedRuntimeCommandLineMatches(
        'node runtime.js sync-think-managed-runtime=install-managed',
        'install-managed',
      ),
    ).toBe(true);
    expect(
      managedRuntimeCommandLineMatches(
        'node helper.js --note=sync-think-managed-runtime=install-managed',
        'install-managed',
      ),
    ).toBe(false);
    expect(
      managedRuntimeCommandLineMatches(
        'node runtime.js sync-think-managed-runtime=other-install',
        'install-managed',
      ),
    ).toBe(false);
  });
});

describe('buildManagedRuntimeEnvironment', () => {
  it('passes the exact packaged install id and pipe secret to Runtime with no-token disabled', () => {
    const environment = buildManagedRuntimeEnvironment(
      {
        installId: 'install-managed',
        pipeSecret: 'managed-secret-xxxxxxxxxxxxxxxxxxxxxx',
        allowNoToken: false,
      },
      {
        PATH: 'fixture-path',
        SYNC_THINK_INSTALL_ID: 'stale-install',
        SYNC_THINK_PIPE_SECRET: 'stale-secret',
        SYNC_THINK_DEV_NO_TOKEN: '1',
      },
      'D:\\fixture-data',
    );

    expect(environment).toMatchObject({
      PATH: 'fixture-path',
      SYNC_THINK_INSTALL_ID: 'install-managed',
      SYNC_THINK_PIPE_SECRET: 'managed-secret-xxxxxxxxxxxxxxxxxxxxxx',
      SYNC_THINK_DEV_NO_TOKEN: '0',
      SYNC_THINK_DB_PATH: 'D:\\fixture-data\\sync-think.db',
    });
  });

  it('removes inherited pipe secrets for development no-token identities', () => {
    const environment = buildManagedRuntimeEnvironment(
      { installId: 'dev-0001', allowNoToken: true },
      { SYNC_THINK_PIPE_SECRET: 'must-not-leak', ELECTRON_RUN_AS_NODE: '1' },
      'D:\\fixture-data',
    );

    expect(environment.SYNC_THINK_INSTALL_ID).toBe('dev-0001');
    expect(environment.SYNC_THINK_DEV_NO_TOKEN).toBe('1');
    expect(environment.SYNC_THINK_PIPE_SECRET).toBeUndefined();
    expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it('keeps daemon autostart identity in a bootstrap path instead of argv', () => {
    const command = buildDaemonAutostartCommand(
      'C:\\node\\node.exe',
      'C:\\runtime\\daemon\\index.js',
      'C:\\Users\\fixture\\daemon-bootstrap.json',
      'install-managed',
    );

    expect(command).toContain('--bootstrap');
    expect(command).toContain('daemon-bootstrap.json');
    expect(command).toContain('sync-think-managed-daemon=install-managed');
    expect(command).not.toContain('pipe-secret');
  });

  it('builds the user registry fallback from the same secret-free bootstrap command', () => {
    const command = buildDaemonRegistryAutostartCommand(
      'C:\\node\\node.exe',
      'C:\\runtime\\daemon\\index.js',
      'C:\\Users\\fixture\\daemon-bootstrap.json',
      'install-managed',
    );

    expect(command).toBe(
      '"C:\\node\\node.exe" "C:\\runtime\\daemon\\index.js" --bootstrap "C:\\Users\\fixture\\daemon-bootstrap.json" sync-think-managed-daemon=install-managed',
    );
    expect(command).not.toContain('pipe-secret');
  });
});
