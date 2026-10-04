import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore, SqliteConversationStore, SqliteCollaborationStore, SqliteGlobalAgentStore, SqliteWorkspaceStore, SqliteMessageStore } from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';


class ChatWorkflowProvider extends FakeProvider {
  rounds = new Map<string, number>();
  checks: string[] = [];
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
    const round = this.rounds.get(task) ?? 0; this.rounds.set(task, round + 1);
    const names = request.tools?.map(t => t.name) ?? [];
    const result = String(request.messages.filter(m => m.role === 'tool').at(-1)?.content ?? '');
    let tool: { name: string; args: object } | undefined;
    if (current === '开始，你们自主协作起来') {
      expect(names).toContain('collaboration_start_workflow');
      expect(names).not.toContain('collaboration_dispatch_tasks');
      if (round < 2) { // The second call has a different ID but must return the same workflow.
        if (round) expect(result).toContain('"ok":true');
        tool = { name: 'collaboration_start_workflow', args: { goal: '测试小说：先建立世界观，再写首章；提交两份文档。' } };
      } else { expect(result).toContain('"ok":true'); this.checks.push('started'); }
    } else if (current.startsWith('测试小说：')) {
      expect(names).toContain('collaboration_dispatch_tasks');
      expect(names).not.toContain('collaboration_start_workflow');
      if (!round) tool = { name: 'collaboration_dispatch_tasks', args: { tasks: [
        { key: 'world', assigneeMemberId: 'agent:expert', title: '设定', instructions: '[世界观工作]给出设定', deliverable: { kind: 'document', title: '设定' } },
        { key: 'chapter', assigneeMemberId: 'agent:writer', title: '首章', instructions: '[正文工作]根据设定写首章', dependsOnTaskIds: ['world'], deliverable: { kind: 'document', title: '首章' } },
      ] } };
      else { expect(result).toContain('"ok":true'); this.checks.push('dispatched'); }
    } else if (current.startsWith('[世界观工作]')) {
      expect(names).not.toContain('collaboration_start_workflow');
      if (!round) tool = { name: 'collaboration_submit_artifact', args: { content: '# 世界观\n主角没有超能力。' } };
      else { expect(result).toContain('"ok":true'); this.checks.push('world'); }
    } else if (current.startsWith('[正文工作]')) {
      if (!round) tool = { name: 'collaboration_read_context', args: { kind: 'tasks' } };
      else if (round === 1) { expect(result).toContain('设定'); tool = { name: 'collaboration_submit_artifact', args: { content: '# 首章\n主角依靠观察解决谜题。' } }; }
      else { expect(result).toContain('"ok":true'); this.checks.push('chapter'); }
    } else if (current.startsWith('先读取本群工作索引')) {
      if (!round) tool = { name: 'collaboration_read_context', args: { kind: 'tasks' } };
      else { expect(result).toContain('首章'); this.checks.push('reviewed'); }
    } else if (current === '强制测试只讨论权限') {
      expect(names).not.toContain('collaboration_start_workflow');
      if (!round) tool = { name: 'collaboration_start_workflow', args: { goal: '越过只讨论派工' } };
      else { expect(result).not.toContain('"ok":true'); this.checks.push('restricted'); }
    } else {
      expect(current).toBe('现在呢？');
      expect(names).not.toContain('collaboration_submit_artifact');
      this.checks.push('status-only');
    }
    if (tool) {
      yield { type: 'tool-call', toolCall: { id: task + '-' + round, name: tool.name, argumentsJson: JSON.stringify(tool.args) } };
      yield { type: 'finished', reason: 'tool-requests' };
    } else {
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: '已核对本群实际执行状态。' };
      yield { type: 'finished', reason: 'stop' };
    }
  }
}

