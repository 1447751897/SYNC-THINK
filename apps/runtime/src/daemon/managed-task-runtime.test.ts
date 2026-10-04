import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteScheduledTaskStore } from '@sync-think/storage';
import type { ScheduledTask } from '@sync-think/shared';
import { TaskConcurrencyManager } from './queue.js';
import { DispatchedTracker } from './interrupt.js';
import {
  chooseScheduledTaskDispatchPath,
  executeScheduledTaskDispatch,
  shouldUseManagedTaskRuntime,
  type ScheduledTaskDispatchPorts,
} from './dispatch.js';

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'scheduled-1',
    name: 'closed-window task',
    instruction: 'execute selected capabilities',
    target: { kind: 'model', modelId: 'model-1' },
    rule: { kind: 'every', intervalMinutes: 60 },
    timeZone: 'Asia/Shanghai',
    enabled: true,
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
    ...overrides,
  };
}

function fixture(scheduled: ScheduledTask, overrides: Partial<ScheduledTaskDispatchPorts> = {}) {
  const manager = new TaskConcurrencyManager({ maxConcurrent: 1, enqueue: () => true });
  expect(manager.acquire(scheduled.id)).toBe(true);
  const tracker = new DispatchedTracker();
  let completion: (() => void) | undefined;
  const releaseSlot = vi.fn(() => manager.release(scheduled.id));
  const ensureRuntime = vi.fn(async () => true);
  const dispatch = vi.fn(async () => ({ ok: true, acked: true, outcome: 'accepted' as const }));
  const spawnWorker = vi.fn(async () => {});
  const recordFailure = vi.fn();
  const ports: ScheduledTaskDispatchPorts = {
    ensureRuntime,
    dispatch,
    spawnWorker,
    recordFailure,
    releaseSlot,
    registerDispatch: (release) => {
      tracker.add(scheduled.id, new Date('2026-10-02T00:00:00Z'));
      completion = release;
    },
    clearDispatch: () => {
      tracker.markCompleted(scheduled.id);
      completion = undefined;
    },
    ...overrides,
  };
  return {
    manager,
    tracker,
    ports,
    ensureRuntime,
    dispatch,
    spawnWorker,
    recordFailure,
    releaseSlot,
    complete: () => {
      tracker.markCompleted(scheduled.id);
      completion?.();
      completion = undefined;
    },
  };
}

const actors: ScheduledTask['target'][] = [
  { kind: 'model', modelId: 'model-1' },
  { kind: 'agent', agentId: 'agent-1' },
  { kind: 'team', teamId: 'team-1' },
];

describe('closed Desktop window uses the managed Runtime pipe', () => {
  for (const target of actors) {
    it.each([false, true])(
      'ensures and dispatches ' + target.kind + ' with browser=%s to the long-lived owner',
      async (browser) => {
        const scheduled = task({
          target,
          ...(browser ? { automation: { browser: { profileId: 'profile-1' } } } : {}),
        });
        const f = fixture(scheduled);
        expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
          kind: 'dispatched',
        });
        expect(f.ensureRuntime).toHaveBeenCalledOnce();
        expect(f.dispatch).toHaveBeenCalledWith(
          expect.objectContaining({ taskId: scheduled.id, target }),
        );
        expect(f.spawnWorker).not.toHaveBeenCalled();
        expect(f.manager.isRunning(scheduled.id)).toBe(true);
        f.complete();
        expect(f.manager.activeCount()).toBe(0);
        expect(f.releaseSlot).toHaveBeenCalledOnce();
      },
    );
  }

  it('requires managed ownership for group-bound tasks even without team/automation', async () => {
    const scheduled = task({ conversationId: 'explicit-group' });
    const f = fixture(scheduled, { groupBound: true, ensureRuntime: async () => false });
    expect(shouldUseManagedTaskRuntime(scheduled, true)).toBe(true);
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
      kind: 'failed',
      reason: 'managed-runtime-unavailable',
    });
    expect(f.spawnWorker).not.toHaveBeenCalled();
    expect(f.recordFailure).toHaveBeenCalledWith('managed-runtime-unavailable');
    expect(f.manager.activeCount()).toBe(0);
    expect(f.releaseSlot).toHaveBeenCalledOnce();
  });

  it.each([
    task({ target: { kind: 'team', teamId: 'team-1' } }),
    task({
      target: { kind: 'model', modelId: 'model-1' },
      automation: { browser: { profileId: 'profile-1' } },
    }),
    task({ target: { kind: 'agent', agentId: 'agent-1' }, automation: {} }),
  ])(
    'records failed startup and releases without creating a transient second owner: %j',
    async (scheduled) => {
      const f = fixture(scheduled, { ensureRuntime: async () => false });
      expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
        kind: 'failed',
        reason: 'managed-runtime-unavailable',
      });
      expect(f.dispatch).not.toHaveBeenCalled();
      expect(f.spawnWorker).not.toHaveBeenCalled();
      expect(f.recordFailure).toHaveBeenCalledOnce();
      expect(f.manager.activeCount()).toBe(0);
      expect(f.manager.acquire('next-queued-task')).toBe(true);
    },
  );

  it.each(actors.slice(0, 2))(
    'retains plain $kind worker fallback only when managed startup is unavailable',
    async (target) => {
      const scheduled = task({ target, conversationId: 'ordinary-private-conversation' });
      const f = fixture(scheduled, { ensureRuntime: async () => false });
      expect(shouldUseManagedTaskRuntime(scheduled)).toBe(false);
      expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
        kind: 'spawn-worker',
      });
      expect(f.spawnWorker).toHaveBeenCalledWith(scheduled);
      expect(f.recordFailure).not.toHaveBeenCalled();
      expect(f.manager.activeCount()).toBe(0);
      expect(f.releaseSlot).toHaveBeenCalledOnce();
    },
  );

  it('makes the pure decision fail closed for managed tasks while preserving legacy routing', () => {
    expect(chooseScheduledTaskDispatchPath(task(), true)).toEqual({ kind: 'dispatched' });
    expect(chooseScheduledTaskDispatchPath(task(), false)).toEqual({ kind: 'spawn-worker' });
    expect(chooseScheduledTaskDispatchPath(task({ automation: {} }), false)).toEqual({
      kind: 'failed',
      reason: 'managed-runtime-unavailable',
    });
  });
});

