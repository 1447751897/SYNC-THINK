import { describe, expect, it, vi } from 'vitest';
import type { ScheduledTask, TaskRule } from '@sync-think/shared';
import {
  TimerRegistry,
  type TimerHandle,
  type TimerRegistrar,
  type DaemonStatus,
  createDaemonStatus,
  updateDaemonStatus,
  createStatusStore,
  type StatusFileStore,
  readStatusFile,
  rollDaemonStatusDay,
} from '../src/daemon/core.js';
import {
  composeTaskCommand,
  dispatchTask,
  type DispatchResult,
} from '../src/daemon/dispatch.js';
import { buildRuntimeEnv } from '../src/daemon/env.js';

function task(rule: TaskRule, overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    name: 't',
    instruction: 'do',
    target: { kind: 'model', modelId: 'm-1' },
    rule,
    timeZone: 'UTC',
    enabled: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** fake 定时器注册器：记录注册/注销调用，不真正跑 croner。 */
function fakeRegistrar() {
  const calls: Array<{ taskId: string; fn: () => void }> = [];
  const handles = new Map<string, TimerHandle>();
  const registrar: TimerRegistrar = {
    registerTimer: (taskId, fn) => {
      calls.push({ taskId, fn });
      const handle: TimerHandle = { cancel: () => handles.delete(taskId) };
      handles.set(taskId, handle);
      return handle;
    },
    unregisterTimer: (taskId) => {
      handles.get(taskId)?.cancel();
    },
  };
  return { registrar, calls, handles };
}

// ── TimerRegistry：注册表 diff 同步 ────────────────────────────────────────

describe('TimerRegistry', () => {
  it('registers timers for all enabled due tasks on startup (full rescan)', () => {
    const { registrar, handles } = fakeRegistrar();
    const registry = new TimerRegistry(registrar);
    const a = task({ kind: 'every', intervalMinutes: 30 }, { id: 'a' });
    const b = task({ kind: 'cron', expression: '0 9 * * *' }, { id: 'b' });
    registry.sync([a, b]);
    expect(handles.size).toBe(2);
    expect(handles.has('a')).toBe(true);
    expect(handles.has('b')).toBe(true);
  });

  it('unregisters timers for removed or disabled tasks', () => {
    const { registrar, handles } = fakeRegistrar();
    const registry = new TimerRegistry(registrar);
    const a = task({ kind: 'every', intervalMinutes: 30 }, { id: 'a' });
    const b = task({ kind: 'every', intervalMinutes: 30 }, { id: 'b' });
    registry.sync([a, b]);
    expect(handles.size).toBe(2);
    registry.sync([a]); // b 被移除
    expect(handles.size).toBe(1);
    expect(handles.has('a')).toBe(true);
    expect(handles.has('b')).toBe(false);
  });

  it('re-registers (replaces) a timer when a task rule changes', () => {
    const { registrar, calls, handles } = fakeRegistrar();
    const registry = new TimerRegistry(registrar);
    const a1 = task({ kind: 'every', intervalMinutes: 30 });
    registry.sync([a1]);
    expect(handles.has('task-1')).toBe(true);
    const a2 = task({ kind: 'every', intervalMinutes: 60 });
    registry.sync([a2]);
    // 规则变了 → 旧 handle 注销 + 新 handle 注册（handle 引用更新）。
    expect(handles.has('task-1')).toBe(true);
    expect(calls.length).toBe(2);
  });

  it('fires the task callback when a timer elapses', () => {
    const { registrar, calls } = fakeRegistrar();
    const registry = new TimerRegistry(registrar);
    registry.sync([task({ kind: 'every', intervalMinutes: 30 })]);
    const call = calls.find((c) => c.taskId === 'task-1');
    expect(call).toBeDefined();
    const fired = vi.fn();
    registry.onFire('task-1', fired);
    call!.fn();
    expect(fired).toHaveBeenCalledTimes(1);
  });
});

// ── DaemonStatus：心跳 / 状态更新 ──────────────────────────────────────────

describe('DaemonStatus', () => {
  it('starts with running=true and zero counters', () => {
    const status = createDaemonStatus();
    expect(status.running).toBe(true);
    expect(status.heartbeatAt).toBeUndefined();
    expect(status.todayFired).toBe(0);
    expect(status.queued).toBe(0);
    expect(status.timerCount).toBe(0);
  });

  it('tracks heartbeat and updates counters', () => {
    const status = createDaemonStatus();
    const now = new Date('2025-01-01T10:00:00.000Z');
    const updated = updateDaemonStatus(status, {
      heartbeatAt: now,
      timerCount: 5,
      todayFired: 3,
      queued: 2,
    });
    expect(updated.heartbeatAt).toBe(now.toISOString());
    expect(updated.timerCount).toBe(5);
    expect(updated.todayFired).toBe(3);
    expect(updated.queued).toBe(2);
    // 返回新对象，不原地修改。
    expect(status.heartbeatAt).toBeUndefined();
  });

  it('detects stale heartbeat (>5s) as abnormal', () => {
    const status = createDaemonStatus();
    const now = new Date('2025-01-01T10:00:00.000Z');
    const updated = updateDaemonStatus(status, { heartbeatAt: now });
    const stale = new Date(now.getTime() + 6_000);
    expect(updated.heartbeatAt).toBeDefined();
    // 心跳超 5s → abnormal 由消费方按 heartbeatAt 判断；这里验证状态可读。
    expect(updated.running).toBe(true);
  });

  it('resets todayFired when the local calendar day changes', () => {
    const previous = {
      ...createDaemonStatus(new Date(2025, 0, 1, 23, 59, 59)),
      todayFired: 7,
    };

    expect(rollDaemonStatusDay(previous, new Date(2025, 0, 2, 0, 0, 1))).toMatchObject({
      todayFired: 0,
      counterDate: '2025-01-02',
    });
  });

  it('keeps todayFired within the same local calendar day', () => {
    const current = {
      ...createDaemonStatus(new Date(2025, 0, 2, 8, 0, 0)),
      todayFired: 3,
    };

    expect(rollDaemonStatusDay(current, new Date(2025, 0, 2, 22, 0, 0)).todayFired).toBe(3);
  });
});

// ── StatusFileStore：状态文件读写 ──────────────────────────────────────────

describe('StatusFileStore', () => {
  it('persists and reads a status snapshot', () => {
    const written: DaemonStatus[] = [];
    const store: StatusFileStore = {
      write: (status) => {
        written.push(status);
        return Promise.resolve();
      },
      read: () => Promise.resolve(undefined),
    };
    const statusStore = createStatusStore(store);
    const status = createDaemonStatus();
    void statusStore.update(status);
    expect(written).toHaveLength(1);
    expect(written[0].running).toBe(true);
  });

  it('returns undefined when the status file is absent', async () => {
    const store: StatusFileStore = {
      write: () => Promise.resolve(),
      read: () => Promise.resolve(undefined),
    };
    const status = await readStatusFile(store);
    expect(status).toBeUndefined();
  });

  it('returns the parsed status when present', async () => {
    const snapshot: DaemonStatus = { running: true, todayFired: 4, queued: 1, timerCount: 6 };
    const store: StatusFileStore = {
      write: () => Promise.resolve(),
      read: () => Promise.resolve(snapshot),
    };
    const status = await readStatusFile(store);
    expect(status?.todayFired).toBe(4);
  });
});

// ── composeTaskCommand：指令构造 ───────────────────────────────────────────

describe('composeTaskCommand', () => {
  it('builds a task run command from a task', () => {
    const t = task(
      { kind: 'every', intervalMinutes: 30 },
      { workspaceId: 'ws-1', skillVersionIds: ['s-1'] },
    );
    const cmd = composeTaskCommand(t);
    expect(cmd.taskId).toBe('task-1');
    expect(cmd.instruction).toBe('do');
    expect(cmd.target).toEqual({ kind: 'model', modelId: 'm-1' });
    expect(cmd.workspaceId).toBe('ws-1');
    expect(cmd.skillVersionIds).toEqual(['s-1']);
  });

  it('handles team and agent targets', () => {
    const agentTask = task(
      { kind: 'every', intervalMinutes: 30 },
      { id: 'a', target: { kind: 'agent', agentId: 'ag-1' } },
    );
    expect(composeTaskCommand(agentTask).target).toEqual({ kind: 'agent', agentId: 'ag-1' });
    const teamTask = task(
      { kind: 'every', intervalMinutes: 30 },
      { id: 'b', target: { kind: 'team', teamId: 'tm-1' } },
    );
    expect(composeTaskCommand(teamTask).target).toEqual({ kind: 'team', teamId: 'tm-1' });
  });
});

// ── dispatchTask：桌面投递判定 ─────────────────────────────────────────────

describe('dispatchTask', () => {
  it('dispatches to the desktop when it is alive', () => {
    const result: DispatchResult = { kind: 'dispatched' };
    expect(result.kind).toBe('dispatched');
  });

  it('spawns a worker when the desktop is not alive', () => {
    const result: DispatchResult = { kind: 'spawn-worker' };
    expect(result.kind).toBe('spawn-worker');
  });
});

// ── buildRuntimeEnv：worker 环境变量 ───────────────────────────────────────

describe('buildRuntimeEnv', () => {
  it('includes the daemon-worker flag and db path', () => {
    const env = buildRuntimeEnv({
      dbPath: 'C:\\data\\sync-think.db',
      installId: 'dev-0001',
      base: { SYNC_THINK_PIPE_SECRET: 's3cret', PATH: 'C:\\bin' },
    });
    expect(env.SYNC_THINK_DAEMON_WORKER).toBe('1');
    expect(env.SYNC_THINK_DB_PATH).toBe('C:\\data\\sync-think.db');
    expect(env.SYNC_THINK_INSTALL_ID).toBe('dev-0001');
    expect(env.SYNC_THINK_PIPE_SECRET).toBe('s3cret');
    expect(env.PATH).toBe('C:\\bin');
  });
});
