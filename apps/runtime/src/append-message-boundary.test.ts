import { mkdtempSync, realpathSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decodeFrames, type Frame } from '@sync-think/protocol';
import {
  MAX_MESSAGE_BLOCKS_JSON_BYTES,
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteAssistantTimelineStore,
  SqliteMessageStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import { Runtime } from './runtime.js';
import {
  appendAssistantTextDelta,
  createDemoRun,
  serializeDemoRun,
  type DemoRunState,
} from './demo-run.js';
import type { Event, RunId } from '@sync-think/shared';

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-append-boundary-'));
  const path = join(directory, 'test.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const stateStore = new SqliteEventCheckpointStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaceStore.createWorkspace({ name: 'Append boundary' });
  const task = workspaceStore.createTask({
    workspaceId: workspace.id,
    title: 'Chat',
    goal: 'Chat',
  });
  const unitOfWork = new SqliteUnitOfWork(connection.raw);
  const assistantTimelineStore = new SqliteAssistantTimelineStore(connection.raw);
  const runtime = new Runtime({
    installId: 'append-boundary-fixture',
    allowNoToken: true,
    stateStore,
    messageStore,
    workspaceStore,
    unitOfWork,
    assistantTimelineStore,
  });
  const internal = runtime as unknown as {
    handleAppendMessage(socket: object, frame: Frame): Promise<void>;
    canStartModelRun(): boolean;
    executeKernelRun(runId: string): Promise<void>;
    prepareRunBinding(input: { runId: RunId; threadId: string; userText: string }): {
      run: DemoRunState;
      packetId: string;
      proofHash: string;
    };
    adaptRunImagesForModel(run: DemoRunState): Promise<void>;
    publishEvent(event: Event): void;
    requestChatToolApproval(input: object): Promise<{ decision: string; approvalId: string }>;
    demoRuns: Map<string, DemoRunState>;
    demoRunAborts: Map<string, AbortController>;
    inFlight: Set<string>;
    pendingToolApprovals: Map<string, object>;
    runKernelIds: Map<string, string>;
    lastCheckpointEventSequence: number;
    checkpointRunId: RunId;
    threadVersions: Map<string, number>;
    persistAssistantTimelineSegments(
      runId: RunId,
      timeline: DemoRunState['assistantTimeline'],
      strict?: boolean,
    ): void;
  };
  const canStart = vi.spyOn(internal, 'canStartModelRun').mockReturnValue(false);
  const execute = vi.spyOn(internal, 'executeKernelRun').mockResolvedValue();
  const append = async (text: string) => {
    const frames: Frame[] = [];
    await internal.handleAppendMessage(
      {
        write: (data: Buffer) => {
          frames.push(...decodeFrames(data).frames);
          return true;
        },
      },
      {
        id: 'append',
        kind: 'request',
        type: 'task.appendMessage',
        payload: { threadId: task.threadId, expectedTaskVersion: 0, role: 'user', text },
      },
    );
    return frames[0];
  };
  const state = () => ({
    version: workspaceStore.getTaskByThreadId(task.threadId)?.version,
    messages: messageStore.listMessages(task.threadId).messages.length,
    events: (
      connection.raw.prepare('SELECT COUNT(*) AS count FROM event').get() as { count: number }
    ).count,
  });
  const close = async () => {
    for (const abort of internal.demoRunAborts.values()) abort.abort();
    internal.inFlight.clear();
    await runtime.stop();
    connection.raw.close();
    if (
      lstatSync(directory).isSymbolicLink() ||
      dirname(realpathSync(directory)) !== realpathSync(tmpdir()) ||
      !basename(directory).startsWith('sync-think-append-boundary-')
    )
      throw new Error('Unexpected fixture directory');
    rmSync(directory, { recursive: true, force: true });
  };
  const activate = () => {
    canStart.mockReturnValue(true);
    const now = new Date().toISOString();
    const active = appendAssistantTextDelta(
      {
        ...createDemoRun('old-run' as RunId, task.threadId, 'old prompt'),
        assistantText: 'partial answer',
      },
      'final_answer',
      'partial answer',
      now,
    );
    stateStore.commitTransition({
      events: [
        {
          id: 'old-started' as Event['id'],
          workspaceId: workspace.id,
          taskId: task.taskId,
          runId: active.runId,
          category: 'run',
          type: 'run.started',
          occurredAt: now,
          payload: { threadId: task.threadId, run: serializeDemoRun(active) },
        },
      ],
    });
    internal.demoRuns.set(active.runId, active);
    internal.inFlight.add(active.runId);
    const abort = new AbortController();
    internal.demoRunAborts.set(active.runId, abort);
    const toolCall = {
      id: 'old-call',
      name: 'write_file',
      argumentsJson: JSON.stringify({ path: 'fixture.txt', content: 'original' }),
    };
    const approval = internal.requestChatToolApproval({
      runId: active.runId,
      threadId: task.threadId,
      workspaceRoot: '',
      executionMode: 'default',
      approvalId: 'old-approval',
      chatMessages: [],
      pendingToolCalls: [toolCall],
      currentIndex: 0,
      completedResults: [],
      toolLoopRound: 0,
      toolCall,
      signal: abort.signal,
    });
    const resolved = vi.fn();
    void approval.then(resolved);
    const prepare = vi.spyOn(internal, 'prepareRunBinding').mockImplementation((input) => ({
      run: createDemoRun(input.runId, input.threadId, input.userText, { kernelId: 'native' }),
      packetId: 'prepared-packet',
      proofHash: 'prepared-proof',
    }));
    const adapt = vi.spyOn(internal, 'adaptRunImagesForModel').mockResolvedValue();
    const publish = vi.spyOn(internal, 'publishEvent');
    return { active, abort, approval, resolved, prepare, adapt, publish };
  };
  const events = () =>
    connection.raw
      .prepare('SELECT type, run_id, payload_json FROM event ORDER BY sequence')
      .all() as { type: string; run_id: string; payload_json: string }[];
  return {
    append,
    canStart,
    execute,
    state,
    close,
    messageStore,
    workspaceStore,
    task,
    activate,
    internal,
    events,
    stateStore,
    unitOfWork,
    assistantTimelineStore,
  };
}

describe('append message durable boundary', () => {
  it.each([
    ['UTF-16 escaping', '\ud800'.repeat(50_000)],
    ['UTF-8', '汉'.repeat(100_000)],
    ['JSON escaping', '\u0000'.repeat(50_000)],
  ])('rejects %s overflow before run admission and durable side effects', async (_name, text) => {
    const context = await fixture();
    try {
      const before = context.state();
      const response = await context.append(text);
      expect(response.error).toMatchObject({ code: 'protocol.frame_malformed' });
      expect(response.error?.message).toContain('262144');
      expect(context.canStart).not.toHaveBeenCalled();
      expect(context.execute).not.toHaveBeenCalled();
      expect(context.state()).toEqual(before);
    } finally {
      await context.close();
    }
  });

  it('persists exactly the existing serialized byte limit without truncating the user prompt', async () => {
    const context = await fixture();
    try {
      const overhead = Buffer.byteLength(JSON.stringify([{ type: 'text', text: '' }]));
      const available = MAX_MESSAGE_BLOCKS_JSON_BYTES - overhead;
      const text = '汉'.repeat(Math.floor(available / 3)) + 'x'.repeat(available % 3);
      const response = await context.append(text);
      expect(response.error).toBeUndefined();
      expect(context.messageStore.listMessages(context.task.threadId).messages[0]?.blocks).toEqual([
        { type: 'text', text },
      ]);
      expect(context.state()).toMatchObject({ version: 1, messages: 1 });
    } finally {
      await context.close();
    }
  });

  it.each(['message', 'transition'] as const)(
    'rolls back the append when the %s write fails',
    async (failure) => {
      const context = await fixture();
      try {
        if (failure === 'message')
          vi.spyOn(context.messageStore, 'createFinalMessage').mockImplementation(() => {
            throw new Error('fixture message write failed');
          });
        else
          vi.spyOn(context.workspaceStore, 'advanceTaskVersionByThreadId').mockImplementation(
            () => {
              throw new Error('fixture transition write failed');
            },
          );
        const before = context.state();
        const response = await context.append('preserve this prompt');
        expect(response.error).toMatchObject({ code: 'storage.write_failed' });
        expect(context.state()).toEqual(before);
        expect(context.execute).not.toHaveBeenCalled();
      } finally {
        await context.close();
      }
    },
  );
});

describe('superseding an active run', () => {
  it.each([
    'prepare',
    'images',
    'message',
    'version',
    'events',
    'outer-rollback',
    'partial-message',
    'partial-timeline',
  ] as const)('preserves the old run, approval and history when %s fails', async (failure) => {
    const context = await fixture();
    try {
      const active = context.activate();
      const before = context.state();
      const checkpointBefore = context.internal.lastCheckpointEventSequence;
      if (failure === 'prepare')
        active.prepare.mockImplementation(() => {
          throw new Error('fixture prepare failed');
        });
      if (failure === 'images') active.adapt.mockRejectedValue(new Error('fixture images failed'));
      if (failure === 'message') {
        const original = context.messageStore.createFinalMessage.bind(context.messageStore);
        vi.spyOn(context.messageStore, 'createFinalMessage').mockImplementation((message) => {
          if (message.role === 'user') throw new Error('fixture message failed');
          return original(message);
        });
      }
      if (failure === 'version')
        vi.spyOn(context.workspaceStore, 'advanceTaskVersionByThreadId').mockImplementation(() => {
          throw new Error('fixture version failed');
        });
      if (failure === 'events')
        vi.spyOn(context.stateStore, 'commitTransition').mockImplementation(() => {
          throw new Error('fixture events failed');
        });
      if (failure === 'outer-rollback') {
        const original = context.unitOfWork.run.bind(context.unitOfWork);
        vi.spyOn(context.unitOfWork, 'run').mockImplementation((operation) =>
          original(() => {
            operation();
            throw new Error('fixture rollback after writes');
          }),
        );
      }
      if (failure === 'partial-message') {
        const original = context.messageStore.createFinalMessage.bind(context.messageStore);
        vi.spyOn(context.messageStore, 'createFinalMessage').mockImplementation((message) => {
          if (message.id === 'asst-old-run') throw new Error('fixture partial message failed');
          return original(message);
        });
      }
      if (failure === 'partial-timeline')
        vi.spyOn(context.assistantTimelineStore, 'upsertSegments').mockImplementation(() => {
          throw new Error('fixture partial timeline failed');
        });
      const response = await context.append('new prompt');
      expect(response.error).toBeDefined();
      expect(active.abort.signal.aborted).toBe(false);
      expect(active.resolved).not.toHaveBeenCalled();
      expect(context.internal.demoRuns.get(active.active.runId)).toBe(active.active);
      expect(context.internal.pendingToolApprovals.has('old-approval')).toBe(true);
      expect(context.state()).toEqual(before);
      expect(context.internal.lastCheckpointEventSequence).toBe(checkpointBefore);
      expect(context.internal.runKernelIds.size).toBe(0);
      expect(active.publish).not.toHaveBeenCalled();
      expect(context.execute).not.toHaveBeenCalled();
    } finally {
      await context.close();
    }
  });

  it('does not interrupt the old run while async preparation is pending', async () => {
    const context = await fixture();
    try {
      const active = context.activate();
      let release!: () => void;
      active.adapt.mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      const pending = context.append('new prompt');
      expect(active.abort.signal.aborted).toBe(false);
      expect(context.internal.pendingToolApprovals.has('old-approval')).toBe(true);
      release();
      expect((await pending).error).toBeUndefined();
      expect(active.abort.signal.aborted).toBe(true);
    } finally {
      await context.close();
    }
  });

  it('commits the old trace and one approval decision before interrupting or starting execution', async () => {
    const context = await fixture();
    try {
      const active = context.activate();
      const observedAtAbort: object[] = [];
      active.abort.signal.addEventListener('abort', () =>
        observedAtAbort.push({
          state: context.state(),
          decisions: context.events().filter((event) => event.type === 'tool.approval_decided')
            .length,
          oldInMap: context.internal.demoRuns.has('old-run'),
        }),
      );
      const response = await context.append('new prompt');
      expect(response.error).toBeUndefined();
      expect(observedAtAbort).toEqual([
        {
          state: expect.objectContaining({ version: 1, messages: 2 }),
          decisions: 1,
          oldInMap: false,
        },
      ]);
      expect(await active.approval).toMatchObject({ decision: 'deny' });
      expect(
        context.events().filter((event) => event.type === 'tool.approval_decided'),
      ).toHaveLength(1);
      expect(context.events().filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
      const messages = context.messageStore.listMessages(context.task.threadId).messages;
      expect(messages.map((message) => message.role)).toEqual(['assistant', 'user']);
      expect(JSON.stringify(messages[0]?.blocks)).toContain('partial answer');
      expect(context.execute).toHaveBeenCalledTimes(1);
    } finally {
      await context.close();
    }
  });
});

it('checkpoints fresh maps after async preparation and never restores the superseded run', async () => {
  const context = await fixture();
  try {
    const active = context.activate();
    let release!: () => void;
    active.adapt.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = context.append('new prompt');
    const concurrent = createDemoRun('other-run' as RunId, 'other-thread', 'concurrent prompt');
    context.internal.demoRuns.set(concurrent.runId, concurrent);
    context.internal.threadVersions.set(concurrent.threadId, 7);
    release();
    const response = await pending;
    expect(response.error).toBeUndefined();
    const checkpoint = context.stateStore.loadLatestCheckpoint(context.internal.checkpointRunId);
    const state = checkpoint?.state as {
      demoRuns: DemoRunState[];
      threadVersions: [string, number][];
    };
    expect(state.demoRuns.map((run) => run.runId).sort()).toEqual(
      [concurrent.runId, (response.payload as { streamId: string }).streamId].sort(),
    );
    expect(state.threadVersions).toContainEqual(['other-thread', 7]);
    expect(context.internal.demoRuns.has('old-run')).toBe(false);
    expect(context.internal.demoRuns.get('other-run')).toBe(concurrent);
  } finally {
    await context.close();
  }
});

it('rejects a version changed during preparation without cancelling the active run', async () => {
  const context = await fixture();
  try {
    const active = context.activate();
    let release!: () => void;
    active.adapt.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const pending = context.append('new prompt');
    context.workspaceStore.advanceTaskVersionByThreadId(
      context.task.threadId,
      0,
      new Date().toISOString(),
    );
    const before = context.state();
    release();
    const response = await pending;
    expect(response.error).toMatchObject({ code: 'task.version_mismatch' });
    expect(active.abort.signal.aborted).toBe(false);
    expect(context.internal.pendingToolApprovals.has('old-approval')).toBe(true);
    expect(context.state()).toEqual(before);
    expect(context.execute).not.toHaveBeenCalled();
  } finally {
    await context.close();
  }
});

it('retries after a late transaction rollback with canonical partial history and no duplicate terminal decisions', async () => {
  const context = await fixture();
  try {
    const active = context.activate();
    const original = context.unitOfWork.run.bind(context.unitOfWork);
    vi.spyOn(context.unitOfWork, 'run').mockImplementationOnce((operation) =>
      original(() => {
        operation();
        throw new Error('fixture rollback after all writes');
      }),
    );
    expect((await context.append('retry this prompt')).error).toBeDefined();
    expect(active.abort.signal.aborted).toBe(false);
    expect((await context.append('retry this prompt')).error).toBeUndefined();
    expect(context.events().filter((event) => event.type === 'tool.approval_decided')).toHaveLength(
      1,
    );
    expect(context.events().filter((event) => event.type === 'run.cancelled')).toHaveLength(1);
    expect(context.state()).toMatchObject({ version: 1, messages: 2 });
    expect(JSON.stringify(context.assistantTimelineStore.listSegments('old-run'))).toContain(
      'partial answer',
    );
  } finally {
    await context.close();
  }
});

it('does not let a failed ordinary timeline write suppress an identical retry', async () => {
  const context = await fixture();
  try {
    const active = context.activate();
    const pendingTimeline = appendAssistantTextDelta(
      active.active,
      'final_answer',
      ' after approval',
      new Date().toISOString(),
    ).assistantTimeline;
    const write = vi
      .spyOn(context.assistantTimelineStore, 'upsertSegments')
      .mockImplementationOnce(() => {
        throw new Error('fixture timeline write failed');
      });
    context.internal.persistAssistantTimelineSegments(
      active.active.runId,
      pendingTimeline,
    );
    context.internal.persistAssistantTimelineSegments(
      active.active.runId,
      pendingTimeline,
    );
    expect(write).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(context.assistantTimelineStore.listSegments('old-run'))).toContain(
      'partial answer after approval',
    );
  } finally {
    await context.close();
  }
});

it('reports a task removed during preparation without cancelling the old run', async () => {
  const context = await fixture();
  try {
    const active = context.activate();
    const before = context.state();
    let removed = false;
    const read = context.workspaceStore.getTaskByThreadId.bind(context.workspaceStore);
    const readSpy = vi
      .spyOn(context.workspaceStore, 'getTaskByThreadId')
      .mockImplementation((threadId) => (removed ? undefined : read(threadId)));
    active.adapt.mockImplementation(async () => {
      removed = true;
    });
    const response = await context.append('new prompt');
    readSpy.mockRestore();
    expect(response.error).toMatchObject({ code: 'task.not_found' });
    expect(active.abort.signal.aborted).toBe(false);
    expect(context.state()).toEqual(before);
    expect(context.execute).not.toHaveBeenCalled();
  } finally {
    await context.close();
  }
});
