import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFrames, type Frame } from '@sync-think/protocol';
import {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteMessageStore,
  SqliteCollaborationStore,
  SqliteEventCheckpointStore,
  SqliteGlobalAgentStore,
  SqliteTeamStore,
  SqliteWorkspaceStore,
} from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';

async function fixture(withHost = true) {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-collaboration-rpc-'));
  const connection = await (async () => {
    const path = join(directory, 'test.db');
    await runMigrations(path);
    return openDatabaseAsync({ path });
  })();
  const workspaceStore = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaceStore.createWorkspace({ id: 'rpc-workspace' as WorkspaceId, name: 'RPC' });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const teams = new SqliteTeamStore(connection.raw);
  const agent = agents.create({ id: 'rpc-agent' as AgentId, name: '研究员', defaultModelId: 'fixture-model' as ModelId });
  const conversationStore = new SqliteConversationStore(connection.raw);
  const messageStore = new SqliteMessageStore(connection.raw);
  const collaborationStore = new SqliteCollaborationStore(connection.raw);
  const runtime = new Runtime({
    installId: 'collaboration-rpc-fixture',
    projectlessDataDirectory: join(directory, 'projectless'),
    allowNoToken: true,
    stateStore: new SqliteEventCheckpointStore(connection.raw),
    workspaceStore,
    conversationStore,
    ...(withHost
      ? {
          collaborationChatHost: new (await import('./collaboration-chat-host.js')).CollaborationChatHost(
            collaborationStore,
            { ownerId: 'rpc', conversations: conversationStore, messages: messageStore, agents, teams, workspaces: workspaceStore,
              execute: async ({ task }) => ({ output: task.title }), onChanged: () => {} },
          ),
        }
      : {}),
  });
  const request = (payload: unknown): Promise<Frame> => new Promise((resolve) => {
    (runtime as unknown as { handlers: { onFrame(socket: { write(data: Buffer): boolean }, frame: Frame): void } }).handlers.onFrame(
      { write: (data) => { resolve(decodeFrames(data).frames[0]!); return true; } },
      { id: 'rpc-1', kind: 'request', type: 'collaboration.command', payload },
    );
  });
  const close = async () => { await runtime.stop(); connection.raw.close(); rmSync(directory, { recursive: true, force: true }); };
  return { workspace, agent, agents, teams, request, close, conversationStore, workspaceStore, messageStore, collaborationStore };
}

