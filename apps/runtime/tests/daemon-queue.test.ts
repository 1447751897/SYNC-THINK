import { describe, expect, it } from 'vitest';
import { TaskConcurrencyManager } from '../src/daemon/queue.js';

// ── TaskConcurrencyManager：信号量 + 排队 ─────────────────────────────────

describe('TaskConcurrencyManager', () => {
  it('allows tasks up to the concurrency limit immediately', () => {
    const manager = new TaskConcurrencyManager({ maxConcurrent: 2, enqueue: () => {} });
    expect(manager.acquire('t_1')).toBe(true);
    expect(manager.acquire('t_2')).toBe(true);
    expect(manager.acquire('t_3')).toBe(false); // 超限
    expect(manager.activeCount()).toBe(2);
  });

  it('queues tasks beyond the limit and dequeues when a slot frees', () => {
    const queued: string[] = [];
    const manager = new TaskConcurrencyManager({
      maxConcurrent: 1,
      enqueue: (taskId) => queued.push(taskId),
    });
    manager.acquire('t_1');
    expect(manager.acquire('t_2')).toBe(false);
    expect(queued).toEqual(['t_2']);
    // t_1 完成 → 释放槽位。
    manager.release('t_1');
    expect(manager.activeCount()).toBe(0);
  });

  it('tracks running state per task (re-entry detection)', () => {
    const manager = new TaskConcurrencyManager({ maxConcurrent: 2, enqueue: () => {} });
    manager.acquire('t_1');
    expect(manager.isRunning('t_1')).toBe(true);
    expect(manager.isRunning('t_2')).toBe(false);
    manager.release('t_1');
    expect(manager.isRunning('t_1')).toBe(false);
  });

  it('release removes the task and frees its slot', () => {
    const manager = new TaskConcurrencyManager({ maxConcurrent: 2, enqueue: () => {} });
    manager.acquire('t_1');
    manager.release('t_1');
    expect(manager.activeCount()).toBe(0);
    expect(manager.acquire('t_2')).toBe(true);
  });

  it('does not double-acquire the same task', () => {
    const manager = new TaskConcurrencyManager({ maxConcurrent: 2, enqueue: () => {} });
    expect(manager.acquire('t_1')).toBe(true);
    expect(manager.acquire('t_1')).toBe(false);
    expect(manager.activeCount()).toBe(1);
  });

  it('supports changing the concurrency limit at runtime', () => {
    const manager = new TaskConcurrencyManager({ maxConcurrent: 1, enqueue: () => {} });
    manager.acquire('t_1');
    expect(manager.acquire('t_2')).toBe(false);
    manager.setMaxConcurrent(2);
    expect(manager.acquire('t_2')).toBe(true);
  });
});
