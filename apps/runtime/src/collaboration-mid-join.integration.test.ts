import { mkdtempSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { expect, it } from 'vitest';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore, SqliteConversationStore, SqliteCollaborationStore, SqliteGlobalAgentStore, SqliteWorkspaceStore, SqliteMessageStore } from '@sync-think/storage';
import type { AgentId, ModelId, CollaborationSnapshot } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';

class MidJoinProvider extends FakeProvider {
  private releaseGate!: () => void;
  private gate = new Promise<void>(resolve => { this.releaseGate = resolve; });
  admitted = false;
  foreignArtifact = '';
  release() { this.releaseGate(); }
  rounds = new Map<string, number>();
  observed: string[] = [];
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    if (request.systemPrompt?.includes('You are the routing controller of this group')) {
      expect(request.tools ?? []).toEqual([]);
      const coordinator = request.systemPrompt.match(/"coordinatorMemberId":"([^"]+)"/)?.[1];
      expect(coordinator).toBeTruthy();
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: JSON.stringify({ mode: 'single', memberIds: [coordinator] }) };
      yield { type: 'finished', reason: 'stop' }; return;
    }

    const prompt = request.systemPrompt ?? '';
    const task = prompt.match(/taskId=([^；\n]+)/)?.[1] ?? request.idempotencyKey;
    const current = prompt.match(/当前请求：([^\n]+)/)?.[1] ?? '';
    const round = this.rounds.get(task) ?? 0;
    this.rounds.set(task, round + 1);
    const raw = String(request.messages.filter(m => m.role === 'tool').at(-1)?.content ?? '');
    let tool: { name: string; args: object } | undefined;
    if (current === 'JOIN-A：交给后来加入的写手，只交付一份正文') {
      if (!round) { this.admitted = true; await this.gate; tool = { name: 'collaboration_read_context', args: { kind: 'members' } }; }
      else if (round === 1) {
        const roster = JSON.parse(raw);
        expect(roster.ok).toBe(true);
        expect(roster.data.topologyRevision).toBe(1);
        expect(roster.data.members.some((m: { id: string; active: boolean }) => m.id === 'agent:writer' && m.active)).toBe(true);
        this.observed.push('live-roster');
        tool = { name: 'collaboration_dispatch_tasks', args: { tasks: [{ assigneeMemberId: 'agent:writer', title: '正文', instructions: 'JOIN-A-WRITE：读取入群前约定，保存正文', deliverable: { kind: 'document', title: '雾港正文' } }] } };
      } else { expect(raw).toContain('"ok":true'); this.observed.push('dispatch'); }
    } else if (current.startsWith('JOIN-A-WRITE')) {
      expect(prompt).toContain('JOIN-A-ONLY：顾澄、旧灯塔、铜钥匙');
      expect(prompt).not.toContain('JOIN-B-SECRET');
      if (!round) tool = { name: 'collaboration_submit_artifact', args: { content: '顾澄用铜钥匙打开旧灯塔。灯亮了。' } };
      else { expect(raw).toContain('"ok":true'); this.observed.push('new-writer-delivered'); }
    } else if (current === 'JOIN-A-READ：核对入群前历史及已交付文档，仅讨论') {
      expect(request.tools?.map(t => t.name)).not.toContain('collaboration_dispatch_tasks');
      expect(request.tools?.map(t => t.name)).not.toContain('collaboration_submit_artifact');
      expect(prompt).not.toContain('JOIN-B-SECRET');
      if (!round) tool = { name: 'collaboration_read_context', args: { kind: 'messages' } };
      else if (round === 1) { expect(raw).toContain('JOIN-A-ONLY'); tool = { name: 'collaboration_read_context', args: { kind: 'tasks' } }; }
      else if (round === 2) {
        const artifact = JSON.parse(raw).data.tasks.flatMap((t: { attempt?: { artifacts?: { id: string }[] } }) => t.attempt?.artifacts ?? [])[0];
        expect(artifact).toBeTruthy();
        tool = { name: 'collaboration_read_context', args: { kind: 'artifact', id: artifact.id } };
      } else { expect(raw).toContain('顾澄用铜钥匙打开旧灯塔。灯亮了。'); this.observed.push('late-reader-read-history-and-artifact'); }
    } else if (current === 'JOIN-B-WRITE：保存另一群的独立文档') {
      if (!round) tool = { name: 'collaboration_submit_artifact', args: { content: 'JOIN-B-SECRET：另一部小说的真实产物' } };
      else expect(raw).toContain('"ok":true');
    } else if (current === 'JOIN-A-FORBIDDEN：读取另一群的产物') {
      if (!round) tool = { name: 'collaboration_read_context', args: { kind: 'artifact', id: this.foreignArtifact } };
      else { expect(raw).toContain('artifact_not_in_room'); this.observed.push('cross-room-denied'); }
    } else if (current === 'JOIN-SOLO：只有自己时也要完成交付') {
      expect(request.tools?.map(t => t.name)).toContain('collaboration_dispatch_tasks');
      if (!round) tool = { name: 'collaboration_dispatch_tasks', args: { tasks: [{ assigneeMemberId: 'agent:leader', title: '独立正文', instructions: 'JOIN-SOLO-WRITE：仅写正文并保存', deliverable: { kind: 'document', title: '雾港正文' } }] } };
      else { expect(raw).toContain('"ok":true'); this.observed.push('solo-bounded-dispatch'); }
    } else if (current.startsWith('JOIN-SOLO-WRITE')) {
      expect(request.tools?.map(t => t.name)).not.toContain('collaboration_dispatch_tasks');
      if (!round) tool = { name: 'collaboration_submit_artifact', args: { content: '独立正文。' } };
      else { expect(raw).toContain('"ok":true'); this.observed.push('solo-delivered'); }
    } else if (current.startsWith('先读取本群工作索引')) {
      if (!round) tool = { name: 'collaboration_read_context', args: { kind: 'tasks' } };
      else { expect(raw).toContain('雾港正文'); this.observed.push('coordinator-reviewed'); }
    } else {
      expect(current).toContain('JOIN-');
    }
    if (tool) {
      yield { type: 'tool-call', toolCall: { id: task + '-' + round, name: tool.name, argumentsJson: JSON.stringify(tool.args) } };
      yield { type: 'finished', reason: 'tool-requests' };
    } else {
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: '已核对本群输入，原工作未重复执行。' };
      yield { type: 'finished', reason: 'stop' };
    }
  }
}

