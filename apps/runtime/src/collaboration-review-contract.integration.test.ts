import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { FakeProvider, type AdapterEvent, type ProviderCallRequest } from '@sync-think/adapters';
import { openDatabaseAsync, runMigrations, SqliteEventCheckpointStore, SqliteConversationStore, SqliteCollaborationStore, SqliteGlobalAgentStore, SqliteWorkspaceStore, SqliteMessageStore } from '@sync-think/storage';
import type { AgentId, ModelId, WorkspaceId } from '@sync-think/shared';
import { Runtime } from './runtime.js';
import { CollaborationChatHost } from './collaboration-chat-host.js';

class ReviewProvider extends FakeProvider {
  rounds = new Map<string, number>();
  rejectedAmbiguousDispatch = 0;
  override async *call(request: ProviderCallRequest): AsyncIterable<AdapterEvent> {
    if (request.systemPrompt?.includes('You are the routing controller of this group')) {
      expect(request.tools ?? []).toEqual([]);
      const coordinator = request.systemPrompt.match(/"coordinatorMemberId":"([^"]+)"/)?.[1];
      expect(coordinator).toBeTruthy();
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: JSON.stringify({ mode: 'single', memberIds: [coordinator] }) };
      yield { type: 'finished', reason: 'stop' }; return;
    }

    const prompt = request.systemPrompt ?? '';
    const current = prompt.match(/当前请求：([^\n]+)/)?.[1] ?? '';
    const resumed = prompt.includes('本轮是咨询后的继续');
    const task = prompt.match(/taskId=([^；\n]+)/)?.[1] ?? request.idempotencyKey;
    const key = task + ':' + resumed;
    const round = this.rounds.get(key) ?? 0; this.rounds.set(key, round + 1);
    const result = String(request.messages.filter(m => m.role === 'tool').at(-1)?.content ?? '');
    let tool: { name: string; args: object } | undefined;
    let answer = '本轮已处理。';
    if (current === '开始合同回归') {
      if (!round) tool = { name: 'collaboration_start_workflow', args: { goal: '[REVIEW-WORK]只交一份正文，编辑仅给一句审校意见，不交报告。' } };
    } else if (current.startsWith('[REVIEW-WORK]')) {
      if (!round) tool = { name: 'collaboration_dispatch_tasks', args: { tasks: [{
        assigneeMemberId: 'agent:writer', title: '正文', instructions: '[WRITE]交付纯正文', deliverable: { kind: 'document', title: '正文' },
      }] } };
    } else if (current.startsWith('[WRITE]')) {
      if (!round) tool = { name: 'collaboration_submit_artifact', args: { content: '凌晨公交站，许舟等到了车。' } };
    } else if (current.startsWith('[READONLY-REVIEW]')) {
      expect(request.tools?.map(t => t.name)).not.toContain('collaboration_submit_artifact');
      if (!round) tool = { name: 'collaboration_read_context', args: { kind: 'artifact', id: current.split(' ')[1] } };
      else { expect(result).toContain('许舟'); answer = '审校通过：人物、地点与结尾完整。'; }
    } else if (current.startsWith('先读取本群工作索引')) {
      if (resumed) {
        if (!round) tool = { name: 'collaboration_read_context', args: { kind: 'tasks' } };
        else { expect(result).toContain('审校通过'); answer = '正文已交付，审校通过，待验收。'; }
      } else if (!round) {
        // Regression: a one-line review with no deliverable must not be silently upgraded to a document job.
        tool = { name: 'collaboration_dispatch_tasks', args: { tasks: [{
          assigneeMemberId: 'agent:expert', title: '只给一句审校意见', instructions: '读正文，只回一句，不提交文档', expectedOutput: '一句意见',
        }] } };
      } else if (round === 1) {
        expect(result).toContain('task_room.deliverable_contract_required'); this.rejectedAmbiguousDispatch++;
        const artifacts = JSON.parse(prompt.match(/<artifact_index>(.*)<\/artifact_index>/)?.[1] ?? '[]');
        tool = { name: 'collaboration_send_message', args: { recipientMemberIds: ['agent:expert'], deliveryMode: 'consult',
          text: '[READONLY-REVIEW] ' + artifacts[0].id + ' 请读真实正文，只给一句意见。' } };
      } else { expect(result).toContain('"ok":true'); answer = '等待审校后继续。'; }
    } else throw new Error('Unexpected current request: ' + current);
    if (tool) {
      yield { type: 'tool-call', toolCall: { id: key + '-' + round, name: tool.name, argumentsJson: JSON.stringify(tool.args) } };
      yield { type: 'finished', reason: 'tool-requests' };
    } else {
      yield { type: 'assistant-message-delta', phase: 'final_answer', text: answer };
      yield { type: 'finished', reason: 'stop' };
    }
  }
}

