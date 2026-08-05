import { describe, expect, it } from 'vitest';
import type { Event, EventId, RunId, WorkspaceId } from '@sync-think/shared';
import { projectRunProcess } from './run-process-view.js';

const workspaceId = 'workspace-run-process' as WorkspaceId;

function event(input: Partial<Event> & Pick<Event, 'id' | 'sequence' | 'type' | 'payload'>): Event {
  return {
    workspaceId,
    category: 'tool',
    occurredAt: '2026-07-27T00:00:00.000Z',
    ...input,
  } as Event;
}

describe('projectRunProcess', () => {
  it('projects cache usage separately from total provider input', () => {
    const runId = 'run-cache-usage' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-cache-usage' as EventId,
        sequence: 1,
        runId,
        type: 'provider.usage',
        payload: {
          tokensIn: 14_000,
          tokensOut: 488,
          cachedTokensHit: 12_800,
          cachedTokensCreated: 0,
        },
      }),
    ]);

    expect(view.tokensIn).toBe(14_000);
    expect(view.cachedTokensHit).toBe(12_800);
    expect(view.cachedTokensCreated).toBe(0);
  });

  it('accumulates distinct provider turns while de-duplicating updates for one request', () => {
    const runId = 'run-multi-turn-usage' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-turn-1-initial' as EventId,
        sequence: 1,
        runId,
        type: 'provider.usage',
        payload: {
          requestId: 'request-turn-1',
          tokensIn: 100,
          tokensOut: 10,
          cachedTokensHit: 64,
          cachedTokensCreated: 0,
        },
      }),
      event({
        id: 'event-turn-1-final' as EventId,
        sequence: 2,
        runId,
        type: 'provider.usage',
        payload: {
          requestId: 'request-turn-1',
          tokensIn: 120,
          tokensOut: 12,
          cachedTokensHit: 80,
          cachedTokensCreated: 0,
        },
      }),
      event({
        id: 'event-turn-2' as EventId,
        sequence: 3,
        runId,
        type: 'provider.usage',
        payload: {
          requestId: 'request-turn-2',
          tokensIn: 200,
          tokensOut: 20,
          cachedTokensHit: 128,
          cachedTokensCreated: 0,
        },
      }),
    ]);

    expect(view.tokensIn).toBe(320);
    expect(view.tokensOut).toBe(32);
    expect(view.cachedTokensHit).toBe(208);
    expect(view.cachedTokensCreated).toBe(0);
  });

  it('labels a verified desktop application launch with its executable', () => {
    const runId = 'run-launch-app' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-launch-requested' as EventId,
        sequence: 1,
        runId,
        type: 'tool.requested',
        payload: {
          toolCallId: 'call-launch',
          toolName: 'desktop_launch_app',
          arguments: { application: 'notepad.exe' },
        },
      }),
      event({
        id: 'event-launch-completed' as EventId,
        sequence: 2,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-launch',
          toolName: 'desktop_launch_app',
          result: JSON.stringify({
            ok: true,
            result: {
              kind: 'app-launched',
              window: {
                processId: 42,
                nativeWindowHandle: '0x1234',
                title: 'Untitled - Notepad',
              },
              reusedExistingWindow: false,
            },
          }),
        },
      }),
    ]);

    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]).toMatchObject({
      label: 'Launch · notepad.exe',
      zh: '启动应用',
      status: 'done',
    });
  });

  it('projects requested/completed tools once for a run and exposes file paths in titles', () => {
    const runId = 'run-1' as RunId;
    const events: Event[] = [
      event({
        id: 'event-1' as EventId,
        sequence: 1,
        runId,
        type: 'tool.requested',
        payload: {
          toolCallId: 'call-1',
          toolName: 'read_file',
          arguments: { path: 'src/main.ts' },
        },
      }),
      event({
        id: 'event-2' as EventId,
        sequence: 2,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-1',
          toolName: 'read_file',
          result: JSON.stringify({ content: 'export const ready = true;\n' }),
        },
      }),
    ];

    const view = projectRunProcess(runId, events);
    expect(view.runId).toBe(runId);
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]).toEqual(
      expect.objectContaining({
        id: 'call-1',
        label: expect.stringContaining('src/main.ts'),
        path: 'src/main.ts',
        status: 'done',
        preview: 'export const ready = true;\n',
      }),
    );
  });

  it('maps MCP called/refused audit events to terminal step states', () => {
    const runId = 'run-mcp' as RunId;
    const events: Event[] = [
      event({
        id: 'event-mcp-requested' as EventId,
        sequence: 1,
        runId,
        type: 'mcp.tool_requested',
        payload: { toolCallId: 'call-ok', toolName: 'mcp.read' },
      }),
      event({
        id: 'event-mcp-called' as EventId,
        sequence: 2,
        runId,
        type: 'mcp.tool_called',
        payload: { toolCallId: 'call-ok', toolName: 'mcp.read', result: { ok: true } },
      }),
      event({
        id: 'event-mcp-refused' as EventId,
        sequence: 3,
        runId,
        type: 'mcp.tool_refused',
        payload: { toolCallId: 'call-denied', toolName: 'mcp.write', reason: 'denied' },
      }),
    ];

    const view = projectRunProcess(runId, events);
    expect(view.steps.find((step) => step.id === 'call-ok')?.status).toBe('done');
    expect(view.steps.find((step) => step.id === 'call-denied')?.status).toBe('error');
  });

  it('keeps a 30-step run bounded to the supplied run and preserves stable order', () => {
    const runId = 'run-30' as RunId;
    const otherRunId = 'run-other' as RunId;
    const events = Array.from({ length: 30 }, (_, index) =>
      event({
        id: `event-${String(index).padStart(2, '0')}` as EventId,
        sequence: index + 1,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: `call-${index}`,
          toolName: 'read_file',
          arguments: { path: `src/file-${index}.ts` },
          result: JSON.stringify({ content: `file ${index}` }),
        },
      }),
    );
    events.splice(
      15,
      0,
      event({
        id: 'event-other' as EventId,
        sequence: 15,
        runId: otherRunId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-other',
          toolName: 'read_file',
          arguments: { path: 'wrong.ts' },
        },
      }),
    );

    const view = projectRunProcess(runId, events);
    expect(view.steps).toHaveLength(30);
    expect(view.steps[0]?.path).toBe('src/file-0.ts');
    expect(view.steps[29]?.path).toBe('src/file-29.ts');
    expect(view.steps.some((step) => step.path === 'wrong.ts')).toBe(false);
  });

  it('groups production MCP audit events by actionDigest', () => {
    const runId = 'run-mcp-production' as RunId;
    const actionDigest = 'a'.repeat(64);
    const events: Event[] = [
      event({
        id: 'event-mcp-production-requested' as EventId,
        sequence: 1,
        runId,
        type: 'mcp.tool_requested',
        payload: { actionDigest, toolName: 'mcp.read' },
      }),
      event({
        id: 'event-mcp-production-called' as EventId,
        sequence: 2,
        runId,
        type: 'mcp.tool_called',
        payload: { actionDigest, toolName: 'mcp.read', result: { ok: true } },
      }),
    ];

    const view = projectRunProcess(runId, events);
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]).toEqual(expect.objectContaining({ id: actionDigest, status: 'done' }));
    expect(view.running).toBe(false);
  });

  it('bounds single-line command, generic, and list previews by character count', () => {
    const runId = 'run-bounded-preview' as RunId;
    const huge = 'x'.repeat(50_000);
    const events: Event[] = [
      event({
        id: 'event-command' as EventId,
        sequence: 1,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-command',
          toolName: 'run_command',
          result: { stdout: huge, exitCode: 0 },
        },
      }),
      event({
        id: 'event-generic' as EventId,
        sequence: 2,
        runId,
        type: 'tool.completed',
        payload: { toolCallId: 'call-generic', toolName: 'custom_tool', result: huge },
      }),
      event({
        id: 'event-list' as EventId,
        sequence: 3,
        runId,
        type: 'tool.completed',
        payload: { toolCallId: 'call-list', toolName: 'list_files', result: { entries: [huge] } },
      }),
    ];

    const view = projectRunProcess(runId, events);
    for (const step of view.steps) {
      expect(step.preview?.length).toBeLessThanOrEqual(12_050);
      expect(step.preview).toContain('content truncated');
    }
  });

  it('settles unfinished tool steps when the run reaches a terminal state', () => {
    const completedRunId = 'run-terminal-completed' as RunId;
    const failedRunId = 'run-terminal-failed' as RunId;
    const completed = projectRunProcess(completedRunId, [
      event({
        id: 'event-completed-requested' as EventId,
        sequence: 1,
        runId: completedRunId,
        type: 'tool.requested',
        payload: { toolCallId: 'call-completed', toolName: 'run_command' },
      }),
      event({
        id: 'event-run-completed' as EventId,
        sequence: 2,
        runId: completedRunId,
        type: 'run.completed',
        payload: {},
      }),
    ]);
    const failed = projectRunProcess(failedRunId, [
      event({
        id: 'event-failed-requested' as EventId,
        sequence: 1,
        runId: failedRunId,
        type: 'tool.requested',
        payload: { toolCallId: 'call-failed', toolName: 'run_command' },
      }),
      event({
        id: 'event-run-failed' as EventId,
        sequence: 2,
        runId: failedRunId,
        type: 'run.failed',
        payload: {},
      }),
    ]);

    expect(completed.steps[0]?.status).toBe('done');
    expect(completed.running).toBe(false);
    expect(failed.steps[0]?.status).toBe('error');
    expect(failed.running).toBe(false);
    expect(failed.errorCount).toBe(1);
  });
});