describe('managed Runtime failure and slot lifecycle', () => {
  it('releases exactly once when the supervised Runtime throws during startup', async () => {
    const scheduled = task({ target: { kind: 'team', teamId: 'team-1' } });
    const f = fixture(scheduled, {
      ensureRuntime: async () => {
        throw new Error('cold start failed');
      },
    });
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
      kind: 'failed',
      reason: 'scheduled-task-ensure-failed: cold start failed',
    });
    expect(f.spawnWorker).not.toHaveBeenCalled();
    expect(f.tracker.listPending()).toEqual([]);
    expect(f.recordFailure).toHaveBeenCalledOnce();
    expect(f.manager.activeCount()).toBe(0);
    expect(f.releaseSlot).toHaveBeenCalledOnce();
  });

  it.each([
    task(),
    task({ target: { kind: 'team', teamId: 'team-1' } }),
    task({ automation: { browser: { profileId: 'profile-1' } } }),
  ])('does not create a second owner on unknown ack outcome: %j', async (scheduled) => {
    const f = fixture(scheduled, {
      dispatch: async () => ({ ok: true, acked: false, outcome: 'timeout' }),
    });
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
      kind: 'failed',
      reason: 'runtime-dispatch-outcome-unknown',
    });
    expect(f.spawnWorker).not.toHaveBeenCalled();
    expect(f.recordFailure).toHaveBeenCalledWith('runtime-dispatch-outcome-unknown');
    expect(f.tracker.listPending()).toEqual([]);
    expect(f.manager.activeCount()).toBe(0);
    expect(f.releaseSlot).toHaveBeenCalledOnce();
  });

  it('does not start a Host-less worker when managed dispatch becomes unreachable after ensure', async () => {
    const scheduled = task({
      target: { kind: 'agent', agentId: 'agent-1' },
      automation: { browser: { profileId: 'p1' } },
    });
    const f = fixture(scheduled, {
      dispatch: async () => ({ ok: false, acked: false, outcome: 'unreachable' }),
    });
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
      kind: 'failed',
      reason: 'managed-runtime-dispatch-unreachable',
    });
    expect(f.spawnWorker).not.toHaveBeenCalled();
    expect(f.manager.activeCount()).toBe(0);
    expect(f.tracker.listPending()).toEqual([]);
  });

  it('does not treat an unreachable-after-write result as safe legacy takeover', async () => {
    const scheduled = task();
    const f = fixture(scheduled, {
      dispatch: async () => ({ ok: false, acked: false, outcome: 'unreachable' }),
    });
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
      kind: 'failed',
      reason: 'runtime-dispatch-unreachable',
    });
    expect(f.spawnWorker).not.toHaveBeenCalled();
    expect(f.manager.activeCount()).toBe(0);
  });

  it('records explicit runtime rejection without falling back or retaining the slot', async () => {
    const scheduled = task({ target: { kind: 'team', teamId: 'team-1' } });
    const f = fixture(scheduled, {
      dispatch: async () => ({
        ok: true,
        acked: false,
        outcome: 'rejected',
        reason: 'group unavailable',
      }),
    });
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
      kind: 'failed',
      reason: 'runtime-dispatch-rejected: group unavailable',
    });
    expect(f.recordFailure).toHaveBeenCalledWith('runtime-dispatch-rejected: group unavailable');
    expect(f.spawnWorker).not.toHaveBeenCalled();
    expect(f.tracker.listPending()).toEqual([]);
    expect(f.releaseSlot).toHaveBeenCalledOnce();
  });

  it('clears pre-ack registration and releases the slot when dispatch throws', async () => {
    const scheduled = task({ automation: {} });
    const f = fixture(scheduled, {
      dispatch: async () => {
        throw new Error('socket error');
      },
    });
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
      kind: 'failed',
      reason: 'scheduled-task-dispatch-failed: socket error',
    });
    expect(f.spawnWorker).not.toHaveBeenCalled();
    expect(f.tracker.listPending()).toEqual([]);
    expect(f.manager.activeCount()).toBe(0);
    expect(f.releaseSlot).toHaveBeenCalledOnce();
  });

  it('handles task.dispatch.complete before ack without a stale retained slot', async () => {
    const scheduled = task({ target: { kind: 'team', teamId: 'team-1' } });
    const f = fixture(scheduled);
    f.ports.dispatch = async () => {
      expect(f.tracker.listPending()).toEqual([scheduled.id]);
      f.complete();
      return { ok: true, acked: true, outcome: 'accepted' };
    };
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({ kind: 'dispatched' });
    expect(f.manager.activeCount()).toBe(0);
    expect(f.tracker.listPending()).toEqual([]);
    expect(f.releaseSlot).toHaveBeenCalledOnce();
    expect(f.spawnWorker).not.toHaveBeenCalled();
  });

  it('holds an accepted slot until completion and ignores duplicate complete callbacks', async () => {
    const scheduled = task({ automation: {} });
    let complete: (() => void) | undefined;
    const f = fixture(scheduled, {
      registerDispatch: (release) => {
        complete = release;
      },
    });
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({ kind: 'dispatched' });
    expect(f.manager.activeCount()).toBe(1);
    complete?.();
    complete?.();
    expect(f.manager.activeCount()).toBe(0);
    expect(f.releaseSlot).toHaveBeenCalledOnce();
  });

  it('records a failed legacy worker spawn and frees the next queued slot', async () => {
    const scheduled = task();
    const f = fixture(scheduled, {
      ensureRuntime: async () => false,
      spawnWorker: async () => {
        throw new Error('entry not found');
      },
    });
    expect(await executeScheduledTaskDispatch(scheduled, f.ports)).toEqual({
      kind: 'failed',
      reason: 'scheduled-task-worker-failed: entry not found',
    });
    expect(f.manager.activeCount()).toBe(0);
    expect(f.recordFailure).toHaveBeenCalledOnce();
    expect(f.manager.acquire('next-task')).toBe(true);
  });
});

