import { describe, expect, it } from 'vitest';
import type { Event } from '@sync-think/shared';
import {
  projectRunAgentIdentities,
  projectRunIdentities,
  projectRunKernels,
} from './run-identity-projection.js';

function event(
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  runId?: string,
): Event {
  return {
    id: `event-${sequence}`,
    workspaceId: 'workspace-1',
    category: 'run',
    type,
    sequence,
    occurredAt: '2026-09-20T00:00:00.000Z',
    ...(runId ? { runId } : {}),
    payload,
  } as Event;
}

describe('projectRunIdentities', () => {
  it('projects top-level immutable Agent and Kernel bindings in one pass', () => {
    const projected = projectRunIdentities([
      event(
        1,
        'run.started',
        { globalAgentId: ' agent-a ', globalAgentName: ' Reviewer ', kernelId: ' codex ' },
        'run-a',
      ),
    ]);
    expect(projected.agentIdentities.get('run-a')).toEqual({
      id: 'agent-a',
      name: 'Reviewer',
    });
    expect(projected.kernels.get('run-a')).toBe('codex');
  });

  it('recovers bindings from the nested durable run snapshot', () => {
    const projected = projectRunIdentities([
      event(1, 'run.started', {
        run: {
          id: 'run-nested',
          globalAgentId: 'agent-nested',
          globalAgentName: 'Nested agent',
          kernelId: 'claude-code',
        },
      }),
    ]);
    expect(projected.agentIdentities.get('run-nested')).toEqual({
      id: 'agent-nested',
      name: 'Nested agent',
    });
    expect(projected.kernels.get('run-nested')).toBe('claude-code');
  });

  it('ignores unrelated or unidentified events and preserves compatibility wrappers', () => {
    const events = [
      event(1, 'run.progressed', { globalAgentId: 'ignored', kernelId: 'ignored' }, 'run-a'),
      event(2, 'run.started', { globalAgentName: '   ', kernelId: '' }),
      event(3, 'run.started', { globalAgentName: 'Agent B', kernelId: 'native' }, 'run-b'),
    ];
    const projected = projectRunIdentities(events);
    expect([...projected.agentIdentities]).toEqual([
      ['run-b', { id: undefined, name: 'Agent B' }],
    ]);
    expect([...projected.kernels]).toEqual([['run-b', 'native']]);
    expect(projectRunAgentIdentities(events)).toEqual(projected.agentIdentities);
    expect(projectRunKernels(events)).toEqual(projected.kernels);
  });
});
