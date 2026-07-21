import { describe, expect, it } from 'vitest';
import { createDemoRun, parseDemoRuns } from './demo-run.js';
import type { RunId } from '@sync-think/shared';

describe('demo-run executionSnapshot', () => {
  it('round-trips an effective execution snapshot on the run state', () => {
    const snapshot = {
      mode: 'workspace' as const,
      workspaceRoot: 'D:\\projects\\demo',
      filesystem: 'write-workspace' as const,
      network: 'ask' as const,
      approval: 'ask-protected' as const,
      approvalRouting: 'user' as const,
      toolNames: ['read_file', 'write_file'],
      capturedAt: '2026-07-20T12:00:00.000Z',
      source: 'task' as const,
    };
    const run = createDemoRun('run_1' as RunId, 'thread_1', 'hello', {
      executionRoot: 'D:\\projects\\demo',
      executionToolNames: ['read_file', 'write_file'],
      executionSnapshot: snapshot,
      useFakeProvider: true,
    });
    expect(run.executionSnapshot).toEqual(snapshot);

    const restoredMap = parseDemoRuns([JSON.parse(JSON.stringify(run))]);
    expect(restoredMap).toHaveLength(1);
    expect(restoredMap[0]?.executionSnapshot).toEqual(snapshot);

    // Mid-run task mode changes must not mutate the frozen snapshot object.
    run.effectiveApprovalMode = 'full';
    expect(restoredMap[0]?.executionSnapshot?.mode).toBe('workspace');
    expect(run.executionSnapshot?.mode).toBe('workspace');
  });
});
