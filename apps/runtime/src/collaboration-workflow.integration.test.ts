import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FakeProvider, type ProviderCallRequest, type AdapterEvent } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore, SqliteConversationStore, SqliteCollaborationStore, SqliteGlobalAgentStore, SqliteWorkspaceStore, SqliteTeamStore, SqliteMessageStore } from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';

class WorkflowProvider extends FakeProvider {
  rounds = new Map<string, number>();
  stagePrompts: string[] = [];
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    const prompt = request.systemPrompt ?? '';
    const task = prompt.match(/当前任务 ID：([^；]+)/)?.[1] ?? request.idempotencyKey;
    const round = this.rounds.get(task) ?? 0; this.rounds.set(task, round + 1);
    const user = String(request.messages.filter(m => m.role === 'user').at(-1)?.content ?? '');
    const names = request.tools?.map(t => t.name) ?? [];
    if (prompt.includes('任务类型：reply') && user.includes('开始') && round < 2) {
      expect(prompt).toContain('书名是《回声十秒》');
      expect(names).toContain('collaboration_start_workflow');
      expect(names).not.toContain('write_file');
      expect(prompt).not.toContain('当前只读轮次不提供智能体委派工具');
      yield { type: 'assistant-message-delta', phase: 'commentary', text: '我先查看工作区。' };
      yield { type: 'tool-call', toolCall: { id: `start-${round}`, name: 'collaboration_start_workflow', argumentsJson: JSON.stringify({ goal: '继续《回声十秒》，交付首章修订版' }) } };
      yield { type: 'finished', reason: 'tool-requests' }; return;
    }
    if (prompt.includes('任务类型：task') && round === 0) {
      const stage = this.stagePrompts.length; this.stagePrompts.push(prompt);
      expect(names).toContain('collaboration_submit_artifact');
      expect(names).not.toContain('write_file');
      expect(names).not.toContain('collaboration_start_workflow');
      if (stage > 0) expect(prompt).toContain(`阶段 ${stage - 1} 的完整产物`);
      yield { type: 'tool-call', toolCall: { id: `artifact-${stage}`, name: 'collaboration_submit_artifact', argumentsJson: JSON.stringify({ content: `# 回声十秒\n阶段 ${stage} 的完整产物\n陈默听到了十秒后的回声。` }) } };
      yield { type: 'finished', reason: 'tool-requests' }; return;
    }
    if (prompt.includes('任务类型：task')) {
      const toolResult = request.messages.filter(m => m.role === 'tool').at(-1);
      expect(String(toolResult?.content)).toContain('"ok":true');
    }
    yield { type: 'assistant-message-delta', phase: 'final_answer', text: prompt.includes('任务类型：summary') ? '五个阶段已交付，修订版可打开查看。' : '已收到。' };
    yield { type: 'finished', reason: 'stop' };
  }
}

it('runs a five-member novel workflow from a continuing chat, without readonly escapes or textual fake delegation', async () => {
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
  let runtime!: Runtime;
  const host = new CollaborationChatHost(repository, { ownerId: 'e2e-runtime', conversations, agents, teams, workspaces,
    execute: input => runtime.executeCollaborationTaskForHost(input), onChanged: () => {} });
  runtime = new Runtime({ installId: 'workflow-test', allowNoToken: true, workspaceStore: workspaces, conversationStore: conversations,
    globalAgentStore: agents, teamStore: teams, messageStore: new SqliteMessageStore(connection.raw), stateStore: new SqliteEventCheckpointStore(connection.raw), collaborationChatHost: host, demoProvider: provider });
  try {
    const created = host.command({ action: 'create', clientRequestId: 'create', kind: 'group', title: '小说创作小队', workspaceId: workspace.id, agentIds: [], teamId: team.id }).snapshot!;
    const id = created.conversation.id;
    host.command({ action: 'send', conversationId: id, clientRequestId: 'greeting', text: '你好，书名是《回声十秒》，先讨论。' });
    const settle = async () => {
      for (let n = 0; n < 200; n++) {
        await host.service.pump(workspace.id); await new Promise(r => setTimeout(r, 10));
        const snapshot = repository.read(id)!;
        if (snapshot.tasks.length && snapshot.tasks.every(t => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(snapshot.attempts.find(a => a.id === t.currentAttemptId)!.status))) return snapshot;
      }
      throw new Error('workflow did not settle: ' + JSON.stringify(repository.read(id)?.attempts.map(a => ({ status: a.status, output: a.output, error: a.error, waitReason: a.waitReason }))));
    };
    const greeting = await settle();
    expect(greeting.tasks.every(t => t.kind === 'reply')).toBe(true);
    host.command({ action: 'send', conversationId: id, clientRequestId: 'start', text: '好的，开始吧，交给对应的人写首章。' });
    const finished = await settle();
    const stages = finished.tasks.filter(t => t.kind === 'task');
    expect(stages).toHaveLength(5); // retrying start with a new provider call ID did not duplicate the workflow
    expect(stages.map(t => t.assigneeMemberId)).toEqual(members.map(m => `agent:${m.id}`));
    expect(stages.every(t => finished.attempts.find(a => a.id === t.currentAttemptId)?.status === 'succeeded')).toBe(true);
    expect(stages.map(t => finished.attempts.find(a => a.id === t.currentAttemptId)?.artifacts?.[0].content)).toEqual(roles.map((_, i) => `# 回声十秒\n阶段 ${i} 的完整产物\n陈默听到了十秒后的回声。`));
    expect(finished.tasks.filter(t => t.kind === 'summary')).toHaveLength(1);
    expect(provider.stagePrompts).toHaveLength(5);
    expect(conversations.get(id)?.executionMode).toBe('ask');
    expect(members.every(m => agents.get(m.id)?.writePolicy === 'read-only')).toBe(true);
    const persisted = new SqliteCollaborationStore(connection.raw).read(id)!;
    expect(persisted.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(5);
    host.command({ action: 'send', conversationId: id, clientRequestId: 'writer-only', text: '开始润色上一章。', recipientMemberIds: [`agent:${members[3].id}`] });
    const solo = await settle();
    const newStages = solo.tasks.filter(t => t.kind === 'task' && !stages.some(old => old.id === t.id));
    expect(newStages).toHaveLength(1);
    expect(newStages[0].assigneeMemberId).toBe(`agent:${members[3].id}`);
    expect(newStages[0].contextRefs).toHaveLength(5);
    expect(solo.attempts.find(a => a.id === newStages[0].currentAttemptId)?.status).toBe('succeeded');
  } finally { await host.service.stop(); await runtime.stop(); connection.raw.close(); rmSync(directory, { recursive: true, force: true }); }
}, 20000);
