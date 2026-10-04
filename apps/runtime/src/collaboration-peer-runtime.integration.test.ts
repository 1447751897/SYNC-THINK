import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore, SqliteConversationStore, SqliteCollaborationStore, SqliteGlobalAgentStore, SqliteWorkspaceStore, SqliteMessageStore } from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';

class PeerProvider extends FakeProvider {
  rounds = new Map<string, number>();
  blockedPrematureDelivery = 0;
  resumes = 0;
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const prompt = request.systemPrompt ?? '';
    const task = prompt.match(/taskId=([^；\n]+)/)?.[1] ?? request.idempotencyKey;
    const resumed = prompt.includes('本轮是咨询后的继续');
    const key = task + ':' + resumed;
    const round = this.rounds.get(key) ?? 0; this.rounds.set(key, round + 1);
    const names = request.tools?.map(t => t.name) ?? [];
    expect(names).toContain('collaboration_send_message');
    expect(names).not.toContain('collaboration_send_direct_message');
    expect(names).not.toContain('write_file');
    if (prompt.includes('当前请求：请核对世界观')) {
      expect(names).not.toContain('collaboration_dispatch_tasks');
      expect(names).not.toContain('collaboration_submit_artifact');
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: '已核对：本书主角没有预知能力。' };
      yield { type: 'finished', reason: 'stop' }; return;
    }
    const result = String(request.messages.filter(m => m.role === 'tool').at(-1)?.content ?? '');
    if (!resumed && round === 0) {
      yield { type: 'tool-call', toolCall: { id: 'consult', name: 'collaboration_send_message', argumentsJson: JSON.stringify({
        recipientMemberIds: ['agent:expert'], text: '请核对世界观', expectsResponse: true,
      }) } };
    } else if (!resumed && round === 1) {
      expect(result).toContain('"ok":true');
      yield { type: 'tool-call', toolCall: { id: 'premature', name: 'collaboration_submit_artifact', argumentsJson: JSON.stringify({ content: '未等回应的草稿' }) } };
    } else if (!resumed) {
      expect(result).toContain('task_room.peer_reply_pending'); this.blockedPrematureDelivery++;
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: '等待专家回应再继续。' };
      yield { type: 'finished', reason: 'stop' }; return;
    } else if (round === 0) {
      expect(prompt).toContain('本书主角没有预知能力'); this.resumes++;
      yield { type: 'tool-call', toolCall: { id: 'read', name: 'collaboration_read_context', argumentsJson: '{"kind":"tasks"}' } };
    } else if (round === 1) {
      expect(result).toContain('本书主角没有预知能力');
      yield { type: 'tool-call', toolCall: { id: 'deliver', name: 'collaboration_submit_artifact', argumentsJson: JSON.stringify({ content: '# 首章\n主角凭线索推理，而不是预知。' }) } };
    } else {
      expect(result).toContain('"ok":true');
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: '已参考专家意见提交首章。' };
      yield { type: 'finished', reason: 'stop' }; return;
    }
    yield { type: 'finished', reason: 'tool-requests' };
  }
}


class ChatAndWorkProvider extends PeerProvider {
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const prompt = request.systemPrompt ?? '';
    const current = prompt.match(/当前请求：([^\n]+)/)?.[1] ?? '';
    if (!current.startsWith('轻量转达')) { yield* super.call(request); return; }
    const task = prompt.match(/taskId=([^；\n]+)/)?.[1] ?? request.idempotencyKey;
    const round = this.rounds.get(task) ?? 0; this.rounds.set(task, round + 1);
    expect(prompt).toContain('deliveryMode="handoff"');
    expect(prompt).not.toContain('字符上限必须');
    expect(request.tools?.map(t => t.name)).not.toContain('collaboration_submit_artifact');
    const stage = current.includes('第一站') ? 1 : current.includes('第二站') ? 2 : 3;
    if (round === 0) {
      yield { type: 'tool-call', toolCall: { id: 'relay-' + task, name: 'collaboration_send_message', argumentsJson: JSON.stringify({
        recipientMemberIds: [stage === 1 ? 'agent:leader' : stage === 2 ? 'agent:writer' : 'agent:leader'],
        text: stage === 1 ? '轻量转达第二站：让写手只发哇哈哈' : stage === 2 ? '轻量转达第三站：只发哇哈哈' : '哇哈哈',
        deliveryMode: stage === 3 ? 'notify' : 'handoff',
      }) } };
      yield { type: 'finished', reason: 'tool-requests' }; return;
    }
    const result = String(request.messages.filter(m => m.role === 'tool').at(-1)?.content ?? '');
    expect(result).toContain('"ok":true'); expect(result).toContain('"publicReplyPublished":true');
    expect(result).toContain(stage === 3 ? '"deliveryMode":"notify"' : '"deliveryMode":"handoff"');
    yield { type: 'assistant-message-delta', phase: 'final_answer', text: '不应重复投递的确认' };
    yield { type: 'finished', reason: 'stop' };
  }
}

