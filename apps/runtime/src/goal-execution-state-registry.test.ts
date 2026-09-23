import { describe, expect, it } from 'vitest';
import { GoalExecutionStateRegistry } from './goal-execution-state-registry.js';

interface TestGoal {
  status: string;
}

describe('GoalExecutionStateRegistry', () => {
  it('caches goals by conversation', () => {
    const registry = new GoalExecutionStateRegistry<string, string, TestGoal>();
    const goal = { status: 'active' };

    registry.cacheGoal('conversation-a', goal);

    expect(registry.cachedGoal('conversation-a')).toBe(goal);
    expect(registry.goalCount()).toBe(1);
  });

  it('replaces a cached goal without growing the registry', () => {
    const registry = new GoalExecutionStateRegistry<string, string, TestGoal>();
    registry.cacheGoal('conversation-a', { status: 'active' });

    registry.cacheGoal('conversation-a', { status: 'paused' });

    expect(registry.cachedGoal('conversation-a')).toEqual({ status: 'paused' });
    expect(registry.goalCount()).toBe(1);
  });

  it('binds and reads the revision for a Goal run', () => {
    const registry = new GoalExecutionStateRegistry<string, string, TestGoal>();

    registry.bindRunRevision('run-a', 'revision-a');

    expect(registry.revisionForRun('run-a')).toBe('revision-a');
    expect(registry.hasRunRevision('run-a')).toBe(true);
  });

  it('takes a run revision exactly once', () => {
    const registry = new GoalExecutionStateRegistry<string, string, TestGoal>();
    registry.bindRunRevision('run-a', 'revision-a');

    expect(registry.takeRunRevision('run-a')).toBe('revision-a');
    expect(registry.takeRunRevision('run-a')).toBeUndefined();
    expect(registry.hasRunRevision('run-a')).toBe(false);
  });

  it('tracks pending turns independently per conversation', () => {
    const registry = new GoalExecutionStateRegistry<string, string, TestGoal>();

    registry.markPending('conversation-a');
    registry.markPending('conversation-b');
    registry.clearPending('conversation-a');

    expect(registry.isPending('conversation-a')).toBe(false);
    expect(registry.isPending('conversation-b')).toBe(true);
  });
});
