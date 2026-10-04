import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import {
  decodeFrames,
  type Frame,
  type ConversationListMessagesResponse,
  type ConversationGetRunProcessResponse,
} from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteAppSettingStore,
  SqliteConversationStore,
  SqliteConversationContentStore,
  SqliteAssistantTimelineStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteMessageStore,
  SqliteScheduledTaskStore,
  SqliteUnitOfWork,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { AgentId, ModelId, ScheduledTask, WorkspaceId } from '@sync-think/shared';
import { ConversationHistoryReadService } from './conversation-history-read-service.js';
import { Runtime } from './runtime.js';

const PREFIX = 'sync-think-scheduled-messages-';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

// The provider is the only external boundary: SQLite and all RPC handlers are real.
class HeldProvider extends FakeProvider {
  calls = 0;
  responseText = 'Fixture completed.';
  private gate?: Promise<void>;
  private releaseGate?: () => void;
  hold(): void {
    this.gate = new Promise<void>((done) => {
      this.releaseGate = done;
    });
  }
  release(): void {
    this.releaseGate?.();
    this.gate = undefined;
    this.releaseGate = undefined;
  }
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    this.calls++;
    if (this.gate) {
      let aborted!: () => void;
      const abort = new Promise<void>((done) => {
        aborted = done;
      });
      request.signal.addEventListener('abort', aborted, { once: true });
      try {
        if (!request.signal.aborted) await Promise.race([this.gate, abort]);
      } finally {
        request.signal.removeEventListener('abort', aborted);
      }
    }
    if (request.signal.aborted) return;
    yield { type: 'text-delta', text: this.responseText };
    yield { type: 'finished', reason: 'stop' };
  }
}

