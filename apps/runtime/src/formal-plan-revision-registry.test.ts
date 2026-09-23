import { describe, expect, it, vi } from 'vitest';
import type { Event, RunId } from '@sync-think/shared';
import {
  FormalPlanRevisionRegistry,
  type FormalPlanEventPort,
} from './formal-plan-revision-registry.js';

const runId = 'run-plan' as RunId;

function event(type: string, revision: unknown): Pick<Event, 'type' | 'payload'> {
  return { type, payload: { revision } };
}

describe('formal plan revision registry', () => {
  it('restores the latest valid submitted revision and caches it', () => {
    const listEventsByRun = vi.fn(() => [
      event('conversation.plan_submitted', 1),
      event('conversation.plan_submitted', 0),
      event('conversation.plan_submitted', 3),
      event('other', 9),
    ]);
    const registry = new FormalPlanRevisionRegistry({ listEventsByRun });

    expect(registry.get(runId)).toBe(3);
    expect(registry.get(runId)).toBe(3);
    expect(listEventsByRun).toHaveBeenCalledOnce();
  });

  it('records a submitted revision without reading events', () => {
    const events: FormalPlanEventPort = { listEventsByRun: vi.fn(() => []) };
    const registry = new FormalPlanRevisionRegistry(events);

    registry.record(runId, 2);

    expect(registry.get(runId)).toBe(2);
    expect(events.listEventsByRun).not.toHaveBeenCalled();
  });

  it('rejects invalid revisions', () => {
    const registry = new FormalPlanRevisionRegistry();

    expect(() => registry.record(runId, 0)).toThrow('Invalid formal plan revision: 0');
    expect(() => registry.record(runId, 1.5)).toThrow('Invalid formal plan revision: 1.5');
  });

  it('clears the run cache so durable events can be read again', () => {
    const listEventsByRun = vi
      .fn<FormalPlanEventPort['listEventsByRun']>()
      .mockReturnValueOnce([event('conversation.plan_submitted', 1)])
      .mockReturnValueOnce([event('conversation.plan_submitted', 2)]);
    const registry = new FormalPlanRevisionRegistry({ listEventsByRun });

    expect(registry.get(runId)).toBe(1);
    registry.delete(runId);
    expect(registry.get(runId)).toBe(2);
    expect(listEventsByRun).toHaveBeenCalledTimes(2);
  });
});