it('durably records failed startup/history while releasing the acquired daemon slot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-think-daemon-managed-failure-'));
  const dbPath = join(dir, 'fixture.db');
  try {
    await runMigrations(dbPath);
    const connection = await openDatabaseAsync({ path: dbPath });
    try {
      const store = new SqliteScheduledTaskStore(connection.raw);
      const scheduled = store.create(
        task({ target: { kind: 'team', teamId: 'team-1' }, automation: {} }),
      );
      const f = fixture(scheduled, {
        ensureRuntime: async () => false,
        recordFailure: (reason) => {
          const result = { status: 'failed' as const, firedAt: '2026-10-02T00:00:00Z', reason };
          store.addHistoryEntry({ id: 'startup-failed-1', taskId: scheduled.id, ...result });
          store.update(scheduled.id, { lastResult: result });
        },
      });
      await executeScheduledTaskDispatch(scheduled, f.ports);
      expect(store.get(scheduled.id)?.lastResult).toEqual({
        status: 'failed',
        firedAt: '2026-10-02T00:00:00Z',
        reason: 'managed-runtime-unavailable',
      });
      expect(store.listHistory(scheduled.id)).toEqual([
        expect.objectContaining({ status: 'failed', reason: 'managed-runtime-unavailable' }),
      ]);
      expect(f.spawnWorker).not.toHaveBeenCalled();
      expect(f.manager.activeCount()).toBe(0);
      expect(f.releaseSlot).toHaveBeenCalledOnce();
    } finally {
      connection.raw.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
