import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FakeProvider } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteConversationStore,
  SqliteCollaborationStore,
  SqliteGlobalAgentStore,
  SqliteWorkspaceStore,
  SqliteTeamStore,
} from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';
import type { CollaborationExecutionInput } from './collaboration-chat-service.js';

function input(agentId: string, taskId: string, signal: AbortSignal, onProgress: (value: { status: 'running'; output: string }) => void): CollaborationExecutionInput {
  return {
    snapshot: {
      conversation: { id: 'conversation-1', workspaceId: 'workspace-1', kind: 'direct' as const, title: '执行', coordinatorMemberId: `agent:${agentId}`, policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 120, statusTimeoutSeconds: 120 }, createdAt: new Date().toISOString() },
      members: [{ id: `agent:${agentId}`, kind: 'agent' as const, agentId, name: '执行者', avatar: '', role: '', active: true }], messages: [], deliveries: [], tasks: [], attempts: [], revision: 0, receipts: {},
    },
    task: { id: taskId, rootTaskId: taskId, originMessageId: 'message-1', assigneeMemberId: `agent:${agentId}`, title: '测试执行', instructions: '返回测试结果', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'conversation-1', replyToMessageId: 'message-1' }, timeoutSeconds: 120, currentAttemptId: `attempt-${taskId}`, kind: 'task' as const, createdAt: new Date().toISOString() },
    attempt: { id: `attempt-${taskId}`, taskId, number: 1, status: 'running' as const, threadId: `thread-${taskId}`, runId: `run-${taskId}`, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] },
    signal, onProgress,
  };
}