it('admits an agent during an active native run without restarting it, then gives later members same-room history and deliverables', async () => {
  const base = realpathSync(tmpdir());
  const directory = realpathSync(mkdtempSync(join(base, 'collab-mid-join-')));
  const path = join(directory, 'test.db'); await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({ name: '中途入群测试', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  for (const id of ['leader', 'writer', 'reader']) agents.create({ id: id as AgentId, name: id, writePolicy: 'read-only', defaultModelId: 'fake-mini' as ModelId });
  const conversations = new SqliteConversationStore(connection.raw);
  const repository = new SqliteCollaborationStore(connection.raw);
  const provider = new MidJoinProvider();
  const host: CollaborationChatHost = new CollaborationChatHost(repository, { ownerId: 'mid-join-test', conversations, agents, workspaces,
    execute: input => runtime.executeCollaborationTaskForHost(input), onChanged: () => {} });
  const runtime = new Runtime({ installId: 'mid-join-test', allowNoToken: true, workspaceStore: workspaces, conversationStore: conversations,
    globalAgentStore: agents, messageStore: new SqliteMessageStore(connection.raw), stateStore: new SqliteEventCheckpointStore(connection.raw), collaborationChatHost: host, demoProvider: provider });
  const get = (id: string) => host.command({ action: 'get', conversationId: id }).snapshot!;
  const settle = async (id: string) => {
    await expect.poll(() => get(id).attempts.every(a => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(a.status)), { timeout: 10000 }).toBe(true);
    const s = get(id); expect(s.attempts.every(a => a.status === 'succeeded'), JSON.stringify(s.attempts)).toBe(true); return s;
  };
  const create = (name: string) => host.command({ action: 'create', clientRequestId: name, kind: 'group', title: name, workspaceId: workspace.id, agentIds: ['leader'], coordinatorAgentId: 'leader' }).snapshot!;
  try {
    const a = create('JOIN-A'); const b = create('JOIN-B');
    host.command({ action: 'send', conversationId: a.conversation.id, clientRequestId: 'history-a', intent: 'discussion', text: 'JOIN-A-ONLY：顾澄、旧灯塔、铜钥匙' });
    await settle(a.conversation.id);
    host.command({ action: 'send', conversationId: b.conversation.id, clientRequestId: 'history-b', intent: 'discussion', text: 'JOIN-B-SECRET：另一部小说' });
    await settle(b.conversation.id);
    host.command({ action: 'send', conversationId: b.conversation.id, clientRequestId: 'b-artifact', intent: 'work', recipientMemberIds: ['agent:leader'], text: 'JOIN-B-WRITE：保存另一群的独立文档' });
    const otherBefore = await settle(b.conversation.id);
    provider.foreignArtifact = otherBefore.attempts.flatMap(a => a.artifacts ?? [])[0].id;
    expect(provider.foreignArtifact).toBeTruthy();
    host.command({ action: 'start-workflow', conversationId: a.conversation.id, clientRequestId: 'begin', goal: 'JOIN-A：交给后来加入的写手，只交付一份正文' });
    await expect.poll(() => provider.admitted).toBe(true);
    const active = get(a.conversation.id);
    const attempt = active.attempts.find(item => item.status === 'running')!;
    expect(attempt).toBeTruthy();
    const admitted = host.command({ action: 'members', conversationId: a.conversation.id, expectedTopologyRevision: 0, addAgentIds: ['writer'] }).snapshot!;
    expect(admitted.tasks).toEqual(active.tasks);
    expect(admitted.attempts).toEqual(active.attempts);
    expect(admitted.conversation.room?.state).toBe('running');
    expect(() => host.command({ action: 'dispatch', conversationId: a.conversation.id, clientRequestId: 'self-loop', parentTaskId: attempt.taskId, tasks: [{ assigneeMemberId: 'agent:leader', title: '错误的自行循环', instructions: '交给自己再次调度' }] }, 'agent:leader')).toThrow('no_self_dispatch');
    expect(() => host.command({ action: 'members', conversationId: a.conversation.id, removeMemberIds: ['agent:leader'] })).toThrow('member_busy');
    expect(() => host.command({ action: 'members', conversationId: a.conversation.id, coordinatorMemberId: 'agent:writer' })).toThrow('coordinator_busy');
    expect(() => host.command({ action: 'members', conversationId: a.conversation.id, expectedTopologyRevision: 0, addAgentIds: ['reader'] })).toThrow('topology_conflict');
    provider.release();
    const done = await settle(a.conversation.id);
    expect(provider.observed).toEqual(['live-roster', 'dispatch', 'new-writer-delivered', 'coordinator-reviewed']);
    expect(done.attempts.filter(item => item.taskId === attempt.taskId)).toHaveLength(1);
    const artifacts = (s: CollaborationSnapshot) => s.attempts.flatMap(item => item.artifacts ?? []);
    expect(artifacts(done)).toHaveLength(1);
    expect(readFileSync(artifacts(done)[0].storedPath!, 'utf8')).toBe('顾澄用铜钥匙打开旧灯塔。灯亮了。');
    const reader = host.command({ action: 'members', conversationId: a.conversation.id, expectedTopologyRevision: 1, addAgentIds: ['reader'] }).snapshot!;
    expect(reader.tasks).toEqual(done.tasks); expect(reader.attempts).toEqual(done.attempts);
    host.command({ action: 'send', conversationId: a.conversation.id, clientRequestId: 'late-question', text: 'JOIN-A-READ：核对入群前历史及已交付文档，仅讨论', intent: 'discussion', recipientMemberIds: ['agent:reader'] });
    const reviewed = await settle(a.conversation.id);
    expect(provider.observed).toContain('late-reader-read-history-and-artifact');
    expect(artifacts(reviewed)).toEqual(artifacts(done));
    expect(reviewed.tasks.filter(t => t.purpose === 'work')).toHaveLength(1);
    host.command({ action: 'send', conversationId: a.conversation.id, clientRequestId: 'wrong-artifact', text: 'JOIN-A-FORBIDDEN：读取另一群的产物', intent: 'discussion', recipientMemberIds: ['agent:reader'] });
    await settle(a.conversation.id); expect(provider.observed).toContain('cross-room-denied');
    expect(get(b.conversation.id)).toEqual(otherBefore);
    const solo = create('JOIN-SOLO');
    host.command({ action: 'start-workflow', conversationId: solo.conversation.id, clientRequestId: 'solo-begin', goal: 'JOIN-SOLO：只有自己时也要完成交付' });
    const soloDone = await settle(solo.conversation.id);
    expect(soloDone.tasks.map(t => t.purpose)).toEqual(['coordination', 'work', 'coordination']);
    expect(soloDone.tasks.every(t => t.assigneeMemberId === 'agent:leader')).toBe(true);
    expect(artifacts(soloDone)).toHaveLength(1); expect(soloDone.conversation.room?.state).toBe('review');
    expect(provider.observed).toContain('solo-bounded-dispatch'); expect(provider.observed).toContain('solo-delivered');
  } finally {
    provider.release(); await host.service.stop(); await runtime.stop(); connection.raw.close();
    const resolved = realpathSync(directory); const within = relative(base, resolved);
    if (within && !within.startsWith('..') && !isAbsolute(within) && within.startsWith('collab-mid-join-')) rmSync(resolved, { recursive: true, force: true });
  }
}, 20000);