async function waitFor<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = performance.now() + 6000;
  let value = await read();
  while (!ready(value)) {
    if (performance.now() >= deadline)
      throw new Error('Fixture did not settle: ' + JSON.stringify(value));
    await delay(10);
    value = await read();
  }
  return value;
}
async function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), PREFIX)));
  const databasePath = join(directory, 'messages.sqlite');
  const provider = new HeldProvider();
  let connection: Awaited<ReturnType<typeof openDatabaseAsync>>;
  let runtime: Runtime;
  let reader: ConversationHistoryReadService;
  let counter = 0;
  const open = async () => {
    connection = await openDatabaseAsync({ path: databasePath });
    const stateStore = new SqliteEventCheckpointStore(connection.raw);
    const messageStore = new SqliteMessageStore(connection.raw);
    reader = new ConversationHistoryReadService({ databasePath, store: stateStore, messageStore, contentStore: new SqliteConversationContentStore(connection.raw) });
    runtime = new Runtime({
      installId: basename(directory),
      allowNoToken: true,
      projectlessDataDirectory: join(directory, 'projectless'),
      stateStore,
      messageStore,
      assistantTimelineStore: new SqliteAssistantTimelineStore(connection.raw),
      conversationHistory: reader,
      workspaceStore: new SqliteWorkspaceStore(connection.raw),
      conversationStore: new SqliteConversationStore(connection.raw),
      globalAgentStore: new SqliteGlobalAgentStore(connection.raw),
      scheduledTaskStore: new SqliteScheduledTaskStore(connection.raw),
      appSettingStore: new SqliteAppSettingStore(connection.raw),
      unitOfWork: new SqliteUnitOfWork(connection.raw),
      demoProvider: provider,
    });
  };
  const close = async () => {
    provider.release();
    await runtime?.stop();
    await reader?.close();
    if (connection?.raw.open) connection.raw.close();
  };
  cleanups.push(async () => {
    await close();
    const target = realpathSync(directory);
    if (
      lstatSync(directory).isSymbolicLink() ||
      dirname(target) !== realpathSync(tmpdir()) ||
      !basename(target).startsWith(PREFIX)
    )
      throw new Error('Unexpected fixture directory');
    rmSync(target, { recursive: true, force: true });
  });
  await runMigrations(databasePath);
  await open();
  const workspace = new SqliteWorkspaceStore(connection!.raw).createWorkspace({
    id: 'message-workspace' as WorkspaceId,
    name: 'Scheduled messages',
    folderPath: directory,
  });
  const agent = new SqliteGlobalAgentStore(connection!.raw).create({
    id: 'message-agent' as AgentId,
    name: 'Message agent',
    defaultModelId: 'fake-mini' as ModelId,
  });
  const rpc = (type: string, payload: unknown): Promise<Frame> =>
    new Promise((done, reject) => {
      const id = 'messages-rpc-' + ++counter;
      const timeout = setTimeout(() => reject(new Error('RPC timed out: ' + type)), 3000);
      try {
        (
          runtime as unknown as {
            handlers: { onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void };
          }
        ).handlers.onFrame(
          {
            write(data) {
              for (const frame of decodeFrames(data).frames)
                if (frame.id === id && frame.kind === 'response') {
                  clearTimeout(timeout);
                  done(frame);
                }
              return true;
            },
          },
          { id, kind: 'request', type, payload },
        );
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  const ok = async <T>(type: string, payload: unknown): Promise<T> => {
    const frame = await rpc(type, payload);
    expect(frame.error, type).toBeUndefined();
    return frame.payload as T;
  };
  return {
    provider,
    agent,
    workspace,
    ok,
    rpc,
    runtime: () => runtime,
    async scheduleTool(input: Record<string, unknown>, mode: 'ask' | 'workspace' | 'full-access' = 'full-access') {
      const internal = runtime as unknown as { demoRuns: Map<string, import('./demo-run.js').DemoRunState>; executeTaskScheduleTool(...args: unknown[]): Promise<{ ok: boolean; content?: string; error?: string }> };
      const owner = new SqliteWorkspaceStore(connection!.raw).createTask({ workspaceId: workspace.id, title: 'Schedule tool fixture', goal: 'Verify scheduled task configuration' });
      const runId = 'schedule-config-' + ++counter;
      const run = { runId, threadId: owner.threadId, modelId: 'fake-mini' } as unknown as import('./demo-run.js').DemoRunState;
      internal.demoRuns.set(runId, run);
      try {
        return await internal.executeTaskScheduleTool(runId, run, { id: 'call-' + counter, tool: 'task_schedule', input, signal: new AbortController().signal }, mode);
      } finally { internal.demoRuns.delete(runId); }
    },
    async restart() {
      await close();
      await open();
    },
  };
}

describe('Scheduled Model/Agent messages through public RPC and file SQLite', () => {
  it.each(['model', 'agent'] as const)(
    '%s trigger is visible before completion, scoped, and durable without duplicates after reopening',
    async (kind) => {
      const f = await fixture();
      const create = async (name: string) =>
        (
          await f.ok<{ task: ScheduledTask }>('scheduledTask.create', {
            name,
            instruction: 'Only collect isolated fixture evidence.',
            target:
              kind === 'model' ? { kind, modelId: 'fake-mini' } : { kind, agentId: f.agent.id },
            rule: { kind: 'every', intervalMinutes: 30 },
            timeZone: 'UTC',
            enabled: false,
            workspaceId: f.workspace.id,
          })
        ).task;
      const task = await create(kind + ' message fixture');
      f.provider.hold();
      const trigger = await f.ok<{ fired: boolean; task: ScheduledTask }>('scheduledTask.trigger', {
        taskId: task.id,
      });
      expect(trigger.fired).toBe(true);
      const conversationId = trigger.task.conversationId!;
      const health = await waitFor(
        () => f.ok<{ inFlightRunIds: string[] }>('runtime.healthcheck', {}),
        (value) => value.inFlightRunIds.length === 1,
      );
      const runId = health.inFlightRunIds[0]!;
      const page = await f.ok<ConversationListMessagesResponse>('conversation.listMessages', {
        conversationId,
      });
      expect(page.messages).toHaveLength(1);
      expect(page.messages[0]).toMatchObject({
        role: 'user',
        runId,
        blocks: [{ type: 'text', text: '【定时任务 · ' + task.name + '】' + task.instruction }],
      });
      const firstMessage = page.messages[0]!;
      const busy = await f.ok<{ fired: boolean }>('scheduledTask.trigger', { taskId: task.id });
      expect(busy.fired).toBe(false);
      expect(
        (
          await f.ok<ConversationListMessagesResponse>('conversation.listMessages', {
            conversationId,
          })
        ).messages,
      ).toEqual(page.messages);
      f.provider.release();
      await waitFor(
        () => f.ok<{ inFlightRunIds: string[] }>('runtime.healthcheck', {}),
        (value) => value.inFlightRunIds.length === 0,
      );
      const other = await create('Other scheduled fixture');
      const otherTrigger = await f.ok<{ fired: boolean; task: ScheduledTask }>(
        'scheduledTask.trigger',
        { taskId: other.id },
      );
      const otherPage = await f.ok<ConversationListMessagesResponse>('conversation.listMessages', {
        conversationId: otherTrigger.task.conversationId,
      });
      expect(otherPage.messages.some((message) => message.id === firstMessage.id)).toBe(false);
      await waitFor(
        () => f.ok<{ inFlightRunIds: string[] }>('runtime.healthcheck', {}),
        (value) => value.inFlightRunIds.length === 0,
      );
      await f.restart();
      const restored = await f.ok<ConversationListMessagesResponse>('conversation.listMessages', {
        conversationId,
      });
      expect(restored.messages.filter((message) => message.role === 'user')).toEqual([
        firstMessage,
      ]);
      f.provider.hold();
      const second = await f.ok<{ fired: boolean; task: ScheduledTask }>('scheduledTask.trigger', {
        taskId: task.id,
      });
      expect(second).toMatchObject({ fired: true, task: { conversationId } });
      const repeated = await f.ok<ConversationListMessagesResponse>('conversation.listMessages', {
        conversationId,
      });
      const users = repeated.messages.filter((message) => message.role === 'user');
      expect(users).toHaveLength(2);
      expect(users[0]).toEqual(firstMessage);
      expect(users[1]!.sequence).toBeGreaterThan(firstMessage.sequence);
      expect(users[1]!.id).not.toBe(firstMessage.id);
      f.provider.release();
      await waitFor(
        () => f.ok<{ inFlightRunIds: string[] }>('runtime.healthcheck', {}),
        (value) => value.inFlightRunIds.length === 0,
      );
      await f.restart();
      expect(
        (
          await f.ok<ConversationListMessagesResponse>('conversation.listMessages', {
            conversationId,
          })
        ).messages.filter((message) => message.role === 'user'),
      ).toEqual(users);
    },
  );
});

describe('Scheduled run process public liveness boundary', () => {
  it('reports a held active text-only run as running without changing its cached historical process', async () => {
    const f = await fixture();
    const task = (
      await f.ok<{ task: ScheduledTask }>('scheduledTask.create', {
        name: 'Text-only liveness',
        instruction: 'Respond with isolated fixture text.',
        target: { kind: 'model', modelId: 'fake-mini' },
        rule: { kind: 'every', intervalMinutes: 30 },
        enabled: false,
        workspaceId: f.workspace.id,
      })
    ).task;
    f.provider.hold();
    const trigger = await f.ok<{ task: ScheduledTask }>('scheduledTask.trigger', {
      taskId: task.id,
    });
    const health = await waitFor(
      () => f.ok<{ inFlightRunIds: string[] }>('runtime.healthcheck', {}),
      (value) => value.inFlightRunIds.length === 1,
    );
    const scope = {
      conversationId: trigger.task.conversationId!,
      runId: health.inFlightRunIds[0]!,
    };
    const active = await f.ok<ConversationGetRunProcessResponse>(
      'conversation.getRunProcess',
      scope,
    );
    expect(active.process.steps).toEqual([]);
    expect(active.process.running).toBe(true);
    f.provider.release();
    await waitFor(
      () => f.ok<{ inFlightRunIds: string[] }>('runtime.healthcheck', {}),
      (value) => value.inFlightRunIds.length === 0,
    );
    expect(
      (await f.ok<ConversationGetRunProcessResponse>('conversation.getRunProcess', scope)).process
        .running,
    ).toBe(false);
    await f.restart();
    expect(
      (await f.ok<ConversationGetRunProcessResponse>('conversation.getRunProcess', scope)).process
        .running,
    ).toBe(false);
  });
});

// Projectless conversations still own a task/thread in the internal inbox.
it.each(['model', 'agent'] as const)('reads projectless %s deferred HTML and run process through scoped public RPC', async kind => {
 const f = await fixture();
 const complete = '\u0060\u0060\u0060html\n<!doctype html><html><body><h1>Complete preview</h1><p>' + 'content '.repeat(2300) + '</p></body></html>\n\u0060\u0060\u0060';
 f.provider.responseText = complete;
 const task = (await f.ok<{task:ScheduledTask}>('scheduledTask.create',{name:'Projectless HTML',instruction:'Return isolated fixture HTML',target:kind==='model'?{kind,modelId:'fake-mini'}:{kind,agentId:f.agent.id},rule:{kind:'every',intervalMinutes:30},enabled:false})).task;
 const trigger = await f.ok<{task:ScheduledTask}>('scheduledTask.trigger',{taskId:task.id});
 const conversationId = trigger.task.conversationId!;
 await waitFor(()=>f.ok<{inFlightRunIds:string[]}>('runtime.healthcheck',{}),v=>v.inFlightRunIds.length===0);
 const page = await f.ok<ConversationListMessagesResponse>('conversation.listMessages',{conversationId});
 const answer = page.messages.find(m=>m.role==='assistant')!;
 const part = answer.blocks.find(b=>b.type==='text' && b.contentRef);
 expect(part?.type).toBe('text');
 if (!part || part.type !== 'text' || !part.contentRef) throw Error('Missing deferred fixture');
 const readFull = async () => {
   let text = '', offset = 0, version: string | undefined;
   while (true) {
     const {content} = await f.ok<{content:{text:string;nextOffset?:number;version:string}}>('conversation.readContent',{conversationId,reference:part.contentRef!.reference,offset,...(version?{version}:{})});
     text += content.text; version = content.version;
     if (content.nextOffset === undefined) return text;
     offset = content.nextOffset;
   }
 };
 expect(await readFull()).toBe(complete);
 expect((await f.ok<ConversationGetRunProcessResponse>('conversation.getRunProcess',{conversationId,runId:answer.runId})).process.running).toBe(false);
 expect((await f.rpc('conversation.taskPlanHistory',{conversationId})).error).toBeUndefined();
 const other = (await f.ok<{task:ScheduledTask}>('scheduledTask.create',{name:'Other projectless',instruction:'Other scope',target:{kind:'model',modelId:'fake-mini'},rule:{kind:'every',intervalMinutes:30},enabled:false})).task;
 const foreign = await f.ok<{task:ScheduledTask}>('scheduledTask.trigger',{taskId:other.id});
 await waitFor(()=>f.ok<{inFlightRunIds:string[]}>('runtime.healthcheck',{}),v=>v.inFlightRunIds.length===0);
 expect((await f.rpc('conversation.readContent',{conversationId:foreign.task.conversationId,reference:part.contentRef.reference})).error).toBeTruthy();
 expect((await f.rpc('conversation.getRunProcess',{conversationId:foreign.task.conversationId,runId:answer.runId})).error).toBeTruthy();
 await f.restart();
 expect(await readFull()).toBe(complete);
});


describe('chat scheduled-task execution configuration', () => {
  const configuration = { action: 'create', name: 'Chat configuration', instruction: 'Summarize verified work', target: { kind: 'model', modelId: 'fake-mini' }, rule: { kind: 'every', intervalMinutes: 30 }, timeZone: 'UTC', enabled: false };
  it('lists real workspace/model/agent resources and requires destination choices before creating', async () => {
    const f = await fixture();
    const resources = await f.scheduleTool({ action: 'resources' });
    expect(resources.ok).toBe(true);
    const values = JSON.parse(resources.content!);
    expect(values.defaults.workspaceId).toBe(f.workspace.id);
    expect(values.models).toEqual(expect.arrayContaining([expect.objectContaining({ modelId: 'fake-mini' })]));
    expect(values.workspaces).toEqual(expect.arrayContaining([expect.objectContaining({ workspaceId: f.workspace.id, folderPath: f.workspace.folderPath })]));
    expect(values.agents).toEqual(expect.arrayContaining([expect.objectContaining({ agentId: f.agent.id, defaultModelId: 'fake-mini' })]));
    const missing = await f.scheduleTool(configuration);
    expect(missing.ok).toBe(false); expect(missing.error).toContain('configuration_required');
    expect((await f.ok<{ tasks: ScheduledTask[] }>('scheduledTask.list', {})).tasks).toHaveLength(0);
  });
  it.each(['task', 'new'] as const)('executes the selected %s conversation policy and edits instruction/model/workspace in place', async mode => {
    const f = await fixture();
    const creation = await f.scheduleTool({ ...configuration, workspaceId: f.workspace.id, automation: { executionMode: 'workspace', conversation: { mode } } });
    expect(creation.ok).toBe(true);
    const task = JSON.parse(creation.content!).task as ScheduledTask;
    const trigger = async () => {
      const result = await f.ok<{ fired: boolean; task: ScheduledTask }>('scheduledTask.trigger', { taskId: task.id });
      expect(result.fired).toBe(true);
      await waitFor(() => f.ok<{ inFlightRunIds: string[] }>('runtime.healthcheck', {}), result => result.inFlightRunIds.length === 0);
      return result.task.conversationId;
    };
    const first = await trigger(); const second = await trigger();
    expect(Boolean(first)).toBe(true);
    expect(second === first).toBe(mode === 'task');
    const history = await f.ok<{ entries: unknown[] }>('scheduledTask.history', { taskId: task.id });
    const before = JSON.parse((await f.scheduleTool({ action: 'get', taskId: task.id })).content!).task as ScheduledTask;
    const changed = await f.scheduleTool({ action: 'update', taskId: task.id, patch: { instruction: 'Updated verified instruction', target: { kind: 'model', modelId: 'fake-review' }, workspaceId: null, automation: { conversation: { mode: 'task' } } } });
    expect(changed.ok).toBe(true);
    const saved = JSON.parse(changed.content!).task as ScheduledTask;
    expect(saved).toMatchObject({ id: task.id, instruction: 'Updated verified instruction', target: { kind: 'model', modelId: 'fake-review' }, nextRunAt: before.nextRunAt, createdAt: before.createdAt, enabled: false });
    expect(saved.workspaceId).toBeUndefined(); expect(saved.conversationId).toBeUndefined();
    expect(await f.ok('scheduledTask.history', { taskId: task.id })).toEqual(history);
    expect((await f.ok<{ tasks: ScheduledTask[] }>('scheduledTask.list', {})).tasks).toHaveLength(1);
    await f.restart();
    expect(JSON.parse((await f.scheduleTool({ action: 'get', taskId: task.id })).content!).task).toMatchObject(saved);
  });
  it('keeps browser/MCP/delivery/permission settings on a conversation-only edit and lets the UI edit the same id', async () => {
    const f = await fixture();
    const binding = { executionMode: 'full-access', conversation: { mode: 'task' }, browser: { profileId: 'profile-fixture' }, requiredMcpServerIds: ['mcp-fixture'], outputs: ['spreadsheet'], delivery: { kind: 'gmail', mcpServerId: 'mcp-fixture', recipient: 'fixture@example.com' } };
    const result = await f.scheduleTool({ ...configuration, workspaceId: null, automation: binding });
    expect(result.ok).toBe(true);
    const task = JSON.parse(result.content!).task as ScheduledTask;
    const updated = await f.scheduleTool({ action: 'update', taskId: task.id, patch: { automation: { conversation: { mode: 'new' } } } });
    expect(updated.ok).toBe(true);
    expect(JSON.parse(updated.content!).task.automation).toEqual({ ...binding, conversation: { mode: 'new' } });
    const ui = await f.ok<{ task: ScheduledTask }>('scheduledTask.update', { taskId: task.id, patch: { instruction: 'Edited from the task page' } });
    expect(ui.task.id).toBe(task.id);
    expect(JSON.parse((await f.scheduleTool({ action: 'get', taskId: task.id })).content!).task).toMatchObject({ instruction: 'Edited from the task page', automation: ui.task.automation });
  });
  it('rejects invalid edits atomically and obeys ask-mode denial', async () => {
    const f = await fixture();
    const result = await f.scheduleTool({ ...configuration, workspaceId: f.workspace.id, automation: { conversation: { mode: 'task' } } });
    const before = JSON.parse(result.content!).task as ScheduledTask;
    for (const patch of [{ workspaceId: 'missing-workspace', instruction: 'Should not save' }, { rule: { kind: 'every', intervalMinutes: 1 } }, { instruction: '' }, { automation: { conversation: { mode: 'existing', conversationId: 'missing-chat' } } }, { unknown: true }]) {
      expect((await f.scheduleTool({ action: 'update', taskId: before.id, patch })).ok).toBe(false);
    }
    expect(JSON.parse((await f.scheduleTool({ action: 'get', taskId: before.id })).content!).task).toEqual(before);
    const internal = f.runtime() as unknown as { requestPlatformToolApproval(...args: unknown[]): Promise<'approve' | 'deny'> };
    const approval = vi.spyOn(internal, 'requestPlatformToolApproval').mockResolvedValue('deny');
    try {
      expect((await f.scheduleTool({ action: 'update', taskId: before.id, patch: { instruction: 'Denied edit' } }, 'ask')).ok).toBe(false);
      expect(approval).toHaveBeenCalledOnce();
      expect((await f.scheduleTool({ action: 'get', taskId: before.id }, 'ask')).ok).toBe(true);
      expect(approval).toHaveBeenCalledOnce();
    } finally { approval.mockRestore(); }
    expect(JSON.parse((await f.scheduleTool({ action: 'get', taskId: before.id })).content!).task).toEqual(before);
  });
});