it('turns a human chat approval into one real workflow, delivers in dependency order, follows up and keeps progress queries conversational', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'collab-chat-workflow-')));
  const db = join(directory, 'test.db'); await runMigrations(db);
  const connection = await openDatabaseAsync({ path: db });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({ id: 'chat-workspace' as WorkspaceId, name: '聊天开工', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  for (const id of ['leader', 'writer', 'expert']) agents.create({ id: id as AgentId, name: id, writePolicy: 'read-only', defaultModelId: 'fake-mini' as ModelId });
  const conversations = new SqliteConversationStore(connection.raw);
  const repository = new SqliteCollaborationStore(connection.raw);
  const provider = new ChatWorkflowProvider();
  const host: CollaborationChatHost = new CollaborationChatHost(repository, { ownerId: 'chat-test', conversations, agents, workspaces,
    execute: input => runtime.executeCollaborationTaskForHost(input), onChanged: () => {} });
  const runtime: Runtime = new Runtime({ installId: 'chat-test', allowNoToken: true, workspaceStore: workspaces, conversationStore: conversations,
    globalAgentStore: agents, messageStore: new SqliteMessageStore(connection.raw), stateStore: new SqliteEventCheckpointStore(connection.raw), collaborationChatHost: host, demoProvider: provider });
  try {
    const created = host.command({ action: 'create', clientRequestId: 'create', kind: 'group', title: '小说', workspaceId: workspace.id,
      agentIds: ['leader', 'writer', 'expert'], coordinatorAgentId: 'leader' }).snapshot!;
    const id = created.conversation.id;
    const settle = async () => {
      for (let n = 0; n < 350; n++) {
        await host.service.pump(workspace.id); await new Promise(r => setTimeout(r, 10));
        const s = repository.read(id)!;
        if (s.tasks.every(t => ['succeeded', 'failed', 'cancelled'].includes(s.attempts.find(a => a.id === t.currentAttemptId)!.status))) return s;
      }
      throw Error('chat workflow did not settle');
    };
    host.command({ action: 'send', conversationId: id, clientRequestId: 'discuss', text: '强制测试只讨论权限', intent: 'discussion' });
    let s = await settle();
    expect(provider.checks).toContain('restricted'); expect(s.tasks.filter(t => t.kind === 'task')).toHaveLength(0);
    expect(s.tasks[0].workflowStartAllowed).toBeUndefined();
    host.command({ action: 'send', conversationId: id, clientRequestId: 'start', text: '开始，你们自主协作起来', intent: 'chat' });
    s = await settle();
    expect(s.attempts.every(a => a.status === 'succeeded'), JSON.stringify(s.attempts.map(a => ({ error: a.error, tools: a.tools })))).toBe(true);
    expect(provider.checks).toEqual(['restricted', 'started', 'dispatched', 'world', 'chapter', 'reviewed']);
    const source = s.tasks.find(t => t.workflowStartAllowed)!;
    expect(s.tasks.filter(t => t.parentTaskId === source.id && t.purpose === 'coordination')).toHaveLength(2); // initial coordination and final review
    expect(s.tasks.filter(t => t.purpose === 'work')).toHaveLength(2);
    const [world, chapter] = s.tasks.filter(t => t.purpose === 'work');
    const worldDelivery = s.messages.find(m => m.taskId === world.id && m.kind === 'task_result')!;
    const chapterAssignment = s.messages.find(m => m.taskId === chapter.id && m.kind === 'task_assignment')!;
    expect(chapterAssignment.sequence).toBeGreaterThan(worldDelivery.sequence);
    expect(s.tasks.every(t => !t.pendingAssignment)).toBe(true);
    expect(s.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(2);
    expect(s.tasks.some(t => t.consultation)).toBe(false); // real jobs, not disguised consultations
    expect(s.conversation.room!.state).toBe('review');
    expect(s.conversation.room!.goal).toContain('先建立世界观');
    expect(s.conversation.room!.goalOrigin).toBe('assistant');
    expect(s.messages.some(m => m.kind === 'system' && m.blocks.some(b => b.text?.startsWith('已自动整理工作目标')))).toBe(true);
    const workCount = s.tasks.filter(t => t.kind === 'task').length;
    host.command({ action: 'send', conversationId: id, clientRequestId: 'progress', text: '现在呢？', intent: 'chat' });
    s = await settle();
    expect(provider.checks.at(-1)).toBe('status-only');
    expect(s.tasks.filter(t => t.kind === 'task')).toHaveLength(workCount);
    expect(s.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(2);
    const sourceAttempt = s.attempts.find(a => a.id === source.currentAttemptId)!;
    expect(() => host.command({ action: 'start-workflow', conversationId: id, clientRequestId: 'stale', parentTaskId: source.id, goal: 'stale work' }, 'agent:leader', { taskId: source.id, attemptId: sourceAttempt.id })).toThrow('explicit_user_start_required');
  } finally {
    await host.service.stop(); await runtime.stop(); connection.raw.close();
    if (directory.startsWith(realpathSync(tmpdir())) && directory.includes('collab-chat-workflow-')) rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
