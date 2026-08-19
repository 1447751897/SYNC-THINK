import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import {
  parseDaemonWorkerEnv,
  buildWorkerCommand,
  runWorkerProcess,
  type WorkerEnvOptions,
} from '../src/daemon/worker.js';

const FIXTURE = join(__dirname, 'fixtures', 'fake-worker.mjs');

describe('parseDaemonWorkerEnv', () => {
  it('detects worker mode with a task id', () => {
    const parsed = parseDaemonWorkerEnv({
      SYNC_THINK_DAEMON_WORKER: '1',
      SYNC_THINK_DAEMON_TASK_ID: 't_xxx',
    });
    expect(parsed).toEqual({ enabled: true, taskId: 't_xxx' });
  });

  it('reports worker mode with no task id as enabled-but-idle', () => {
    const parsed = parseDaemonWorkerEnv({ SYNC_THINK_DAEMON_WORKER: '1' });
    expect(parsed.enabled).toBe(true);
    expect(parsed.taskId).toBeUndefined();
  });

  it('reports non-worker when the flag is unset or not 1', () => {
    expect(parseDaemonWorkerEnv({}).enabled).toBe(false);
    expect(parseDaemonWorkerEnv({ SYNC_THINK_DAEMON_WORKER: '0' }).enabled).toBe(false);
  });
});

describe('buildWorkerCommand', () => {
  const options: WorkerEnvOptions = {
    runtimeEntry: 'C:\\runtime\\main.js',
    taskId: 't_1',
    dbPath: 'C:\\data\\sync-think.db',
    installId: 'dev-0001',
  };

  it('targets the runtime entry with the node binary', () => {
    const cmd = buildWorkerCommand('node', options);
    expect(cmd.command).toBe('node');
    expect(cmd.args).toEqual(['C:\\runtime\\main.js']);
  });

  it('injects daemon-worker flag, task id, db path and install id', () => {
    const cmd = buildWorkerCommand('node', options);
    expect(cmd.env.SYNC_THINK_DAEMON_WORKER).toBe('1');
    expect(cmd.env.SYNC_THINK_DAEMON_TASK_ID).toBe('t_1');
    expect(cmd.env.SYNC_THINK_DB_PATH).toBe('C:\\data\\sync-think.db');
    expect(cmd.env.SYNC_THINK_INSTALL_ID).toBe('dev-0001');
  });

  it('merges base environment without dropping keys', () => {
    const cmd = buildWorkerCommand('node', {
      ...options,
      baseEnv: { SYNC_THINK_PIPE_SECRET: 's3cret', PATH: 'C:\\bin' },
    });
    expect(cmd.env.SYNC_THINK_PIPE_SECRET).toBe('s3cret');
    expect(cmd.env.PATH).toBe('C:\\bin');
  });
});

describe('runWorkerProcess (Seam 3 fixture integration)', () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('runs the fixture worker and returns exit code 0', async () => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-worker-test-'));
    const marker = join(dir, 'marker.json');
    const result = await runWorkerProcess(process.execPath, {
      runtimeEntry: FIXTURE,
      taskId: 't_fixture',
      dbPath: join(dir, 'db.sqlite'),
      installId: 'dev-test',
      baseEnv: { FAKE_WORKER_MARKER: marker, FAKE_WORKER_EXIT: '0' },
    });
    expect(result.code).toBe(0);
    expect(existsSync(marker)).toBe(true);
    const payload = JSON.parse(readFileSync(marker, 'utf8')) as Record<string, unknown>;
    expect(payload.taskId).toBe('t_fixture');
    expect(payload.worker).toBe('1');
  });

  it('propagates a non-zero worker exit code', async () => {
    dir = mkdtempSync(join(tmpdir(), 'daemon-worker-test-'));
    const result = await runWorkerProcess(process.execPath, {
      runtimeEntry: FIXTURE,
      taskId: 't_fail',
      dbPath: join(dir, 'db.sqlite'),
      installId: 'dev-test',
      baseEnv: { FAKE_WORKER_EXIT: '3' },
    });
    expect(result.code).toBe(3);
  });
});
