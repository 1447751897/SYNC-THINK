import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDaemonBootstrap } from '../src/daemon/bootstrap.js';

const original = {
  installId: process.env.SYNC_THINK_INSTALL_ID,
  dbPath: process.env.SYNC_THINK_DB_PATH,
  noToken: process.env.SYNC_THINK_DEV_NO_TOKEN,
  secret: process.env.SYNC_THINK_PIPE_SECRET,
};

afterEach(() => {
  for (const [key, value] of Object.entries({
    SYNC_THINK_INSTALL_ID: original.installId,
    SYNC_THINK_DB_PATH: original.dbPath,
    SYNC_THINK_DEV_NO_TOKEN: original.noToken,
    SYNC_THINK_PIPE_SECRET: original.secret,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('applyDaemonBootstrap', () => {
  it('loads identity and database settings without requiring a plaintext secret', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sync-think-daemon-bootstrap-'));
    const path = join(dir, 'daemon-bootstrap.json');
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        installId: 'install-bootstrap',
        dbPath: join(dir, 'sync-think.db'),
        allowNoToken: true,
      }),
      'utf8',
    );

    process.env.SYNC_THINK_PIPE_SECRET = 'stale-secret';
    await applyDaemonBootstrap(path);

    expect(process.env.SYNC_THINK_INSTALL_ID).toBe('install-bootstrap');
    expect(process.env.SYNC_THINK_DB_PATH).toBe(join(dir, 'sync-think.db'));
    expect(process.env.SYNC_THINK_DEV_NO_TOKEN).toBe('1');
    expect(process.env.SYNC_THINK_PIPE_SECRET).toBeUndefined();
  });

  it('rejects malformed bootstrap metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sync-think-daemon-bootstrap-invalid-'));
    const path = join(dir, 'daemon-bootstrap.json');
    await writeFile(path, JSON.stringify({ version: 1, installId: '../escape' }), 'utf8');

    await expect(applyDaemonBootstrap(path)).rejects.toThrow('invalid daemon bootstrap');
  });
});
