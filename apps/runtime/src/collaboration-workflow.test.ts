import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_COLLABORATION_CHAT_POLICY, type CollaborationSnapshot, type CollaborationTask, type CollaborationAttempt, type Team } from '@sync-think/shared';
import { compileCollaborationWorkflow, buildCollaborationExecutionContext } from './collaboration-workflow.js';
import { submitCollaborationArtifact, existingArtifactHash } from './collaboration-artifacts.js';
import { CollaborationChatService } from './collaboration-chat-service.js';

function fixture() {
  const snapshot: CollaborationSnapshot = { conversation: { id: 'c', workspaceId: 'w', kind: 'group', title: '小说', coordinatorMemberId: 'agent:a', policy: { ...DEFAULT_COLLABORATION_CHAT_POLICY }, createdAt: '2026-09-29' },
    members: [{ id: 'user', kind: 'user', name: '用户', avatar: '', role: '', active: true }, ...['a', 'b', 'c', 'd', 'e'].map(id => ({ id: `agent:${id}`, agentId: id, kind: 'agent' as const, name: id, avatar: '', role: id, active: true }))],
    messages: [], tasks: [], attempts: [], deliveries: [], receipts: {}, revision: 0 };
  const task: CollaborationTask = { id: 't', rootTaskId: 't', originMessageId: 'm', assigneeMemberId: 'agent:a', title: '简报', instructions: '写简报', expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: 'c', replyToMessageId: 'm' }, timeoutSeconds: 60, currentAttemptId: 'a', kind: 'task', createdAt: '', deliverable: { kind: 'document', title: '创作简报' } };
  const attempt: CollaborationAttempt = { id: 'a', taskId: 't', number: 1, status: 'running', output: '', updatedAt: '', contextSequence: 1, tools: [], checklist: [], resourceClaims: [] };
  return { snapshot, task, attempt };
}

