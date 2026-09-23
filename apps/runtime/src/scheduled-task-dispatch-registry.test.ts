import { describe, expect, it } from 'vitest';
import { ScheduledTaskDispatchRegistry } from './scheduled-task-dispatch-registry.js';

describe('scheduled task dispatch registry', () => {
  it('tracks a dispatch before its run is bound', () => {
    const registry = new ScheduledTaskDispatchRegistry();

    registry.start('task-a');

    expect(registry.pendingTaskIds()).toEqual(['task-a']);
  });

  it('rolls back a dispatch that did not start', () => {
    const registry = new ScheduledTaskDispatchRegistry();
    registry.start('task-a');

    registry.cancelStart('task-a');

    expect(registry.pendingTaskIds()).toEqual([]);
  });

  it('settles a bound run and reports whether it was dispatched', () => {
    const registry = new ScheduledTaskDispatchRegistry();
    registry.start('task-a');
    registry.bindRun('run-a', 'task-a');

    expect(registry.completeRun('run-a')).toEqual({
      taskId: 'task-a',
      wasDispatched: true,
    });
    expect(registry.completeRun('run-a')).toEqual({
      taskId: undefined,
      wasDispatched: false,
    });
    expect(registry.pendingTaskIds()).toEqual([]);
  });

  it('keeps ordinary scheduled runs distinct from daemon dispatches', () => {
    const registry = new ScheduledTaskDispatchRegistry();
    registry.bindRun('run-a', 'task-a');

    expect(registry.completeRun('run-a')).toEqual({
      taskId: 'task-a',
      wasDispatched: false,
    });
  });
});
