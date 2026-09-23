import { describe, expect, it } from 'vitest';
import { ScheduledTaskRunRegistry } from './scheduled-task-run-registry.js';

interface Task {
  id: string;
}

interface Run {
  id: string;
}

describe('scheduled task run registry', () => {
  it('registers active execution and terminal metadata together', () => {
    const registry = new ScheduledTaskRunRegistry<Task, Run>();

    registry.register('run-a', {
      task: { id: 'task-a' },
      firedAt: '2026-09-20T00:00:00.000Z',
      run: { id: 'run-a' },
    });

    expect(registry.activeCount()).toBe(1);
    expect(registry.takeMetadata('run-a')).toEqual({
      task: { id: 'task-a' },
      firedAt: '2026-09-20T00:00:00.000Z',
      run: { id: 'run-a' },
    });
  });

  it('finishes execution without discarding terminal metadata', () => {
    const registry = new ScheduledTaskRunRegistry<Task, Run>();
    registry.register('run-a', {
      task: { id: 'task-a' },
      firedAt: '2026-09-20T00:00:00.000Z',
      run: { id: 'run-a' },
    });

    expect(registry.finishExecution('run-a')).toBe(true);
    expect(registry.activeCount()).toBe(0);
    expect(registry.takeMetadata('run-a')?.task.id).toBe('task-a');
  });

  it('consumes terminal metadata once', () => {
    const registry = new ScheduledTaskRunRegistry<Task, Run>();
    registry.register('run-a', {
      task: { id: 'task-a' },
      firedAt: '2026-09-20T00:00:00.000Z',
      run: { id: 'run-a' },
    });

    expect(registry.takeMetadata('run-a')).toBeDefined();
    expect(registry.takeMetadata('run-a')).toBeUndefined();
  });

  it('keeps runs isolated', () => {
    const registry = new ScheduledTaskRunRegistry<Task, Run>();
    registry.register('run-a', {
      task: { id: 'task-a' },
      firedAt: '2026-09-20T00:00:00.000Z',
      run: { id: 'run-a' },
    });
    registry.register('run-b', {
      task: { id: 'task-b' },
      firedAt: '2026-09-20T00:01:00.000Z',
      run: { id: 'run-b' },
    });

    registry.finishExecution('run-a');

    expect(registry.activeCount()).toBe(1);
    expect(registry.takeMetadata('run-b')?.task.id).toBe('task-b');
  });
});
