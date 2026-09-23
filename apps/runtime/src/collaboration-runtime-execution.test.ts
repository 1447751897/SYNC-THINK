import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '@sync-think/adapters';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteEventCheckpointStore,
  SqliteConversationStore,
  SqliteCollaborationStore,
  SqliteGlobalAgentStore,
  SqliteWorkspaceStore,
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

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-collaboration-runtime-'));
  const path = join(directory, 'test.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  workspaceStore.createWorkspace({ id: 'workspace-1' as WorkspaceId, name: '运行测试' });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const agent = agents.create({ id: 'agent-1' as AgentId, name: '执行者', defaultModelId: 'fake-mini' as ModelId });
  const runtime = new Runtime({ installId: 'collaboration-runtime', allowNoToken: true, workspaceStore, globalAgentStore: agents, stateStore: new SqliteEventCheckpointStore(connection.raw), demoProvider: new FakeProvider() });
  return { runtime, agent, close: async () => { await runtime.stop(); connection.raw.close(); rmSync(directory, { recursive: true, force: true }); } };
}

async function collaborationToolFixture(options: {
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
    demoProvider: new FakeProvider(),
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