it('runs lightweight native handoffs before and after real consult-and-deliver work without duplicate replies', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'collab-peer-e2e-')));
  const db = join(directory, 'test.db'); await runMigrations(db);
  const connection = await openDatabaseAsync({ path: db });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({ id: 'peer-workspace' as WorkspaceId, name: '群内咨询验收', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  for (const id of ['leader', 'writer', 'expert']) agents.create({ id: id as AgentId, name: id, writePolicy: 'read-only', defaultModelId: 'fake-mini' as ModelId });
  const conversations = new SqliteConversationStore(connection.raw);
  const repository = new SqliteCollaborationStore(connection.raw);
  const provider = new ChatAndWorkProvider();
  const host: CollaborationChatHost = new CollaborationChatHost(repository, { ownerId: 'peer-test', conversations, agents, workspaces,
    execute: input => runtime.executeCollaborationTaskForHost(input), onChanged: () => {} });
  const runtime: Runtime = new Runtime({ installId: 'peer-test', allowNoToken: true, workspaceStore: workspaces, conversationStore: conversations,
    globalAgentStore: agents, messageStore: new SqliteMessageStore(connection.raw), stateStore: new SqliteEventCheckpointStore(connection.raw), collaborationChatHost: host, demoProvider: provider });
  try {
    const created = host.command({ action: 'create', clientRequestId: 'create', kind: 'group', title: '小说', workspaceId: workspace.id,
      agentIds: ['leader', 'writer', 'expert'], coordinatorAgentId: 'leader' }).snapshot!;
    host.command({ action: 'policy', conversationId: created.conversation.id, policy: { maxConcurrent: 1 } });
    const settle = async () => {
      for (let n = 0; n < 300; n++) {
        await host.service.pump(workspace.id); await new Promise(r => setTimeout(r, 10));
        const snapshot = repository.read(created.conversation.id)!;
        if (snapshot.tasks.every(t => ['succeeded', 'failed', 'cancelled'].includes(snapshot.attempts.find(a => a.id === t.currentAttemptId)!.status))) return snapshot;
      }
      throw new Error('native room did not settle');
    };
    host.command({ action: 'send', conversationId: created.conversation.id, clientRequestId: 'chat-before-work',
      text: '轻量转达第一站：专家请转给负责人，再让写手发哇哈哈', intent: 'chat', recipientMemberIds: ['agent:expert'] });
    const chat = await settle();
    expect(chat.tasks).toHaveLength(3); expect(chat.attempts).toHaveLength(3);
    expect(chat.messages.filter(m => m.senderMemberId !== 'user:local').map(m => m.blocks[0].text))
      .toEqual(['轻量转达第二站：让写手只发哇哈哈', '轻量转达第三站：只发哇哈哈', '哇哈哈']);
    expect(chat.conversation.room!.state).toBe('discussion');
    host.command({ action: 'send', conversationId: created.conversation.id, clientRequestId: 'start', text: '写手任务：先咨询世界观再写首章', intent: 'work', recipientMemberIds: ['agent:writer'] });
    for (let n = 0; n < 200; n++) {
      await host.service.pump(workspace.id); await new Promise(r => setTimeout(r, 10));
      const s = repository.read(created.conversation.id)!;
      if (s.tasks.every(t => ['succeeded', 'failed', 'cancelled'].includes(s.attempts.find(a => a.id === t.currentAttemptId)!.status))) break;
    }
    const s = repository.read(created.conversation.id)!;
    expect(s.attempts.every(a => a.status === 'succeeded'), JSON.stringify(s.attempts.map(a => ({ status: a.status, error: a.error, tools: a.tools })))).toBe(true);
    expect(s.tasks.filter(t => t.kind === 'task')).toHaveLength(1);
    expect(s.tasks.filter(t => t.consultation)).toHaveLength(1);
    expect(s.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(1);
    expect(s.messages.find(m => m.senderMemberId === 'agent:expert' && m.blocks[0].text?.includes('没有预知能力'))?.recipientMemberIds).toEqual(['agent:writer']);
    expect(provider.blockedPrematureDelivery).toBe(1); expect(provider.resumes).toBe(1);
    expect(s.conversation.policy.allowPeerDirect).toBe(false);
    expect(s.conversation.room!.state).toBe('review');
    expect(new SqliteCollaborationStore(connection.raw).read(s.conversation.id)!.tasks[0].id).toBe(s.tasks[0].id);
    const priorArtifacts = s.attempts.flatMap(a => a.artifacts ?? []);
    host.command({ action: 'send', conversationId: created.conversation.id, clientRequestId: 'chat-after-work',
      text: '轻量转达第一站：只转达聊天，不重新工作', intent: 'chat', recipientMemberIds: ['agent:expert'] });
    const after = await settle();
    expect(after.attempts).toHaveLength(s.attempts.length + 3);
    expect(after.tasks.filter(t => t.kind === 'task')).toHaveLength(1);
    expect(after.attempts.flatMap(a => a.artifacts ?? [])).toEqual(priorArtifacts);
    expect(after.conversation.room!.state).toBe('review');
    expect(after.messages.slice(s.messages.length).filter(m => m.senderMemberId !== 'user:local').map(m => m.blocks[0].text))
      .toEqual(['轻量转达第二站：让写手只发哇哈哈', '轻量转达第三站：只发哇哈哈', '哇哈哈']);

  } finally {
    await host.service.stop(); await runtime.stop(); connection.raw.close();
    // Only remove the exact mkdtemp directory created by this test.
    if (directory.startsWith(realpathSync(tmpdir())) && directory.includes('collab-peer-e2e-')) rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