describe('collaboration command RPC boundary', () => {
  it('creates agent conversations without a user workspace and keeps their task anchor internal', async () => {
    const f = await fixture();
    try {
      const result = await f.request({ action: 'create', clientRequestId: 'projectless-create', kind: 'direct', title: '全局智能体对话', agentIds: [f.agent.id] });
      expect(result.error).toBeUndefined();
      const snapshot = (result.payload as { snapshot: { conversation: { id: string; workspaceId: string } } }).snapshot;
      const conversation = f.conversationStore.get(snapshot.conversation.id)!;
      expect(conversation.workspaceId).toBeUndefined();
      expect(f.workspaceStore.getWorkspace(snapshot.conversation.workspaceId as WorkspaceId)?.name).toBe('__inbox__');
      const repeated = await f.request({ action: 'create', clientRequestId: 'projectless-create', kind: 'direct', title: '全局智能体对话', agentIds: [f.agent.id] });
      expect((repeated.payload as typeof result.payload)).toMatchObject({ snapshot: { conversation: { id: conversation.id } } });
    } finally { await f.close(); }
  });
  it('returns an explicit error when collaboration is not configured', async () => {
    const f = await fixture(false);
    try {
      const response = await f.request({ action: 'get', conversationId: 'missing' });
      expect(response.error?.message).toBe('Collaboration chat is not configured');
    } finally { await f.close(); }
  });

  it('rejects malformed collaboration payloads at the pipe boundary', async () => {
    const f = await fixture();
    try {
      const response = await f.request({ action: 'dispatch', conversationId: 'missing', tasks: [] });
      expect(response.error?.message).toContain('Invalid payload');
    } finally { await f.close(); }
  });

  it('creates and reads a direct collaboration conversation through Runtime', async () => {
    const f = await fixture();
    try {
      const created = await f.request({ action: 'create', clientRequestId: 'create-1', kind: 'direct', title: '研究', workspaceId: f.workspace.id, agentIds: [f.agent.id] });
      expect(created.error).toBeUndefined();
      const conversationId = (created.payload as { snapshot: { conversation: { id: string } } }).snapshot.conversation.id;
      const read = await f.request({ action: 'get', conversationId });
      expect((read.payload as { snapshot: { conversation: { id: string } } }).snapshot.conversation.id).toBe(conversationId);
      const dispatched = await f.request({ action: 'dispatch', clientRequestId: 'dispatch-1', conversationId,
        tasks: [{ assigneeMemberId: `agent:${f.agent.id}`, title: '查询资料', instructions: '整理三条要点' }] });
      expect(dispatched.error).toBeUndefined();
      expect((dispatched.payload as { snapshot: { tasks: unknown[] } }).snapshot.tasks).toHaveLength(1);
    } finally { await f.close(); }
  });

  it('creates a direct conversation with the selected agent as coordinator', async () => {
    const f = await fixture();
    try {
      const created = await f.request({ action: 'create', clientRequestId: 'create-2', kind: 'group', title: '群组', workspaceId: f.workspace.id, agentIds: [f.agent.id, f.agent.id + '-other'] });
      // The fixture only provisions one effective agent, so exercise the
      // direct path directly and assert its stable coordinator identity.
      expect(created.error?.message).toContain('agent_unavailable');
      const direct = await f.request({ action: 'create', clientRequestId: 'create-3', kind: 'direct', title: '单聊', workspaceId: f.workspace.id, agentIds: [f.agent.id] });
      const snapshot = (direct.payload as { snapshot: { conversation: { coordinatorMemberId: string } } }).snapshot;
      expect(snapshot.conversation.coordinatorMemberId).toBe(`agent:${f.agent.id}`);
    } finally { await f.close(); }
  });
});

  it('promotes a user/agent direct chat atomically, preserving identity, transcript and permissions', async () => {
    const f = await fixture();
    try {
      const created = await f.request({ action: 'create', clientRequestId: 'promote-create', kind: 'direct', title: '保留历史', workspaceId: f.workspace.id, agentIds: [f.agent.id] });
      const snapshot = (created.payload as import('@sync-think/shared').CollaborationResponse).snapshot!;
      const id = snapshot.conversation.id;
      snapshot.messages.push({ id: 'original-user', conversationId: id, senderMemberId: 'user:local', recipientMemberIds: ['agent:' + f.agent.id], mentions: [], kind: 'chat', blocks: [{ type: 'text', text: '之前的问题' }], expectsResponse: false, correlationId: 'corr', hopCount: 0, sequence: 1, createdAt: snapshot.conversation.createdAt });
      snapshot.messages.push({ ...snapshot.messages[0]!, id: 'original-answer', senderMemberId: 'agent:' + f.agent.id, sequence: 2, blocks: [{ type: 'text', text: '之前的回答' }, { type: 'code', text: '<main>preserved</main>', payload: { language: 'html' } }] });
      snapshot.revision++;
      f.collaborationStore.save(snapshot);
      const before = f.conversationStore.get(id)!;
      const completePromotion = f.conversationStore.promoteDirect.bind(f.conversationStore);
      f.conversationStore.promoteDirect = () => { throw new Error('fixture_commit_failure'); };
      expect((await f.request({ action: 'promote-direct', conversationId: id })).error?.message).toContain('fixture_commit_failure');
      expect(f.messageStore.listMessages(f.workspaceStore.getTask(before.taskId!)!.threadId).messages).toHaveLength(0);
      expect(f.conversationStore.get(id)?.collaborationKind).toBe('direct');
      f.conversationStore.promoteDirect = completePromotion;
      const first = await f.request({ action: 'promote-direct', conversationId: id });
      expect(first.error).toBeUndefined();
      const record = (first.payload as import('@sync-think/shared').CollaborationResponse).promotedConversation!;
      expect(record).toMatchObject({ id, taskId: before.taskId, targetRef: before.targetRef, executionMode: before.executionMode });
      expect(record.collaborationKind).toBeUndefined();
      const thread = f.workspaceStore.getTask(record.taskId!)!.threadId;
      const messages = f.messageStore.listMessages(thread).messages;
      expect(messages.map(m => m.role)).toEqual(['user', 'assistant']);
      expect(messages[1]!.blocks).toEqual(snapshot.messages[1]!.blocks);
      expect((await f.request({ action: 'promote-direct', conversationId: id })).error).toBeUndefined();
      expect(f.messageStore.listMessages(thread).messages).toHaveLength(2);
      expect(f.collaborationStore.read(id)?.messages).toHaveLength(2);
      expect((await f.request({ action: 'send', conversationId: id, clientRequestId: 'stale', text: '旧页面重复发送' })).error?.message).toContain('conversation_promoted');
      expect((await f.request({ action: 'list' })).payload).toMatchObject({ conversations: [] });
    } finally { await f.close(); }
  });

  it('does not promote a group or a direct chat with an active attempt', async () => {
    const f = await fixture();
    try {
      const made = await f.request({ action: 'create', clientRequestId: 'busy-create', kind: 'direct', title: '执行中', workspaceId: f.workspace.id, agentIds: [f.agent.id] });
      const snapshot = (made.payload as import('@sync-think/shared').CollaborationResponse).snapshot!;
      snapshot.attempts.push({ id: 'busy', taskId: 'task', number: 1, status: 'running', updatedAt: snapshot.conversation.createdAt, contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] });
      snapshot.revision++; f.collaborationStore.save(snapshot);
      expect((await f.request({ action: 'promote-direct', conversationId: snapshot.conversation.id })).error?.message).toContain('direct_busy');
      expect(f.conversationStore.get(snapshot.conversation.id)?.collaborationKind).toBe('direct');
      const peer = f.agents.create({ id: 'rpc-peer' as AgentId, name: '同伴', defaultModelId: 'fixture-model' as ModelId });
      const group = await f.request({ action: 'create', clientRequestId: 'group-promote', kind: 'group', title: '群组', workspaceId: f.workspace.id, agentIds: [f.agent.id, peer.id] });
      const groupId = (group.payload as import('@sync-think/shared').CollaborationResponse).snapshot!.conversation.id;
      expect((await f.request({ action: 'promote-direct', conversationId: groupId })).error?.message).toContain('not_user_direct');
    } finally { await f.close(); }
  });

