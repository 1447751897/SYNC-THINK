import { describe, expect, it } from 'vitest';
import {
  classifyInterruption,
  DispatchedTracker,
  applyAbort,
  type InterruptionClassification,
} from '../src/daemon/interrupt.js';

// ── classifyInterruption：中断分类（spec Q10）──────────────────────────────

describe('classifyInterruption', () => {
  it('classifies user-initiated close (abort) as app-closed without retry', () => {
    const c = classifyInterruption({ aborted: true, desktopAlive: false, alreadyRetried: false });
    expect(c).toEqual({ status: 'app-closed', retry: false });
  });

  it('classifies a crash (no abort, desktop dead) as runtime-crash with one retry', () => {
    const c = classifyInterruption({ aborted: false, desktopAlive: false, alreadyRetried: false });
    expect(c).toEqual({ status: 'runtime-crash', retry: true });
  });

  it('does not retry again after a crash retry already happened (terminal)', () => {
    const c = classifyInterruption({ aborted: false, desktopAlive: false, alreadyRetried: true });
    expect(c).toEqual({ status: 'runtime-crash', retry: false });
  });

  it('classifies a live desktop as no interruption', () => {
    const c = classifyInterruption({ aborted: false, desktopAlive: true, alreadyRetried: false });
    expect(c).toEqual({ status: 'none', retry: false });
  });
});

// ── DispatchedTracker：投递任务跟踪 ────────────────────────────────────────

describe('DispatchedTracker', () => {
  it('adds and lists dispatched tasks', () => {
    const tracker = new DispatchedTracker();
    tracker.add('t_1', new Date('2025-01-01T10:00:00.000Z'));
    tracker.add('t_2', new Date('2025-01-01T10:00:05.000Z'));
    expect(tracker.list().map((t) => t.taskId).sort()).toEqual(['t_1', 't_2']);
  });

  it('marks a task aborted (app-closed, no retry)', () => {
    const tracker = new DispatchedTracker();
    tracker.add('t_1', new Date());
    const result = applyAbort(tracker, 't_1');
    expect(result).toEqual({ status: 'app-closed', retry: false });
    expect(tracker.list()).toHaveLength(0); // aborted 即移除，不重试
  });

  it('ignores abort for an unknown task', () => {
    const tracker = new DispatchedTracker();
    const result = applyAbort(tracker, 't_unknown');
    expect(result).toBeNull();
  });

  it('marks completed and removes from tracking', () => {
    const tracker = new DispatchedTracker();
    tracker.add('t_1', new Date());
    tracker.markCompleted('t_1');
    expect(tracker.list()).toHaveLength(0);
  });

  it('tracks retried state per task', () => {
    const tracker = new DispatchedTracker();
    tracker.add('t_1', new Date());
    tracker.markRetried('t_1');
    const entry = tracker.get('t_1');
    expect(entry?.retried).toBe(true);
  });

  it('lists only tasks needing crash evaluation (not completed, not aborted)', () => {
    const tracker = new DispatchedTracker();
    tracker.add('t_1', new Date());
    tracker.add('t_2', new Date());
    tracker.markCompleted('t_2');
    expect(tracker.listPending()).toEqual(['t_1']);
  });
});

// ── 历史 reason 辅助 ───────────────────────────────────────────────────────

describe('interruption history reason', () => {
  it('maps each classification to a stable history reason', () => {
    const reasons: Record<InterruptionClassification['status'], string> = {
      'app-closed': 'app-closed',
      'runtime-crash': 'runtime-crash',
      'desktop-hung': 'desktop-hung',
      none: 'none',
    };
    expect(reasons['app-closed']).toBe('app-closed');
    expect(reasons['runtime-crash']).toBe('runtime-crash');
    expect(reasons['desktop-hung']).toBe('desktop-hung');
  });
});
