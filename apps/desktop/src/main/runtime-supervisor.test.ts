import { describe, expect, it } from 'vitest';
import { buildManagedRuntimeEnvironment } from './runtime-supervisor.js';

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
});