describe('collaboration workflow contracts', () => {
  it('compiles all five roles with real serial edges and document contracts', () => {
    const { snapshot } = fixture();
    const tasks = compileCollaborationWorkflow(snapshot, '保持《回声十秒》，交付首章修订版');
    expect(tasks).toHaveLength(5);
    expect(tasks.map(t => t.dependsOnTaskIds)).toEqual([[], ['stage-1'], ['stage-2'], ['stage-3'], ['stage-4']]);
    expect(tasks.every(t => t.deliverable?.kind === 'document')).toBe(true);
    expect(tasks[4].instructions).toContain('首章修订版');
  });
  it('honors a parallel team DAG, includes later group members, and rejects missing team members', () => {
    const { snapshot } = fixture();
    const team = { name: '小说', mission: '创作', strategy: 'parallel', members: [
      { agentId: 'a', memberOrder: 0, role: '简报', title: '简报', dependsOn: [] },
      { agentId: 'b', memberOrder: 1, role: '世界观', title: '世界观', dependsOn: ['a'] },
      { agentId: 'c', memberOrder: 2, role: '人物', title: '人物', dependsOn: ['a'] },
    ] } as Team;
    expect(compileCollaborationWorkflow(snapshot, '写小说', team).map(t => t.dependsOnTaskIds)).toEqual([[], ['stage-1'], ['stage-1'], [], []]);
    snapshot.members[2].active = false;
    expect(() => compileCollaborationWorkflow(snapshot, '写小说', team)).toThrow('workflow_member_missing');
  });
  it('passes prior discussion and submitted upstream versions, excludes future chat and thinking', () => {
    const { snapshot, task, attempt } = fixture();
    snapshot.messages = [1, 2].map(sequence => ({ id: `m${sequence}`, conversationId: 'c', senderMemberId: 'user', recipientMemberIds: [], mentions: [], kind: 'chat', blocks: [{ type: 'text', text: sequence === 1 ? '项目名字：回声十秒' : 'future secret' }], expectsResponse: false, correlationId: '', hopCount: 0, sequence, createdAt: '' }));
    const artifact = submitCollaborationArtifact({ task, attempt, content: '主角：陈默；设定：十秒回声' });
    snapshot.tasks = [task]; snapshot.attempts = [{ ...attempt, status: 'succeeded', artifacts: [artifact], commentary: 'not chat' }];
    const next = { ...task, id: 'next', dependsOnTaskIds: ['t'] };
    const context = buildCollaborationExecutionContext(snapshot, next, attempt);
    expect(context).toContain('回声十秒'); expect(context).toContain('十秒回声'); expect(context).toContain(artifact.sha256);
    expect(context).not.toContain('future secret'); expect(context).not.toContain('not chat');
  });
  it('orders shared ancestors before their revised outputs regardless of dependency declaration order', () => {
    const { snapshot, task, attempt } = fixture();
    const revised = { ...task, id: 'revised', currentAttemptId: 'revision-attempt', dependsOnTaskIds: [task.id] };
    const revisionAttempt = { ...attempt, id: revised.currentAttemptId, taskId: revised.id, status: 'succeeded' as const };
    snapshot.tasks = [task, revised];
    snapshot.attempts = [
      { ...attempt, status: 'succeeded', artifacts: [submitCollaborationArtifact({ task, attempt, content: '原始设定' })] },
      { ...revisionAttempt, artifacts: [submitCollaborationArtifact({ task: revised, attempt: revisionAttempt, content: '修订后的设定' })] },
    ];
    for (const dependencies of [[task.id, revised.id], [revised.id, task.id]]) {
      const context = buildCollaborationExecutionContext(snapshot, { ...task, id: 'final', dependsOnTaskIds: dependencies }, attempt);
      const upstream = JSON.parse(context.split('<upstream_deliverables>\n')[1].split('\n</upstream_deliverables>')[0]);
      expect(upstream.map((stage: { taskId: string }) => stage.taskId)).toEqual([task.id, revised.id]);
      expect(upstream.at(-1).artifacts[0].content).toBe('修订后的设定');
    }
  });
  it('versions documents, rejects blank delivery, checks changed files and workspace containment', () => {
    const { task, attempt } = fixture();
    const artifact = submitCollaborationArtifact({ task, attempt, content: '# 真实简报' });
    expect(artifact.content).toBe('# 真实简报'); expect(artifact.sha256).toHaveLength(64);
    expect(() => submitCollaborationArtifact({ task, attempt, content: ' ' })).toThrow('content_required');
    const root = mkdtempSync(join(tmpdir(), 'collab-artifact-'));
    try {
      mkdirSync(join(root, 'work')); writeFileSync(join(root, 'outside.md'), 'outside'); writeFileSync(join(root, 'work', 'story.md'), 'old');
      task.deliverable = { kind: 'file', title: '正文', path: 'story.md' };
      const previousHash = existingArtifactHash(join(root, 'work'), task);
      expect(() => submitCollaborationArtifact({ task, attempt, workspaceRoot: join(root, 'work'), previousHash })).toThrow('unchanged');
      writeFileSync(join(root, 'work', 'story.md'), 'real new chapter');
      expect(submitCollaborationArtifact({ task, attempt, workspaceRoot: join(root, 'work'), previousHash }).bytes).toBe(16);
      task.deliverable.path = '../outside.md';
      expect(() => submitCollaborationArtifact({ task, attempt, workspaceRoot: join(root, 'work') })).toThrow('outside_workspace');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('does not mark a promise as delivery, stops dependent nodes, and resumes them after retry', async () => {
    let { snapshot } = fixture(); let succeed = false;
    const repository = { read: () => structuredClone(snapshot), list: () => [structuredClone(snapshot)], save: (s: CollaborationSnapshot) => { snapshot = structuredClone(s); }, transaction: <T>(work: () => T) => work() };
    const service = new CollaborationChatService(repository, { ownerId: 'owner', onChanged: () => {}, resourceClaims: () => [{ key: 'w', mode: 'read' }],
      execute: async ({ task, attempt }) => task.kind === 'summary' ? { output: '汇总' } : { output: '我准备开始了', ...(succeed ? { artifacts: [submitCollaborationArtifact({ task, attempt, content: `正文-${task.title}` })] } : {}) } });
    try {
      service.dispatch({ action: 'dispatch', conversationId: 'c', clientRequestId: 'create', tasks: compileCollaborationWorkflow(snapshot, '写首章').slice(0, 2) });
      for (let i = 0; i < 20; i++) { await service.pump('w'); await new Promise(r => setTimeout(r, 5)); }
      const first = snapshot.tasks[0]; const second = snapshot.tasks[1];
      expect(snapshot.attempts.find(a => a.id === first.currentAttemptId)?.error?.code).toBe('deliverable_missing');
      expect(snapshot.attempts.find(a => a.id === second.currentAttemptId)).toMatchObject({ status: 'queued', waitReason: 'dependency_failed' });
      expect(snapshot.tasks[1].pendingAssignment).toBeTruthy();
      succeed = true; service.retry({ action: 'retry', conversationId: 'c', taskId: first.id, clientRequestId: 'retry' });
      for (let i = 0; i < 20; i++) { await service.pump('w'); await new Promise(r => setTimeout(r, 5)); }
      const nodes = snapshot.tasks.filter(t => t.kind === 'task');
      expect(nodes.every(t => snapshot.attempts.find(a => a.id === t.currentAttemptId)?.status === 'succeeded')).toBe(true);
      expect(snapshot.attempts.filter(a => a.taskId === second.id)).toHaveLength(1);
      expect(snapshot.attempts.find(a => a.id === first.currentAttemptId)?.status).toBe('failed'); // historical attempt is intact
    } finally { await service.stop(); }
  });
});