it('rejects an ambiguous document assignment before queueing and completes real read-only review with one artifact', async () => {
  const parent = realpathSync(tmpdir());
  const directory = realpathSync(mkdtempSync(join(parent, 'collab-review-contract-')));
  const db = join(directory, 'test.db'); await runMigrations(db);
  const connection = await openDatabaseAsync({ path: db });
  const workspaces = new SqliteWorkspaceStore(connection.raw);
  const workspace = workspaces.createWorkspace({ id: 'review-workspace' as WorkspaceId, name: '只读审校', folderPath: directory });
  const agents = new SqliteGlobalAgentStore(connection.raw);
  for (const id of ['leader', 'writer', 'expert']) agents.create({ id: id as AgentId, name: id, writePolicy: 'read-only', defaultModelId: 'fake-mini' as ModelId });
  const conversations = new SqliteConversationStore(connection.raw);
  const repository = new SqliteCollaborationStore(connection.raw);
  const provider = new ReviewProvider();
  const host: CollaborationChatHost = new CollaborationChatHost(repository, { ownerId: 'review-test', conversations, agents, workspaces,
    execute: input => runtime.executeCollaborationTaskForHost(input), onChanged: () => {} });
  const runtime: Runtime = new Runtime({ installId: 'review-test', allowNoToken: true, workspaceStore: workspaces, conversationStore: conversations,
    globalAgentStore: agents, messageStore: new SqliteMessageStore(connection.raw), stateStore: new SqliteEventCheckpointStore(connection.raw), collaborationChatHost: host, demoProvider: provider });
  try {
    const room = host.command({ action: 'create', clientRequestId: 'create', kind: 'group', title: '合同回归', workspaceId: workspace.id,
      agentIds: ['leader', 'writer', 'expert'], coordinatorAgentId: 'leader' }).snapshot!;
    host.command({ action: 'send', conversationId: room.conversation.id, clientRequestId: 'start', text: '开始合同回归', intent: 'chat' });
    for (let n = 0; n < 300; n++) {
      await host.service.pump(workspace.id); await new Promise(r => setTimeout(r, 10));
      const s = repository.read(room.conversation.id)!;
      if (s.tasks.every(t => ['succeeded', 'failed', 'cancelled'].includes(s.attempts.find(a => a.id === t.currentAttemptId)!.status))) break;
    }
    const s = repository.read(room.conversation.id)!;
    expect(s.attempts.every(a => a.status === 'succeeded'), JSON.stringify(s.attempts.map(a => ({ status: a.status, error: a.error })))).toBe(true);
    expect(provider.rejectedAmbiguousDispatch).toBe(1);
    expect(s.tasks.filter(t => t.purpose === 'work')).toHaveLength(1);
    expect(s.tasks.filter(t => t.consultation)).toHaveLength(1);
    expect(s.attempts.flatMap(a => a.artifacts ?? [])).toHaveLength(1);
    expect(s.conversation.room!.state).toBe('review');
    expect(s.messages.filter(m => m.blocks[0].text === '审校通过：人物、地点与结尾完整。')).toHaveLength(1);
    host.command({ action: 'room-complete', conversationId: room.conversation.id, clientRequestId: 'accept' });
    expect(repository.read(room.conversation.id)!.conversation.room!.state).toBe('completed');
  } finally {
    await host.service.stop(); await runtime.stop(); connection.raw.close();
    const target = relative(parent, directory);
    if (!isAbsolute(target) && !target.startsWith('..') && target.startsWith('collab-review-contract-')) rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