it('persists a team group target and derives its real roster and coordinator', async () => {
  const f = await fixture();
  try {
    const peer = f.agents.create({ name: '审校', defaultModelId: 'fixture-model' as ModelId });
    const team = f.teams.create({ name: '创作小队', coordinatorAgentId: peer.id, members: [{ agentId: f.agent.id, role: 'writer' }, { agentId: peer.id, role: 'reviewer' }] });
    const command = { action: 'create', kind: 'group', title: team.name, teamId: team.id, agentIds: [], clientRequestId: 'team-create', workspaceId: f.workspace.id };
    const result = await f.request(command);
    expect(result.kind).toBe('response');
    const snapshot = (result.payload as { snapshot: import('@sync-think/shared').CollaborationSnapshot }).snapshot;
    expect(snapshot.members.filter(m => m.kind === 'agent').map(m => m.agentId)).toEqual([f.agent.id, peer.id]);
    expect(snapshot.conversation.coordinatorMemberId).toBe('agent:' + peer.id);
    expect(f.conversationStore.get(snapshot.conversation.id)).toMatchObject({ track: 'team', targetRef: team.id, collaborationKind: 'group' });
    const repeated = await f.request(command);
    expect((repeated.payload as { snapshot: typeof snapshot }).snapshot.conversation.id).toBe(snapshot.conversation.id);
  } finally { await f.close(); }
});

it('lazily migrates a legacy team conversation into the group chat with its transcript', async () => {
  const f = await fixture();
  try {
    const peer = f.agents.create({ name: '审校', defaultModelId: 'fixture-model' as ModelId });
    const team = f.teams.create({ name: '旧版小队', coordinatorAgentId: f.agent.id, members: [{ agentId: f.agent.id }, { agentId: peer.id, title: '审校' }] });
    const legacy = f.conversationStore.create({ id: 'legacy-team-conversation' as import('@sync-think/shared').ConversationId, workspaceId: f.workspace.id, target: { track: 'team', teamId: team.id }, title: '旧版小队', executionMode: 'ask', interactionMode: 'execute' });
    const task = f.workspaceStore.createTask({ workspaceId: f.workspace.id, title: legacy.title, goal: legacy.title });
    f.conversationStore.bindTask(legacy.id, task.taskId);
    f.messageStore.append({ id: 'legacy-user-message' as import('@sync-think/shared').MessageId, threadId: task.threadId, role: 'user', sequence: 1, createdAt: '2026-09-27T12:00:00.000Z', blocks: [{ type: 'text', text: '你们好啊' }] });
    f.messageStore.append({ id: 'legacy-assistant-message' as import('@sync-think/shared').MessageId, threadId: task.threadId, role: 'assistant', sequence: 2, createdAt: '2026-09-27T12:00:01.000Z', blocks: [{ type: 'text', text: '旧版回复已保留' }] });
    const result = await f.request({ action: 'get', conversationId: legacy.id });
    const snapshot = (result.payload as { snapshot: import('@sync-think/shared').CollaborationSnapshot }).snapshot;
    expect(snapshot.conversation.kind).toBe('group');
    expect(snapshot.members.map(member => member.name)).toContain('审校');
    expect(snapshot.messages.map(message => message.blocks[0]?.text)).toEqual(['你们好啊', '旧版回复已保留']);
    expect(f.conversationStore.get(legacy.id)).toMatchObject({ track: 'team', collaborationKind: 'group' });
    const repeated = await f.request({ action: 'get', conversationId: legacy.id });
    expect((repeated.payload as { snapshot: typeof snapshot }).snapshot.messages).toHaveLength(2);
  } finally { await f.close(); }
});
