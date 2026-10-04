import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FakeProvider, type ProviderCallRequest, type AdapterEvent } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore, SqliteConversationStore, SqliteCollaborationStore, SqliteGlobalAgentStore, SqliteWorkspaceStore, SqliteTeamStore, SqliteMessageStore, SqliteMemoryStore } from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';

class WorkflowProvider extends FakeProvider {
  rounds = new Map<string, number>();
  stagePrompts: string[] = [];
  deniedTools: string[] = [];
  discussionPrompts: string[] = [];
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
    const purpose = prompt.match(/；purpose=(\w+)/)?.[1];
    const round = this.rounds.get(task) ?? 0; this.rounds.set(task, round + 1);
    const user = String(request.messages.filter(m => m.role === 'user').at(-1)?.content ?? '');
    const names = request.tools?.map(t => t.name) ?? [];
    expect(names).toContain('collaboration_read_context');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('agent_run');
    expect(names).not.toContain('collaboration_start_workflow');
    if (purpose === 'discussion') {
      this.discussionPrompts.push(prompt + JSON.stringify(request.messages));
      expect(names).not.toContain('collaboration_dispatch_tasks');
      if (user.includes('越权') && round === 0) {
        yield { type: 'tool-call', toolCall: { id: 'forbidden', name: 'collaboration_dispatch_tasks', argumentsJson: JSON.stringify({ tasks: [{ assigneeMemberId: 'agent:novel-3', title: '非法', instructions: '非法' }] }) } };
        yield { type: 'finished', reason: 'tool-requests' }; return;
      }
      if (round > 0 && user.includes('越权')) {
        const result = String(request.messages.filter(m => m.role === 'tool').at(-1)?.content);
        this.deniedTools.push(result); expect(result).toContain('task_room.tool_not_allowed');
      }
    }
    if (purpose === 'coordination' && !user.includes('先读取本群工作索引') && round < 2) {
      expect(prompt).toContain('书名是《回声十秒》');
      expect(names).toContain('collaboration_dispatch_tasks');
      yield { type: 'tool-call', toolCall: { id: 'dispatch-' + round, name: 'collaboration_dispatch_tasks', argumentsJson: JSON.stringify({ tasks: [{ assigneeMemberId: 'agent:novel-3', title: '首章', instructions: '继续《回声十秒》，写首章', deliverable: { kind: 'document', title: '首章稿' } }] }) } };
      yield { type: 'finished', reason: 'tool-requests' }; return;
    }
    if (purpose === 'coordination' && user.includes('先读取本群工作索引') && round === 0) {
      yield { type: 'tool-call', toolCall: { id: 'read-tasks', name: 'collaboration_read_context', argumentsJson: JSON.stringify({ kind: 'tasks' }) } };
      yield { type: 'finished', reason: 'tool-requests' }; return;
    }
    if (purpose === 'coordination' && user.includes('先读取本群工作索引') && round === 1) {
      const result = JSON.parse(String(request.messages.filter(m => m.role === 'tool').at(-1)?.content));
      expect(result.ok).toBe(true);
      const artifact = result.data.tasks.flatMap((t: { attempt?: { artifacts?: { id: string }[] } }) => t.attempt?.artifacts ?? [])[0];
      yield { type: 'tool-call', toolCall: { id: 'read-artifact', name: 'collaboration_read_context', argumentsJson: JSON.stringify({ kind: 'artifact', id: artifact.id }) } };
      yield { type: 'finished', reason: 'tool-requests' }; return;
    }
    if (purpose === 'work' && round === 0) {
      this.stagePrompts.push(prompt);
      expect(names).toContain('collaboration_submit_artifact');
      expect(names).not.toContain('collaboration_dispatch_tasks');
      yield { type: 'tool-call', toolCall: { id: 'artifact', name: 'collaboration_submit_artifact', argumentsJson: JSON.stringify({ content: '# 回声十秒\n首章的完整产物\n陈默听到了十秒后的回声。' }) } };
      yield { type: 'finished', reason: 'tool-requests' }; return;
    }
    if (purpose === 'work' || purpose === 'coordination' && round > 0) expect(String(request.messages.filter(m => m.role === 'tool').at(-1)?.content)).toContain('"ok":true');
    yield { type: 'assistant-message-delta', phase: 'final_answer', text: purpose === 'coordination' ? '首章已交付，等待用户验收。' : '已收到。' };
    yield { type: 'finished', reason: 'stop' };
  }
}

