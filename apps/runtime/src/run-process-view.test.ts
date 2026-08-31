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
  it('links a nameless plan completion to its request without creating a generic Tool step', () => {
    const runId = 'run-codex-plan' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-plan-request' as EventId,
        sequence: 1,
        runId,
        type: 'tool.requested',
        payload: {
          toolCall: {
            id: 'codex-plan-1',
            name: 'update_task_plan',
            argumentsJson: JSON.stringify({
              items: [{ title: '检查状态', status: 'in_progress' }],
            }),
          },
        },
      }),
      event({
        id: 'event-plan-completed' as EventId,
        sequence: 2,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'codex-plan-1',
          result: JSON.stringify({
            ok: true,
            plan: { items: [{ title: '检查状态', status: 'completed' }] },
          }),
        },
      }),
    ]);

    expect(view.taskPlan?.items).toEqual([{ title: '检查状态', status: 'completed' }]);
    expect(view.steps).toHaveLength(0);
  });

  it('projects task tools as a checklist without mixing them into execution steps', () => {
    const runId = 'run-task-plan-tools' as RunId;
    const events = [
      event({
        id: 'event-task-create-requested' as EventId,
        sequence: 1,
        runId,
        type: 'tool.requested',
        payload: {
          toolCallId: 'call-task-create',
          toolName: 'TaskCreate',
          arguments: { title: 'Inspect the workspace' },
        },
      }),
      event({
        id: 'event-task-create-completed' as EventId,
        sequence: 2,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-task-create',
          toolName: 'TaskCreate',
          result: JSON.stringify({
            ok: true,
            task: { taskId: 'task-1', title: 'Inspect the workspace', status: 'in_progress' },
            plan: {
              items: [
                { title: 'Inspect the workspace', status: 'in_progress' },
                { title: 'Report the result', status: 'pending' },
              ],
            },
          }),
        },
      }),
      event({
        id: 'event-task-update-completed' as EventId,
        sequence: 3,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-task-update',
          toolName: 'TaskUpdate',
          result: JSON.stringify({
            ok: true,
            task: { taskId: 'task-1', title: 'Inspect the workspace', status: 'completed' },
            plan: {
              items: [
                { title: 'Inspect the workspace', status: 'completed' },
                { title: 'Report the result', status: 'in_progress' },
              ],
            },
          }),
        },
      }),
      event({
        id: 'event-task-list-completed' as EventId,
        sequence: 4,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-task-list',
          toolName: 'TaskList',
          result: JSON.stringify({
            ok: true,
            tasks: [
              { taskId: 'task-1', title: 'Inspect the workspace', status: 'completed' },
              { taskId: 'task-2', title: 'Report the result', status: 'in_progress' },
            ],
            plan: {
              items: [
                { title: 'Inspect the workspace', status: 'completed' },
                { title: 'Report the result', status: 'in_progress' },
              ],
            },
          }),
        },
      }),
      event({
        id: 'event-read-file' as EventId,
        sequence: 5,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-read-file',
          toolName: 'read_file',
          arguments: { path: 'README.md' },
          result: JSON.stringify({ content: '# Sync Think' }),
        },
      }),
    ];

    const view = projectRunProcess(runId, events);

    expect(view.taskPlan).toEqual({
      items: [
        { title: 'Inspect the workspace', status: 'completed' },
        { title: 'Report the result', status: 'in_progress' },
      ],
      completed: 1,
      total: 2,
    });
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]?.toolName).toBe('read_file');
    expect(
      view.steps.some((step) => ['TaskCreate', 'TaskUpdate', 'TaskList'].includes(step.toolName)),
    ).toBe(false);
  });

  it('projects task tools that kernels invoked through the platform MCP server', () => {
    const runId = 'run-task-plan-mcp' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-mcp-task-create' as EventId,
        sequence: 1,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-mcp-task-create',
          // Codex / Claude reach the platform tools over MCP, so the wire name
          // carries the mcp__<server>__ prefix. Exact matching missed it and
          // the checklist silently stopped updating for kernel-driven runs.
          toolName: 'mcp__sync-think-platform__TaskCreate',
          result: JSON.stringify({
            ok: true,
            plan: { items: [{ title: 'Inspect the workspace', status: 'in_progress' }] },
          }),
        },
      }),
    ]);

    expect(view.taskPlan).toEqual({
      items: [{ title: 'Inspect the workspace', status: 'in_progress' }],
      completed: 0,
      total: 1,
    });
    expect(view.steps).toHaveLength(0);
  });

  it('settles a running tool when the Run is paused', () => {
    const runId = 'run-paused' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-run-started' as EventId,
        sequence: 1,
        runId,
        type: 'run.started',
        occurredAt: '2026-08-08T10:00:00.000Z',
        payload: {},
      }),
      event({
        id: 'event-tool-requested' as EventId,
        sequence: 2,
        runId,
        type: 'tool.requested',
        occurredAt: '2026-08-08T10:00:02.000Z',
        payload: {
          toolCallId: 'call-paused',
          toolName: 'read_file',
          arguments: { path: 'paused.ts' },
        },
      }),
      event({
        id: 'event-run-paused' as EventId,
        sequence: 3,
        runId,
        type: 'run.paused',
        occurredAt: '2026-08-08T10:00:08.000Z',
        payload: {},
      }),
    ]);

    expect(view.running).toBe(false);
    expect(view.completedAt).toBe('2026-08-08T10:00:08.000Z');
    expect(view.durationMs).toBe(8_000);
    expect(view.steps[0]?.status).toBe('done');
  });

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
    // Single request → the context watermark is that request's input context.
    expect(view.contextWatermarkTokens).toBe(14_000);
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
    // Billing cumulative sums every request; the context watermark is the LAST
    // request's input (200), not output or the tool-loop inflated total.
    expect(view.contextWatermarkTokens).toBe(200);
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
        sequence: 1,
        startedAt: '2026-07-27T00:00:00.000Z',
        completedAt: '2026-07-27T00:00:00.000Z',
      }),
    );
  });

  it('keeps the external-kernel MCP tool identity when the completed event omits the name', () => {
    // External kernels (codex/claude) persist tool.requested with a nested
    // `toolCall.name` and tool.completed with ONLY `{toolCallId, result}` — no
    // name. The completion must not overwrite the identity with the generic
    // fallback ("tool"); the step keeps the MCP verb + tool name.
    const runId = 'run-mcp' as RunId;
    const events: Event[] = [
      event({
        id: 'req-1' as EventId,
        sequence: 1,
        runId,
        type: 'tool.requested',
        payload: {
          toolCall: {
            id: 'item_1',
            name: 'mcp__node_repl__js',
            argumentsJson: '{"code":"console.log(1+1)"}',
          },
        },
      }),
      event({
        id: 'cmp-1' as EventId,
        sequence: 2,
        runId,
        type: 'tool.completed',
        payload: { toolCallId: 'item_1', result: '2' },
      }),
    ];

    const view = projectRunProcess(runId, events);
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]).toEqual(
      expect.objectContaining({
        id: 'item_1',
        verb: 'MCP',
        zh: 'mcp__node_repl__js',
        toolName: 'mcp__node_repl__js',
        kind: 'mcp',
        status: 'done',
        preview: '2',
      }),
    );
  });

  it('uses a completed-only legacy event as both the start and completion boundary', () => {
    const runId = 'run-completed-only' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-completed-only' as EventId,
        sequence: 7,
        runId,
        type: 'tool.completed',
        occurredAt: '2026-08-08T01:02:03.000Z',
        payload: {
          toolCallId: 'call-completed-only',
          toolName: 'read_file',
          arguments: { path: 'legacy.ts' },
          result: JSON.stringify({ content: 'legacy' }),
        },
      }),
    ]);

    expect(view.steps[0]).toMatchObject({
      sequence: 7,
      startedAt: '2026-08-08T01:02:03.000Z',
      completedAt: '2026-08-08T01:02:03.000Z',
    });
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

  it('reconstructs the full command line from command + args', () => {
    // {command,args[]} 只读 command 会把「pnpm -s test」显示成「pnpm」。
    const runId = 'run-command-line' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-cmd' as EventId,
        sequence: 1,
        runId,
        type: 'tool.requested',
        payload: {
          toolCallId: 'call-cmd',
          toolName: 'run_command',
          arguments: { command: 'pnpm', args: ['-s', 'test'] },
        },
      }),
    ]);
    expect(view.steps[0]?.command).toBe('pnpm -s test');
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

  it('forwards the pre-write snapshot and written body into fileChanges for diff rendering', () => {
    const runId = 'run-snapshot-diff' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-write-requested' as EventId,
        sequence: 1,
        runId,
        type: 'tool.requested',
        payload: {
          toolCallId: 'call-write',
          toolName: 'write_file',
          arguments: { path: 'src/app.ts', content: 'export const v = 2;\n' },
        },
      }),
      event({
        id: 'event-write-completed' as EventId,
        sequence: 2,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-write',
          toolName: 'write_file',
          result: JSON.stringify({ ok: true, created: false }),
          previousContent: 'export const v = 1;\n',
        },
      }),
    ]);

    expect(view.fileChanges).toHaveLength(1);
    expect(view.fileChanges[0]).toMatchObject({
      path: 'src/app.ts',
      action: 'edited',
      previousContent: 'export const v = 1;\n',
      content: 'export const v = 2;\n',
    });
    expect(view.fileChanges[0]?.previousTruncated).toBeUndefined();
  });

  it('omits snapshot fields when the event carries no pre-write content', () => {
    const runId = 'run-snapshot-none' as RunId;
    const view = projectRunProcess(runId, [
      event({
        id: 'event-create-completed' as EventId,
        sequence: 1,
        runId,
        type: 'tool.completed',
        payload: {
          toolCallId: 'call-create',
          toolName: 'write_file',
          arguments: { path: 'new.txt', content: 'hello' },
          result: JSON.stringify({ ok: true, created: true }),
        },
      }),
    ]);

    expect(view.fileChanges[0]).toMatchObject({ path: 'new.txt', action: 'created' });
    expect(view.fileChanges[0]?.previousContent).toBeUndefined();
    expect(view.fileChanges[0]?.content).toBe('hello');
  });
});