async function fixture(provider: FakeProvider = new FakeProvider()) {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-collaboration-runtime-'));
  const path = join(directory, 'test.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  workspaceStore.createWorkspace({ id: 'workspace-1' as WorkspaceId, name: '运行测试', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const agent = agents.create({ id: 'agent-1' as AgentId, name: '执行者', defaultModelId: 'fake-mini' as ModelId });
  const teams = new SqliteTeamStore(connection.raw);
  const runtime = new Runtime({ teamStore: teams, installId: 'collaboration-runtime', allowNoToken: true, workspaceStore, globalAgentStore: agents, stateStore: new SqliteEventCheckpointStore(connection.raw), demoProvider: provider });
  return { runtime, agent, agents, teams, close: async () => { await runtime.stop(); connection.raw.close(); rmSync(directory, { recursive: true, force: true }); } };
}

async function collaborationToolFixture(options: {
  provider?: FakeProvider;
  execute?: ConstructorParameters<typeof CollaborationChatHost>[1]['execute'];
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-collaboration-tools-'));
  const path = join(directory, 'test.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaceStore.createWorkspace({ id: 'workspace-tools' as WorkspaceId, name: '工具测试' });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const agent = agents.create({ id: 'agent-tools' as AgentId, name: '执行者', defaultModelId: 'fake-mini' as ModelId });
  const peer = agents.create({ id: 'agent-peer' as AgentId, name: '审查者', defaultModelId: 'fake-mini' as ModelId });
  const conversationStore = new SqliteConversationStore(connection.raw);
  const host = new CollaborationChatHost(new SqliteCollaborationStore(connection.raw), {
    ownerId: 'collaboration-tools-test',
    conversations: conversationStore,
    agents,
    workspaces: workspaceStore,
    execute: options.execute ?? (async ({ task }) => ({ output: task.title })),
    onChanged: () => {},
  });
  const runtime = new Runtime({
    installId: 'collaboration-tools-runtime',
    allowNoToken: true,
    workspaceStore,
    conversationStore,
    globalAgentStore: agents,
    stateStore: new SqliteEventCheckpointStore(connection.raw),
    collaborationChatHost: host,
    demoProvider: options.provider ?? new FakeProvider(),
  });
  const close = async () => {
    await runtime.stop();
    connection.raw.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return { runtime, host, workspace, agent, peer, close };
}

describe('collaboration Runtime execution adapter', () => {
  it('returns the final provider text for an assigned agent task', async () => {
    const f = await fixture();
    try {
      const progress: string[] = [];
      const result = await f.runtime.executeCollaborationTaskForHost(input(String(f.agent.id), 'task-1', new AbortController().signal, (value) => progress.push(value.status)));
      expect(result.error).toBeUndefined();
      expect(result.runId).toBeTruthy();
      expect(result.output.trim().length).toBeGreaterThan(0);
      expect(progress).toContain('running');
    } finally { await f.close(); }
  });

  it('keeps a model collaboration task on the conversation model binding', async () => {
    const f = await fixture();
    try {
      const runtimeBinding = f.runtime as unknown as {
        prepareRunBinding(value: Record<string, unknown>): unknown;
      };
      const prepareRunBinding = runtimeBinding.prepareRunBinding.bind(runtimeBinding);
      let bindingInput: Record<string, unknown> | undefined;
      runtimeBinding.prepareRunBinding = (value) => {
        bindingInput = value;
        return prepareRunBinding(value);
      };
      const runInput = input(String(f.agent.id), 'task-model', new AbortController().signal, () => {});
      runInput.snapshot.conversation.kind = 'model';
      runInput.snapshot.conversation.modelId = 'fake-mini';
      runInput.snapshot.conversation.coordinatorMemberId = 'assistant:main';
      runInput.snapshot.members = [{
        id: 'assistant:main', kind: 'assistant', name: '主助手', avatar: '', role: '协调与汇总', active: true,
      }];
      runInput.task.assigneeMemberId = 'assistant:main';

      const result = await f.runtime.executeCollaborationTaskForHost(runInput);

      expect(result.error).toBeUndefined();
      expect(bindingInput).toMatchObject({ track: 'model', modelId: 'fake-mini' });
      expect(bindingInput?.globalAgentId).toBeUndefined();
    } finally { await f.close(); }
  });

  it('does not retain a cancelled task result after the provider finishes late', async () => {
    const f = await fixture();
    try {
      const controller = new AbortController();
      const promise = f.runtime.executeCollaborationTaskForHost(input(String(f.agent.id), 'task-2', controller.signal, () => {}));
      controller.abort();
      const result = await promise;
      expect(result.output).toBe('');
      expect(result.error).toBeUndefined();
    } finally { await f.close(); }
  });
});

describe('collaboration Runtime agent tools', () => {
  it('turns an approved plan revision into idempotent sequential collaboration tasks', async () => {
    const f = await collaborationToolFixture();
    try {
      const created = f.host.command({
        action: 'create', clientRequestId: 'plan-create', kind: 'group', title: '计划协作群',
        workspaceId: f.workspace.id, agentIds: [f.agent.id, f.peer.id], coordinatorAgentId: f.agent.id,
      }).snapshot!;
      const approvedRevision = {
        id: 'revision-2', conversationId: created.conversation.id as import('@sync-think/shared').ConversationId,
        revision: 2, state: 'approved' as const, createdAt: new Date().toISOString(),
        plan: {
          title: '交付功能', goal: '完成实现和验证', scope: [], assumptions: [], decisions: [], risks: [],
          finalAcceptanceChecks: ['全部检查通过'],
          steps: [
            { id: 'implement', title: '实现', description: '完成代码修改', expectedFiles: ['src/a.ts'], acceptanceChecks: ['单测通过'] },
            { id: 'verify', title: '验证', description: '完成回归验证', acceptanceChecks: ['构建通过'] },
          ],
        },
      };

      const first = f.host.dispatchApprovedPlan(created.conversation.id, 'plan-1', approvedRevision);
      const second = f.host.dispatchApprovedPlan(created.conversation.id, 'plan-1', approvedRevision);

      expect(first.taskIds).toHaveLength(2);
      expect(second.taskIds).toEqual(first.taskIds);
      expect(second.snapshot.tasks).toHaveLength(2);
      expect(second.snapshot.tasks[0]).toMatchObject({
        assigneeMemberId: `agent:${f.agent.id}`,
        planRef: { planId: 'plan-1', revision: 2, stepId: 'implement' },
        dependsOnTaskIds: [],
      });
      expect(second.snapshot.tasks[1]).toMatchObject({
        assigneeMemberId: `agent:${f.agent.id}`,
        planRef: { planId: 'plan-1', revision: 2, stepId: 'verify' },
        dependsOnTaskIds: [first.taskIds[0]],
      });
    } finally {
      await f.close();
    }
  });

  it('retries a failed delivery in SQLite without inserting a duplicate recipient row', async () => {
    const f = await collaborationToolFixture({
      execute: async () => ({
        output: '',
        error: {
          code: 'fixture_failure', category: 'execution', message: '第一次执行失败',
          retryable: true, traceId: 'fixture-trace',
        },
      }),
    });
    try {
      const created = f.host.command({
        action: 'create', clientRequestId: 'retry-create', kind: 'direct', title: '重试单聊',
        workspaceId: f.workspace.id, agentIds: [f.agent.id],
      }).snapshot!;
      const sent = f.host.command({
        action: 'send', conversationId: created.conversation.id, clientRequestId: 'retry-send',
        text: '请执行', recipientMemberIds: [`agent:${f.agent.id}`], expectsResponse: true,
      }).snapshot!;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const failed = f.host.command({ action: 'get', conversationId: created.conversation.id }).snapshot!;
      const task = failed.tasks[0]!;
      expect(failed.attempts.find((attempt) => attempt.id === task.currentAttemptId)?.status).toBe('failed');

      const retried = f.host.command({
        action: 'retry', conversationId: created.conversation.id,
        taskId: task.id, clientRequestId: 'retry-attempt-2',
      }).snapshot!;

      expect(retried.attempts.filter((attempt) => attempt.taskId === task.id)).toHaveLength(2);
      expect(retried.deliveries.filter((delivery) => delivery.messageId === sent.messages[0]!.id)).toHaveLength(1);
    } finally {
      await f.close();
    }
  });

  it('injects the executing agent identity when sending a collaboration message', async () => {
    const f = await collaborationToolFixture();
    try {
      const created = f.host.command({
        action: 'create',
        clientRequestId: 'tool-create-1',
        kind: 'direct',
        title: '工具单聊',
        workspaceId: f.workspace.id,
        agentIds: [f.agent.id],
      });
      const conversationId = created.snapshot!.conversation.id;
      const origin = f.host.command({
        action: 'send',
        conversationId,
        clientRequestId: 'tool-origin-1',
        text: '请回复',
        recipientMemberIds: ['user:local'],
        expectsResponse: false,
      }).snapshot!.messages.at(-1)!;
      const toolCall = {
        id: 'tool-call-1',
        name: 'collaboration_send_message',
        argumentsJson: JSON.stringify({
          text: '执行者已完成',
          recipientMemberIds: ['user:local'],
          replyToMessageId: origin.id,
          expectsResponse: false,
          senderMemberId: 'user:local',
        }),
      } as const;
      const result = JSON.parse((f.runtime as unknown as { executeChatCollaborationTool(input: unknown): string })
        .executeChatCollaborationTool({
          run: { threadId: conversationId, track: 'agent', globalAgentId: f.agent.id },
          toolCall,
          args: JSON.parse(toolCall.argumentsJson),
        }));
      expect(result.ok).toBe(true);
      const snapshot = f.host.command({ action: 'get', conversationId }).snapshot!;
      const message = snapshot.messages.at(-1)!;
      expect(message.senderMemberId).toBe(`agent:${f.agent.id}`);
      expect(message.blocks).toEqual([{ type: 'text', text: '执行者已完成' }]);
    } finally {
      await f.close();
    }
  });

  it('rejects the collaboration tools when the run is not bound to a collaboration conversation', async () => {
    const f = await collaborationToolFixture();
    try {
      const result = JSON.parse((f.runtime as unknown as { executeChatCollaborationTool(input: unknown): string })
        .executeChatCollaborationTool({
          run: { threadId: 'ordinary-thread', track: 'agent', globalAgentId: f.agent.id },
          toolCall: { id: 'tool-call-2', name: 'collaboration_send_message', argumentsJson: '{"text":"x"}' },
          args: { text: 'x' },
        }));
      expect(result).toEqual({ ok: false, error: '当前运行不在协作会话中。' });
    } finally {
      await f.close();
    }
  });

  it('routes an external kernel collaboration tool call through the host tool dispatch', async () => {
    const f = await collaborationToolFixture();
    try {
      const created = f.host.command({
        action: 'create',
        clientRequestId: 'kernel-create-1',
        kind: 'direct',
        title: '内核单聊',
        workspaceId: f.workspace.id,
        agentIds: [f.agent.id],
      });
      const conversationId = created.snapshot!.conversation.id;
      const origin = f.host.command({
        action: 'send',
        conversationId,
        clientRequestId: 'kernel-origin-1',
        text: '请回复',
        expectsResponse: false,
      }).snapshot!.messages.at(-1)!;
      // The exact path an external kernel (claude-code / codex / pi) takes:
      // platform MCP tool → executeHostPlatformTool → agent dispatch → the
      // collaboration executor, with the sender identity injected by the host.
      const result = JSON.parse(
        await (
          f.runtime as unknown as {
            executeHostPlatformTool(
              run: unknown,
              toolCall: unknown,
              workspaceRoot: string,
            ): Promise<string>;
          }
        ).executeHostPlatformTool(
          { threadId: conversationId, track: 'agent', globalAgentId: f.agent.id, runId: 'run-kernel' },
          {
            id: 'kernel-call-1',
            name: 'collaboration_send_message',
            argumentsJson: JSON.stringify({
              text: '来自内核的消息',
              replyToMessageId: origin.id,
              expectsResponse: false,
            }),
          },
          '',
        ),
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const snapshot = f.host.command({ action: 'get', conversationId }).snapshot!;
      const message = snapshot.messages.at(-1)!;
      expect(message.senderMemberId).toBe(`agent:${f.agent.id}`);
      expect(message.blocks).toEqual([{ type: 'text', text: '来自内核的消息' }]);
    } finally {
      await f.close();
    }
  });

  it('routes structured task dispatch through the collaboration host', async () => {
    const f = await collaborationToolFixture();
    try {
      const created = f.host.command({
        action: 'create',
        clientRequestId: 'dispatch-create-1',
        kind: 'direct',
        title: '任务单聊',
        workspaceId: f.workspace.id,
        agentIds: [f.agent.id],
      });
      const conversationId = created.snapshot!.conversation.id;
      const origin = f.host.command({
        action: 'send',
        conversationId,
        clientRequestId: 'dispatch-origin-1',
        text: '请分派任务',
        expectsResponse: false,
      }).snapshot!.messages.at(-1)!;
      const result = JSON.parse((f.runtime as unknown as { executeChatCollaborationTool(input: unknown): string })
        .executeChatCollaborationTool({
          run: { threadId: conversationId, track: 'agent', globalAgentId: f.agent.id },
          toolCall: { id: 'dispatch-call-1', name: 'collaboration_dispatch_tasks', argumentsJson: '{}' },
          args: {
            originMessageId: origin.id,
            tasks: [{ assigneeMemberId: `agent:${f.agent.id}`, title: '整理资料', instructions: '输出三条要点' }],
          },
        }));
      expect(result.ok).toBe(true);
      const snapshot = f.host.command({ action: 'get', conversationId }).snapshot!;
      expect(snapshot.tasks).toHaveLength(1);
      expect(snapshot.tasks[0]!.assigneeMemberId).toBe(`agent:${f.agent.id}`);
      expect(snapshot.tasks[0]!.instructions).toBe('输出三条要点');
      const activities = f.host.command({ action: 'activity', workspaceId: f.workspace.id }).activities!;
      expect(activities).toEqual(expect.arrayContaining([
        expect.objectContaining({
          conversationId, taskId: snapshot.tasks[0]!.id, taskTitle: '整理资料', assigneeName: '执行者',
        }),
      ]));
    } finally {
      await f.close();
    }
  });

  it('opens an associated peer direct chat and preserves the parent message reference', async () => {
    const f = await collaborationToolFixture();
    try {
      const group = f.host.command({
        action: 'create', clientRequestId: 'peer-group-create', kind: 'group', title: '协作群',
        workspaceId: f.workspace.id, agentIds: [f.agent.id, f.peer.id], coordinatorAgentId: f.agent.id,
      }).snapshot!;
      f.host.command({
        action: 'policy', conversationId: group.conversation.id, policy: { allowPeerDirect: true },
      });
      const origin = f.host.command({
        action: 'send', conversationId: group.conversation.id, clientRequestId: 'peer-origin',
        text: '请私下核对这一点', recipientMemberIds: [`agent:${f.agent.id}`], expectsResponse: false,
      }).snapshot!.messages.at(-1)!;
      const toolCall = {
        id: 'peer-direct-call', name: 'collaboration_send_direct_message',
        argumentsJson: JSON.stringify({
          recipientMemberId: `agent:${f.peer.id}`, text: '请核对接口约束',
          originMessageId: origin.id, expectsResponse: false,
        }),
      } as const;

      const result = JSON.parse((f.runtime as unknown as { executeChatCollaborationTool(input: unknown): string })
        .executeChatCollaborationTool({
          run: { threadId: group.conversation.id, track: 'agent', globalAgentId: f.agent.id, runId: 'peer-run' },
          toolCall, args: JSON.parse(toolCall.argumentsJson),
        }));

      expect(result.ok, JSON.stringify(result)).toBe(true);
      const direct = f.host.command({ action: 'get', conversationId: result.conversationId }).snapshot!;
      expect(direct.conversation.parentConversationId).toBe(group.conversation.id);
      expect(direct.messages.at(-1)?.senderMemberId).toBe(`agent:${f.agent.id}`);
      expect(direct.messages.at(-1)?.contextRefs).toEqual([{
        conversationId: group.conversation.id, messageId: origin.id,
      }]);

      const queued = structuredClone(direct);
      const linkedMessage = queued.messages.at(-1)!;
      const queuedMessage = {
        ...linkedMessage,
        id: 'peer-queued-message',
        blocks: [{ type: 'text' as const, text: '等待执行的消息' }],
        sequence: linkedMessage.sequence + 1,
      };
      queued.messages.push(queuedMessage);
      queued.tasks.push({
        id: 'peer-queued-task', rootTaskId: 'peer-queued-task', originMessageId: queuedMessage.id,
        assigneeMemberId: `agent:${f.peer.id}`, title: '尚未开始', instructions: '等待执行',
        expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [],
        returnTo: { conversationId: queued.conversation.id, replyToMessageId: queuedMessage.id },
        timeoutSeconds: 120, currentAttemptId: 'peer-queued-attempt', kind: 'reply',
        createdAt: new Date().toISOString(),
      });
      queued.attempts.push({
        id: 'peer-queued-attempt', taskId: 'peer-queued-task', number: 1, status: 'queued',
        updatedAt: new Date().toISOString(), contextSequence: queuedMessage.sequence, output: '',
        resourceClaims: [], tools: [], checklist: [],
      });
      queued.deliveries.push({
        id: 'peer-queued-delivery', messageId: queuedMessage.id,
        recipientMemberId: `agent:${f.peer.id}`, status: 'queued', attemptId: 'peer-queued-attempt',
      });
      queued.revision += 1;
      f.host.repository.save(queued);

      f.host.command({
        action: 'policy', conversationId: group.conversation.id, policy: { allowPeerDirect: false },
      });
      const revoked = f.host.command({ action: 'get', conversationId: direct.conversation.id }).snapshot!;
      expect(revoked.attempts.find((attempt) => attempt.id === 'peer-queued-attempt')?.status).toBe('cancelled');
      expect(revoked.deliveries.find((delivery) => delivery.id === 'peer-queued-delivery')?.status).toBe('cancelled');
    } finally {
      await f.close();
    }
  });
});

it('reports native provider failure instead of returning a successful empty answer', async () => {
  class FailingProvider extends FakeProvider {
    override async *call() { yield { type: 'error' as const, failureClass: 'permission' as const, message: 'fixture provider denied request' }; }
  }
  const f = await fixture(new FailingProvider());
  try {
    const result = await f.runtime.executeCollaborationTaskForHost(input(String(f.agent.id), 'task-failure', new AbortController().signal, () => {}));
    expect(result.error).toMatchObject({ category: 'execution', retryable: true });
    expect(result.error?.message.length).toBeGreaterThan(0);
  } finally { await f.close(); }
});
it('reports missing agent bindings and keeps the executor available', async () => {
  const f = await fixture();
  try {
    const result = await f.runtime.executeCollaborationTaskForHost(input('missing', 'task-missing', new AbortController().signal, () => {}));
    expect(result.error?.message).toContain('AGENT_NOT_FOUND');
    const next = await f.runtime.executeCollaborationTaskForHost(input(String(f.agent.id), 'task-valid', new AbortController().signal, () => {}));
    expect(next.output.trim()).not.toBe('');
  } finally { await f.close(); }
});

it('reports a deleted agent model as failure without calling the demo provider', async () => {
  const provider = new FakeProvider(); const call = vi.spyOn(provider, 'call');
  const f = await fixture(provider);
  try {
    f.agents.update({ agentId: f.agent.id, defaultModelId: 'deleted-live-model' as ModelId });
    const result = await f.runtime.executeCollaborationTaskForHost(input(f.agent.id, 'invalid-binding', new AbortController().signal, () => {}));
    expect(result.error?.message).toContain('MODEL_BINDING_UNAVAILABLE');
    expect(result.output).toBe(''); expect(call).not.toHaveBeenCalled();
  } finally { await f.close(); }
});
it('does not replace a live run with FakeProvider when credentials are missing', async () => {
  const provider = new FakeProvider(); const call = vi.spyOn(provider, 'call');
  const f = await fixture(provider);
  try {
    const internal = f.runtime as unknown as { prepareRunBinding(input: object): { run: import('./demo-run.js').DemoRunState }; openProviderStream(run: import('./demo-run.js').DemoRunState, options: object, signal: AbortSignal): Promise<unknown> };
    const { run } = internal.prepareRunBinding({ runId: 'missing-credential', threadId: 'credential-thread', userText: 'hello', globalAgentId: f.agent.id });
    run.useFakeProvider = false;
    await expect(internal.openProviderStream(run, { toolsEnabled: false }, new AbortController().signal)).rejects.toThrow('MODEL_CREDENTIAL_UNAVAILABLE');
    expect(call).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it('advertises only allowed tools and keeps group member identity in read-only replies', async () => {
  const provider = new FakeProvider(); const call = vi.spyOn(provider, 'call');
  const f = await fixture(provider);
  try {
    const request = input(f.agent.id, 'readonly-reply', new AbortController().signal, () => {});
    request.task.kind = 'reply'; request.snapshot.conversation.kind = 'group';
    const result = await f.runtime.executeCollaborationTaskForHost(request);
    expect(result.error).toBeUndefined(); expect(call).toHaveBeenCalled();
    const providerRequest = call.mock.calls[0][0];
    const toolNames = providerRequest.tools?.map(tool => tool.name) ?? [];
    expect(toolNames).toContain('read_file');
    expect(toolNames).not.toContain('write_file');
    expect(toolNames).not.toContain('update_task_plan');
    expect(toolNames).not.toContain('run_command');
    expect(providerRequest.systemPrompt).toContain('直接参与这场对话');
    expect(providerRequest.systemPrompt).toContain('用户说先讨论时');
    expect(providerRequest.systemPrompt).not.toContain('you MAY call write_file');
    expect(providerRequest.systemPrompt).not.toContain('call update_task_plan FIRST');
  } finally { await f.close(); }
});

it('never leaks a native tool preamble into collaboration answer progress', async () => {
  class PreambleProvider extends FakeProvider {
    rounds = 0;
    override async *call() {
      if (this.rounds++ === 0) {
        yield { type: 'text-delta' as const, text: '我先检查' };
        yield { type: 'tool-call' as const, toolCall: { id: 'read-1', name: 'list_files', argumentsJson: '{"path":"."}' } };
        yield { type: 'finished' as const, reason: 'tool-requests' as const };
      } else {
        yield { type: 'assistant-message-delta' as const, phase: 'final_answer' as const, text: '我们先讨论你的想法。' };
        yield { type: 'finished' as const, reason: 'stop' as const };
      }
    }
  }
  const f = await fixture(new PreambleProvider());
  try {
    const updates: import('./collaboration-chat-service.js').CollaborationProgress[] = [];
    const request = input(f.agent.id, 'stream-phases', new AbortController().signal, progress => updates.push(progress));
    request.task.kind = 'reply';
    const result = await f.runtime.executeCollaborationTaskForHost(request);
    expect(result.error).toBeUndefined(); expect(result.output).toBe('我们先讨论你的想法。');
    expect(updates.some(progress => progress.output?.includes('我先'))).toBe(false);
    expect(updates.some(progress => progress.commentary === '我先检查')).toBe(true);
    expect(updates.some(progress => progress.output === result.output)).toBe(true);
  } finally { await f.close(); }
});

it('keeps the read-only guard even if a group member asks for an unadvertised write tool', async () => {
  class InvalidWriteProvider extends FakeProvider {
    rounds = 0;
    rejection = '';
    override async *call(request: Parameters<FakeProvider['call']>[0]) {
      if (this.rounds++ === 0) {
        yield { type: 'tool-call' as const, toolCall: { id: 'write-1', name: 'write_file', argumentsJson: '{"path":"blocked.txt","content":"blocked"}' } };
        yield { type: 'finished' as const, reason: 'tool-requests' as const };
      } else {
        this.rejection = JSON.stringify(request.messages?.filter(message => message.role === 'tool'));
        yield { type: 'text-delta' as const, text: '我们在聊天中讨论。' };
        yield { type: 'finished' as const, reason: 'stop' as const };
      }
    }
  }
  const provider = new InvalidWriteProvider(); const f = await fixture(provider);
  try {
    const request = input(f.agent.id, 'guarded-group-reply', new AbortController().signal, () => {}); request.task.kind = 'reply';
    const result = await f.runtime.executeCollaborationTaskForHost(request);
    expect(result.error).toBeUndefined(); expect(provider.rejection).toContain('当前群聊轮次仅允许读取和讨论');
    expect(provider.rejection).not.toContain('Delegated child Agents');
  } finally { await f.close(); }
});

it.each(['reply','task','summary'] as const)('only a direct user reply can manage definitions, not a %s execution', async kind => {
 const provider=new FakeProvider();const call=vi.spyOn(provider,'call');const f=await fixture(provider);
 try {
  const request=input(f.agent.id,'management-'+kind,new AbortController().signal,()=>{});request.task.kind=kind;request.task.instructions='帮我创建一个研究智能体';
  request.snapshot.members.push({id:'user:local',kind:'user',name:'用户',avatar:'',role:'用户',active:true});
  request.snapshot.messages.push({id:'message-1',conversationId:request.snapshot.conversation.id,senderMemberId:'user:local',recipientMemberIds:[request.task.assigneeMemberId],mentions:[],kind:'chat',blocks:[{type:'text',text:'帮我创建一个研究智能体'}],expectsResponse:true,correlationId:'intent',hopCount:0,sequence:1,createdAt:new Date().toISOString()});
  request.attempt.contextSequence=1;
  const result=await f.runtime.executeCollaborationTaskForHost(request);expect(result.error).toBeUndefined();
  const names=call.mock.calls[0][0].tools?.map(t=>t.name)??[];
  expect(names.includes('create_agent')).toBe(kind==='reply');expect(names.includes('update_agent')).toBe(kind==='reply');if(kind==='reply') expect(names).not.toContain('write_file');
 }finally{await f.close();}
});
it('execution guard rejects autonomous creation and management-round delegation even for unadvertised calls',async()=>{
 const f=await fixture();try{
 const internal=f.runtime as unknown as {
  prepareRunBinding(input:object):{run:import('./demo-run.js').DemoRunState};
  executeChatAgentTool(input:object):Promise<string>;
  executeDynamicAgentDelegation(input:object):Promise<string>;
 };
 const {run}=internal.prepareRunBinding({runId:'intent-guard',threadId:'intent-thread',userText:'修复代码',globalAgentId:f.agent.id});
 const result=JSON.parse(await internal.executeChatAgentTool({run,toolCall:{id:'auto-create',name:'create_agent',argumentsJson:'{}'},args:{name:'偷偷创建的助手'}}));
 expect(result.ok).toBe(false);expect(f.agents.list().some(a=>a.name==='偷偷创建的助手')).toBe(false);
 run.definitionProposalsAllowed=true;run.userText='帮我创建一个智能体';
 const delegated=JSON.parse(await internal.executeDynamicAgentDelegation({run,toolCall:{id:'auto-run',name:'agent_run',argumentsJson:'{}'},workspaceRoot:'.',signal:new AbortController().signal}));
 expect(delegated.ok).toBe(false);expect(delegated.error).toContain('不自动启动');
 }finally{await f.close();}
});

it.each(['create_agent','update_agent','create_team','update_team','delete_team'])('never reuses remembered approval for %s and exposes only once scope',async name=>{
 const f=await fixture();const controller=new AbortController();
 try{
 const internal=f.runtime as unknown as {
  requestChatToolApproval(input:object):Promise<{decision:string}>;
  toolApprovalPolicy:{isAllowed(input:object):boolean};
  publishEvent(event:import('@sync-think/shared').Event):void;
 };
 const remembered=vi.spyOn(internal.toolApprovalPolicy,'isAllowed').mockReturnValue(true);const published=vi.spyOn(internal,'publishEvent');
 const waiting=internal.requestChatToolApproval({runId:'confirm-definition',threadId:'confirm-thread',executionMode:'full-access',toolCall:{id:'confirm-call',name,argumentsJson:'{"name":"研究员"}'},signal:controller.signal});
 expect(remembered).not.toHaveBeenCalled();
 const request=published.mock.calls.find(([event])=>event.type==='tool.approval_requested')?.[0];
 expect(request?.payload.allowedScopes).toEqual(['once']);controller.abort();expect((await waiting).decision).toBe('deny');
 }finally{controller.abort();await f.close();}
});

it('creates an actual team from agent-chat management tools and rejects accidental or invented members', async () => {
  const f = await fixture();
  try {
    const internal = f.runtime as unknown as { prepareRunBinding(input: object): { run: import('./demo-run.js').DemoRunState }; executeChatTeamTool(input: object): string; recordDefinitionApproval(run: import('./demo-run.js').DemoRunState, call: import('@sync-think/adapters').ProviderToolCall): void };
    const { run } = internal.prepareRunBinding({ runId: 'team-create', threadId: 'team-chat', userText: '帮我用现有智能体创建一个测试小队', globalAgentId: f.agent.id, definitionProposalsAllowed: true });
    const startRun = vi.spyOn(f.teams, 'startRun');
    const toolCall = { id: 'team-tool', name: 'create_team', argumentsJson: JSON.stringify({ name: '聊天创建的小队', coordinatorAgent: f.agent.id, members: [{ agent: f.agent.id, title: '负责人' }] }) };
    expect(JSON.parse(internal.executeChatTeamTool({ run, toolCall })).error).toContain('fresh_confirmation_required');
    internal.recordDefinitionApproval(run, toolCall);
    const result = JSON.parse(internal.executeChatTeamTool({ run, toolCall }));
    expect(result.ok).toBe(true);
    const saved = f.teams.get(result.team.id);
    expect(saved?.members[0].agentId).toBe(f.agent.id);
    expect(saved?.coordinatorAgentId).toBe(f.agent.id);
    expect(startRun).not.toHaveBeenCalled();
    expect(JSON.parse(internal.executeChatTeamTool({ run, toolCall })).error).toContain('fresh_confirmation_required');
    const invalidCall = { ...toolCall, id: 'invalid-member', argumentsJson: JSON.stringify({ name: '错误成员队', members: [{ agent: 'invented-id' }] }) };
    internal.recordDefinitionApproval(run, invalidCall);
    const invalid = JSON.parse(internal.executeChatTeamTool({ run, toolCall: invalidCall }));
    expect(invalid.ok).toBe(false); expect(f.teams.list()).toHaveLength(1);
    run.userText = '帮我写小说';
    expect(JSON.parse(internal.executeChatTeamTool({ run, toolCall })).ok).toBe(false);
    expect(f.teams.list()).toHaveLength(1);
  } finally { await f.close(); }
});

it.each(['帮我创建一个测试小队，复用执行者，并创建一个编辑智能体加入新小队', '帮我创建一个team，复用执行者，并创建一个编辑agent加入新team', '那按刚才我们说的，我要一个分析项目的team，你帮我创建吧，如果有不懂的，或者有哪里有疑惑，我们要先讨论', '按刚才的方案创建吧'])('completes agent + team creation through an actual tool loop with separate confirmations: %s', async text => {
  class TeamBuilder extends FakeProvider {
    round = 0;
    newAgentId = '';
    override async *call(request: Parameters<FakeProvider['call']>[0]) {
      const round = this.round++;
      const names = request.tools?.map(tool => tool.name) ?? [];
      expect(names).toContain('create_team'); expect(names).toContain('create_agent');
      expect(names).not.toContain('agent_run'); expect(names).not.toContain('collaboration_dispatch_tasks');
      const toolResults = request.messages?.filter(message => message.role === 'tool') ?? [];
      const latest = toolResults.at(-1)?.content;
      const result = typeof latest === 'string' ? JSON.parse(latest) : undefined;
      let call: { name: string; args: object };
      if (round === 0) call = { name: 'list_agent_resources', args: {} };
      else if (round === 1) { expect(result.ok).toBe(true); call = { name: 'list_teams', args: {} }; }
      else if (round === 2) { expect(result.ok).toBe(true); call = { name: 'create_agent', args: { name: '聊天创建的编辑', persona: '校对与审稿' } }; }
      else if (round === 3) {
        expect(result.ok).toBe(true); this.newAgentId = result.agent.id;
        call = { name: 'create_team', args: { name: '聊天建队端到端验收', coordinatorAgent: 'agent-1', members: [{ agent: 'agent-1', title: '负责人' }, { agent: this.newAgentId, title: '编辑', dependsOn: ['agent-1'] }] } };
      } else {
        expect(result.ok).toBe(true);
        yield { type: 'text-delta' as const, text: '智能体和小队已保存，没有启动工作。' };
        yield { type: 'finished' as const, reason: 'stop' as const }; return;
      }
      yield { type: 'tool-call' as const, toolCall: { id: `builder-${round}`, name: call.name, argumentsJson: JSON.stringify(call.args) } };
      yield { type: 'finished' as const, reason: 'tool-requests' as const };
    }
  }
  const provider = new TeamBuilder(); const f = await fixture(provider);
  try {
    const internal = f.runtime as unknown as { requestChatToolApproval(input: unknown): Promise<unknown> };
    const approvals = vi.spyOn(internal, 'requestChatToolApproval').mockResolvedValue({ decision: 'approve', approvalId: 'explicit-test-confirmation' });
    const request = input(f.agent.id, 'team-builder-reply', new AbortController().signal, () => {});

    request.task.kind = 'reply'; request.task.instructions = text;
    request.snapshot.members.push({ id: 'user:local', kind: 'user', name: '你', avatar: '', role: '用户', active: true });
    request.snapshot.messages.push({ id: 'message-1', conversationId: request.snapshot.conversation.id, senderMemberId: 'user:local', recipientMemberIds: [request.task.assigneeMemberId], mentions: [], kind: 'chat', blocks: [{ type: 'text', text }], expectsResponse: true, correlationId: 'builder', hopCount: 0, sequence: 1, createdAt: new Date().toISOString() });
    request.attempt.contextSequence = 1;
    const result = await f.runtime.executeCollaborationTaskForHost(request);
    expect(result.error).toBeUndefined(); expect(result.output).toContain('已保存');
    expect(approvals).toHaveBeenCalledTimes(2);
    expect(f.agents.get(provider.newAgentId)?.name).toBe('聊天创建的编辑');
    expect(f.agents.get(provider.newAgentId)?.avatar).toBe('bot:v1:clover:preset');
    expect(f.teams.list()).toHaveLength(1);
    expect(f.teams.list()[0].members.map(member => member.agentId)).toEqual(['agent-1', provider.newAgentId]);
    expect(f.teams.list()[0].members[1].dependsOn).toEqual(['agent-1']);
  } finally { await f.close(); }
});

it.each(['你现在不能创建team嘛？', '能创建team？'])('answers capability inquiries using a stable proposal catalog without configuration writes: %s', async text => {
  class CapabilityInspector extends FakeProvider {
    round = 0;
    override async *call(request: Parameters<FakeProvider['call']>[0]) {
      const names = request.tools?.map(tool => tool.name) ?? [];
      expect(names).toContain('list_agent_resources'); expect(names).toContain('list_teams');
      for (const name of ['create_agent', 'update_agent', 'create_team', 'update_team', 'delete_team']) expect(names).toContain(name);
      for (const name of ['agent_run', 'agent_delegate', 'collaboration_dispatch_tasks']) expect(names).not.toContain(name);
      expect(request.systemPrompt).toContain('当前宿主也支持 list_teams/create_team');
      expect(request.systemPrompt).toContain('不依赖动态派工开关');
      expect(request.systemPrompt).toContain('能力询问只提供资源查询');
      const round = this.round++;
      if (round > 0) {
        const latest = request.messages?.filter(message => message.role === 'tool').at(-1)?.content;
        expect(typeof latest === 'string' ? JSON.parse(latest).ok : false).toBe(true);
      }
      if (round < 2) {
        yield { type: 'tool-call' as const, toolCall: { id: `inspect-${round}`, name: round === 0 ? 'list_agent_resources' : 'list_teams', argumentsJson: '{}' } };
        yield { type: 'finished' as const, reason: 'tool-requests' as const }; return;
      }
      yield { type: 'text-delta' as const, text: '支持创建小队。明确名称和成员后，我会提交配置让你确认。' };
      yield { type: 'finished' as const, reason: 'stop' as const };
    }
  }
  const provider = new CapabilityInspector(); const f = await fixture(provider);
  try {
    const internal = f.runtime as unknown as { requestChatToolApproval(input: unknown): Promise<unknown>; prepareRunBinding(input: object): { run: import('./demo-run.js').DemoRunState }; executeChatTeamTool(input: object): string; executeChatAgentTool(input: object): Promise<string> };
    const approvals = vi.spyOn(internal, 'requestChatToolApproval');
    const request = input(f.agent.id, 'capability-inquiry', new AbortController().signal, () => {});
    request.task.kind = 'reply'; request.task.instructions = text;
    request.snapshot.members.push({ id: 'user:local', kind: 'user', name: '你', avatar: '', role: '用户', active: true });
    request.snapshot.messages.push({ id: 'message-1', conversationId: request.snapshot.conversation.id, senderMemberId: 'user:local', recipientMemberIds: [request.task.assigneeMemberId], mentions: [], kind: 'chat', blocks: [{ type: 'text', text }], expectsResponse: true, correlationId: 'inspect', hopCount: 0, sequence: 1, createdAt: new Date().toISOString() });
    request.attempt.contextSequence = 1;
    const result = await f.runtime.executeCollaborationTaskForHost(request);
    expect(result.error).toBeUndefined(); expect(result.output).toContain('支持创建小队');
    expect(provider.round).toBe(3); expect(approvals).not.toHaveBeenCalled();
    // Even a fabricated call in a private chat stays behind the execution fence.
    const { run } = internal.prepareRunBinding({ runId: 'inspection-guard', threadId: 'inspection-thread', userText: text, globalAgentId: f.agent.id, track: 'agent', definitionProposalsAllowed: true });
    expect(JSON.parse(internal.executeChatTeamTool({ run, toolCall: { id: 'bad-team', name: 'create_team', argumentsJson: JSON.stringify({ name: '不应保存', members: [{ agent: f.agent.id }] }) } })).ok).toBe(false);
    expect(JSON.parse(await internal.executeChatAgentTool({ run, toolCall: { id: 'bad-agent', name: 'create_agent', argumentsJson: '{}' }, args: { name: '不应保存' } })).ok).toBe(false);
    expect(f.agents.list()).toHaveLength(1); expect(f.teams.list()).toHaveLength(0);
  } finally { await f.close(); }
});

it('builds the real private-agent context for the exact user capability question', async () => {
  const f = await fixture();
  try {
    const internal = f.runtime as unknown as { prepareRunBinding(input: object): { run: import('./demo-run.js').DemoRunState }; buildDefaultProviderContextSnapshot(run: import('./demo-run.js').DemoRunState, options: object): { providerRequest: { systemPrompt: string; tools: Array<{ name: string }> } } };
    const text = '你现在不能创建team嘛？';
    const { run } = internal.prepareRunBinding({ runId: 'private-capability', threadId: 'private-thread', userText: text, globalAgentId: f.agent.id, track: 'agent', definitionProposalsAllowed: true });
    const { providerRequest } = internal.buildDefaultProviderContextSnapshot(run, { messages: [{ role: 'user', content: text }], toolsEnabled: true, executionMode: 'full-access', networkEnabled: false });
    const names = providerRequest.tools.map(tool => tool.name);
    expect(names).toContain('list_agent_resources'); expect(names).toContain('list_teams');
    expect(names).toContain('create_team'); expect(names).toContain('create_agent');
    expect(providerRequest.systemPrompt).toContain('当前宿主也支持 list_teams/create_team');
    expect(providerRequest.systemPrompt).toContain('历史回复中的旧工具清单可能已过期');
  } finally { await f.close(); }
});


it.each(['现在呢？', '按刚才的方案创建吧', '那按刚才我们说的，我要一个分析项目的team，你帮我创建吧，如果有不懂的，或者有哪里有疑惑，我们要先讨论'])('keeps the actual private-agent proposal catalog stable: %s', async text => {
  const f = await fixture();
  try {
    const internal = f.runtime as unknown as { prepareRunBinding(input: object): { run: import('./demo-run.js').DemoRunState }; buildDefaultProviderContextSnapshot(run: import('./demo-run.js').DemoRunState, options: object): { providerRequest: { tools?: Array<{ name: string }> } } };
    const { run } = internal.prepareRunBinding({ runId: 'stable-private', threadId: 'stable-thread', userText: text, globalAgentId: f.agent.id, track: 'agent', definitionProposalsAllowed: true });
    const names = internal.buildDefaultProviderContextSnapshot(run, { messages: [{ role: 'user', content: text }], toolsEnabled: true, executionMode: 'full-access', networkEnabled: false }).providerRequest.tools?.map(tool => tool.name) ?? [];
    expect(names).toContain('list_agent_resources'); expect(names).toContain('list_teams'); expect(names).toContain('create_agent'); expect(names).toContain('create_team');
  } finally { await f.close(); }
});

it.each(['background', 'delegated', 'planning'] as const)('never broadens a %s run into a definition proposer', async scope => {
  const f = await fixture();
  try {
    const internal = f.runtime as unknown as { prepareRunBinding(input: object): { run: import('./demo-run.js').DemoRunState }; canProposeAgentDefinitions(run: import('./demo-run.js').DemoRunState): boolean; buildDefaultProviderContextSnapshot(run: import('./demo-run.js').DemoRunState, options: object): { providerRequest: { tools?: Array<{ name: string }> } } };
    const { run } = internal.prepareRunBinding({ runId: 'restricted', threadId: 'restricted-thread', userText: '帮我创建一个team', globalAgentId: f.agent.id, track: 'agent', definitionProposalsAllowed: scope !== 'background' });
    if (scope === 'delegated') run.delegationParentRunId = 'parent' as never;
    if (scope === 'planning') run.planningMode = true;
    expect(internal.canProposeAgentDefinitions(run)).toBe(false);
    const names = internal.buildDefaultProviderContextSnapshot(run, { messages: [{ role: 'user', content: run.userText }], toolsEnabled: true, executionMode: 'full-access', networkEnabled: false }).providerRequest.tools?.map(tool => tool.name) ?? [];
    for (const tool of ['create_agent', 'update_agent', 'create_team', 'update_team', 'delete_team']) expect(names).not.toContain(tool);
  } finally { await f.close(); }
});


it.each(['approve', 'deny'] as const)('external MCP definition proposals honor fresh %s confirmation', async decision => {
  const f = await fixture();
  try {
    const { buildPlatformMcpToolDefinitions } = await import('./kernel/platform-tools.js');
    const internal = f.runtime as unknown as {
      prepareRunBinding(input: object): { run: import('./demo-run.js').DemoRunState };
      demoRuns: Map<string, import('./demo-run.js').DemoRunState>;
      platformMcpRuns: { setCatalog(runId: string, tools: unknown): void };
      requestPlatformToolApproval(...args: unknown[]): Promise<'approve' | 'deny'>;
      executePlatformMcpToolCall(...args: unknown[]): Promise<{ ok: boolean; content?: string }>;
    };
    const { run } = internal.prepareRunBinding({ runId: 'external-proposal', threadId: 'external-thread', userText: '我要一个分析项目的team，你帮我创建吧', globalAgentId: f.agent.id, track: 'agent', definitionProposalsAllowed: true });
    internal.demoRuns.set(run.runId, run);
    internal.platformMcpRuns.setCatalog(run.runId, buildPlatformMcpToolDefinitions({ includeTeamTools: true }));
    const approval = vi.spyOn(internal, 'requestPlatformToolApproval').mockResolvedValue(decision);
    const start = vi.spyOn(f.teams, 'startRun');
    const args = { name: 'MCP建队', coordinatorAgent: f.agent.id, members: [{ agent: f.agent.id }] };
    const result = await internal.executePlatformMcpToolCall(run.runId, run, '.', { id: 'external-create', tool: 'create_team', input: args, signal: new AbortController().signal }, JSON.stringify(args));
    expect(approval).toHaveBeenCalledTimes(1); expect(result.ok).toBe(decision === 'approve');
    expect(f.teams.list()).toHaveLength(decision === 'approve' ? 1 : 0); expect(start).not.toHaveBeenCalled();
  } finally { await f.close(); }
});


it('creates a team through the actual private native loop for the original noun-before-verb request', async () => {
  class PrivateTeamBuilder extends FakeProvider {
    round = 0;
    override async *call(request: Parameters<FakeProvider['call']>[0]) {
      expect(request.tools?.map(tool => tool.name)).toContain('create_team');
      const round = this.round++;
      if (round === 0) {
        yield { type: 'tool-call' as const, toolCall: { id: 'private-resources', name: 'list_agent_resources', argumentsJson: '{}' } };
      } else if (round === 1) {
        yield { type: 'tool-call' as const, toolCall: { id: 'private-create', name: 'create_team', argumentsJson: JSON.stringify({ name: '原句私聊建队验收', coordinatorAgent: 'agent-1', members: [{ agent: 'agent-1' }] }) } };
      } else {
        const content = request.messages?.filter(message => message.role === 'tool').at(-1)?.content;
        expect(typeof content === 'string' ? JSON.parse(content).ok : false).toBe(true);
        yield { type: 'text-delta' as const, text: '小队配置已保存。' };
        yield { type: 'finished' as const, reason: 'stop' as const }; return;
      }
      yield { type: 'finished' as const, reason: 'tool-requests' as const };
    }
  }
  const provider = new PrivateTeamBuilder(); const f = await fixture(provider);
  try {
    const internal = f.runtime as unknown as {
      prepareRunBinding(input: object): { run: import('./demo-run.js').DemoRunState };
      demoRuns: Map<string, import('./demo-run.js').DemoRunState>;
      requestChatToolApproval(input: unknown): Promise<unknown>;
      executeKernelRun(runId: string): Promise<void>;
    };
    const { run } = internal.prepareRunBinding({ runId: 'original-private-create', threadId: 'original-private-thread', userText: '那按刚才我们说的，我要一个分析项目的team，你帮我创建吧，如果有不懂的，或者有哪里有疑惑，我们要先讨论', globalAgentId: f.agent.id, track: 'agent', definitionProposalsAllowed: true });
    internal.demoRuns.set(run.runId, run);
    const approvals = vi.spyOn(internal, 'requestChatToolApproval').mockResolvedValue({ decision: 'approve', approvalId: 'private-explicit-confirmation' });
    const start = vi.spyOn(f.teams, 'startRun');
    await internal.executeKernelRun(run.runId);
    expect(provider.round).toBe(3); expect(approvals).toHaveBeenCalledTimes(1);
    expect(f.teams.list()).toHaveLength(1); expect(f.teams.list()[0].members[0].agentId).toBe(f.agent.id);
    expect(start).not.toHaveBeenCalled();
  } finally { await f.close(); }
});


it('archives an already-generated document at the output budget boundary without admitting new work', async () => {
  class BudgetBoundary extends FakeProvider {
    rounds = 0;
    override async *call(request: Parameters<FakeProvider['call']>[0]) {
      if (this.rounds++ === 0) {
        yield { type: 'usage' as const, tokensIn: 1, tokensOut: 64000, costEstimate: 0 };
        yield { type: 'tool-call' as const, toolCall: { id: 'finished-document', name: 'collaboration_submit_artifact', argumentsJson: JSON.stringify({ content: 'The completed document, already generated before the budget boundary.' }) } };
        yield { type: 'tool-call' as const, toolCall: { id: 'excess-finalization', name: 'collaboration_submit_artifact', argumentsJson: JSON.stringify({ content: 'Should not replace the archived document after the single reserve is used.' }) } };
        yield { type: 'tool-call' as const, toolCall: { id: 'new-read', name: 'collaboration_read_context', argumentsJson: JSON.stringify({ kind: 'members' }) } };
        yield { type: 'finished' as const, reason: 'tool-requests' as const }; return;
      }
      const results = request.messages.filter(m => m.role === 'tool').map(m => JSON.parse(String(m.content)));
      expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ ok: true, artifact: expect.objectContaining({ title: 'delivery' }) }), expect.objectContaining({ ok: false, code: 'EXECUTION_BUDGET_EXHAUSTED' })]));
      yield { type: 'text-delta' as const, text: 'Document archived; further operations stopped.' };
      yield { type: 'finished' as const, reason: 'stop' as const };
    }
  }
  const provider = new BudgetBoundary(); let f: Awaited<ReturnType<typeof collaborationToolFixture>>;
  f = await collaborationToolFixture({ provider, execute: request => f.runtime.executeCollaborationTaskForHost(request) });
  try {
    const created = f.host.command({ action: 'create', kind: 'group', clientRequestId: 'budget-room', title: 'budget', workspaceId: f.workspace.id, agentIds: [f.agent.id, f.peer.id], coordinatorAgentId: f.peer.id }).snapshot!;
    f.host.command({ action: 'room-brief', conversationId: created.conversation.id, clientRequestId: 'budget-goal', goal: 'one document', expectedGoalRevision: 0 });
    const dispatched = f.host.command({ action: 'dispatch', conversationId: created.conversation.id, clientRequestId: 'budget-job', tasks: [{ assigneeMemberId: 'agent:' + f.agent.id, title: 'delivery', instructions: 'deliver the document', deliverable: { kind: 'document', title: 'delivery' } }] }).snapshot!;
    let snapshot = dispatched;
    for (let i = 0; i < 150; i++) {
      snapshot = f.host.command({ action: 'get', conversationId: created.conversation.id }).snapshot!;
      if (snapshot.attempts.find(a => a.id === dispatched.tasks[0].currentAttemptId)?.status === 'succeeded') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const attempt = snapshot.attempts.find(a => a.id === dispatched.tasks[0].currentAttemptId)!;
    expect(attempt.status, JSON.stringify(attempt.error)).toBe('succeeded');
    expect(attempt.artifacts?.[0]?.content).toContain('already generated');
    expect(attempt.tools.find(t => t.id === 'excess-finalization' || t.name === 'collaboration_submit_artifact' && t.status === 'failed')?.status).toBe('failed');
    const blocked = attempt.tools.find(t => t.name === 'collaboration_read_context');
    expect(blocked?.status).toBe('failed');
    expect(provider.rounds).toBeGreaterThanOrEqual(2);
  } finally { await f.host.service.stop(); await f.close(); }
});