it('runs leader-first task-room work, bounded context reads and a member deliverable through the real native runtime', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'collab-workflow-e2e-'));
  const path = join(directory, 'test.db'); await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({ id: 'workflow-workspace' as WorkspaceId, name: '小说测试', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  const roles = ['主策划', '世界观架构师', '大纲师', '正文写手', '编辑审校'];
  const members = roles.map((name, index) => agents.create({ id: `novel-${index}` as AgentId, name, writePolicy: 'read-only', defaultModelId: 'fake-mini' as ModelId }));
  const teams = new SqliteTeamStore(connection.raw);
  const team = teams.create({ name: '小说创作小队', mission: '简报→世界观→大纲→正文→审校修订', strategy: 'serial', coordinatorAgentId: members[0].id,
    members: members.map((agent, index) => ({ agentId: agent.id, role: roles[index], title: roles[index], dependsOn: index ? [members[index - 1].id] : [] })) });
  const conversations = new SqliteConversationStore(connection.raw);
  const repository = new SqliteCollaborationStore(connection.raw);
  const provider = new WorkflowProvider();
  const memoryStore = new SqliteMemoryStore(connection.raw);
  const memoryReads = vi.spyOn(memoryStore, 'listActiveEntries');
  const memoryProposals = vi.spyOn(memoryStore, 'proposeChange');
  const host: CollaborationChatHost = new CollaborationChatHost(repository, { ownerId: 'e2e-runtime', onError: error => console.error('COLLABORATION_FINISH_ERROR', error), conversations, agents, teams, workspaces,
    execute: input => runtime.executeCollaborationTaskForHost(input), onChanged: () => {} });
  const runtime: Runtime = new Runtime({ memoryStore, installId: 'workflow-test', allowNoToken: true, workspaceStore: workspaces, conversationStore: conversations,
    globalAgentStore: agents, teamStore: teams, messageStore: new SqliteMessageStore(connection.raw), stateStore: new SqliteEventCheckpointStore(connection.raw), collaborationChatHost: host, demoProvider: provider });
  try {
    const created = host.command({ action: 'create', clientRequestId: 'create', kind: 'group', title: '小说创作小队', workspaceId: workspace.id, agentIds: [], teamId: team.id }).snapshot!;
    const id = created.conversation.id;
    host.command({ action: 'send', conversationId: id, clientRequestId: 'greeting', text: '你好，书名是《回声十秒》，先讨论。' });
    const settle = async (roomId = id) => {
      for (let n = 0; n < 200; n++) {
        await host.service.pump(workspace.id); await new Promise(r => setTimeout(r, 10));
        const snapshot = repository.read(roomId)!;
        if (snapshot.tasks.length && snapshot.tasks.every(t => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(snapshot.attempts.find(a => a.id === t.currentAttemptId)!.status))) return snapshot;
      }
      throw new Error('workflow did not settle: ' + JSON.stringify(repository.read(id)?.attempts.map(a => ({ status: a.status, output: a.output, error: a.error, waitReason: a.waitReason }))));
    };
    const greeting = await settle();
    expect(greeting.tasks.every(t => t.kind === 'reply')).toBe(true);
    host.command({ action: 'start-workflow', conversationId: id, clientRequestId: 'start', goal: '书名是《回声十秒》，交给对应的人写首章。' });
    const finished = await settle();
    const stages = finished.tasks.filter(t => t.kind === 'task');
    expect(stages).toHaveLength(3); // leader + ONE selected writer + event-driven leader follow-up
    expect(stages.map(t => t.purpose)).toEqual(['coordination', 'work', 'coordination']);
    expect(stages[1].assigneeMemberId).toBe('agent:novel-3');
    expect(stages.every(t => finished.attempts.find(a => a.id === t.currentAttemptId)?.status === 'succeeded'), JSON.stringify(finished.attempts.map(a => ({ status: a.status, error: a.error, output: a.output })))).toBe(true);
    expect(finished.conversation.room?.state).toBe('review');
    expect(provider.stagePrompts).toHaveLength(1);
    expect(conversations.get(id)?.executionMode).toBe('ask');
    expect(members.every(m => agents.get(m.id)?.writePolicy === 'read-only')).toBe(true);
    const persisted = new SqliteCollaborationStore(connection.raw).read(id)!;
    expect(persisted.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(1);
    const delivered = persisted.attempts.flatMap(a => a.artifacts ?? [])[0];
    expect(delivered.storedPath).toMatch(/\.md$/);
    expect(readFileSync(delivered.storedPath!, 'utf8')).toBe(delivered.content);
    expect(delivered.textMetrics?.charactersWithoutWhitespace).toBe(Array.from(delivered.content!.replace(/\s/gu, '')).length);
    expect(persisted.conversation.room!.checkpoint.artifactIds).toHaveLength(1);
    host.command({ action: 'send', conversationId: id, clientRequestId: 'deny', text: '越权测试：只讨论，但尝试调用派工工具。' });
    const denied = await settle();
    expect(denied.tasks.filter(t => t.kind === 'task')).toHaveLength(3);
    expect(provider.deniedTools).toHaveLength(1);
    host.command({ action: 'send', conversationId: id, clientRequestId: 'writer-only', text: '润色上一章。', intent: 'work', recipientMemberIds: ['agent:novel-3'] });
    const solo = await settle();
    const newWork = solo.tasks.filter(t => t.kind === 'task' && !stages.some(old => old.id === t.id));
    expect(newWork).toHaveLength(1);
    expect(newWork[0].purpose).toBe('work');
    expect(solo.attempts.find(a => a.id === newWork[0].currentAttemptId)?.status).toBe('succeeded');
    expect(provider.stagePrompts[1]).toContain('artifact_index');
    const before = solo.tasks.length;
    host.command({ action: 'members', conversationId: id, addAgentIds: [agents.create({ id: 'guest' as AgentId, name: '顾问', defaultModelId: 'fake-mini' as ModelId }).id] });
    expect(repository.read(id)!.tasks).toHaveLength(before); // Joining does not execute.
    const second = host.command({ action: 'create', clientRequestId: 'another-book', kind: 'group', title: '另一部小说', workspaceId: workspace.id, agentIds: [], teamId: team.id }).snapshot!;
    expect(second.conversation.id).not.toBe(id);
    expect(second.conversation.room!.state).toBe('discussion');
    expect(second.messages).toHaveLength(0);
    expect(second.members.some(m => m.agentId === 'guest')).toBe(false);
    expect(second.tasks).toHaveLength(0);
    host.command({ action: 'send', conversationId: second.conversation.id, clientRequestId: 'second-question', text: '仅讨论第二本小说《星港》，不开始工作。' });
    const secondReply = await settle(second.conversation.id);
    expect(secondReply.tasks.every(t => t.purpose === 'discussion')).toBe(true);
    expect(provider.discussionPrompts.at(-1)).toContain('星港');
    expect(provider.discussionPrompts.at(-1)).not.toContain('回声十秒');
    expect(memoryReads).not.toHaveBeenCalled();
    expect(memoryProposals).not.toHaveBeenCalled();
  } finally { await host.service.stop(); await runtime.stop(); connection.raw.close(); rmSync(directory, { recursive: true, force: true }); }
}, 20000);
