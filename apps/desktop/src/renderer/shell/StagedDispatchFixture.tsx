/** Offline QA states for the real room chat. Never imported by shell-entry. */
import { useState } from 'react';
import { COLLABORATION_EXECUTION_VERSION, type CollaborationSnapshot, type Conversation, type GlobalAgent } from '@sync-think/shared';
import { CollaborationChatView } from './CollaborationChatView.js';
import { DialogProvider } from './Dialog.js';
import { botAvatarSeed } from './bot-avatar.js';
import './agent-workspace.css';

type Stage = 'world' | 'outline' | 'failed' | 'chapter' | 'done';
const stageLabels: Record<Stage, string> = { world: '世界观执行中', outline: '交付世界观', failed: '细纲超时', chapter: '重试并交付细纲', done: '交付正文' };
const date = '2026-10-03T00:00:00Z';
const id = 'staged-dispatch';
const roles = [
  ['leader', '小说小队-主策划', 'violet'],
  ['world', '小说小队-世界观架构师', 'orange'],
  ['outline', '小说小队-大纲师', 'blue'],
  ['writer', '小说小队-正文写手', 'cyan'],
] as const;
const titles = ['《示例小说》创作简报与世界观设定', '《示例小说》38 章细纲与情绪曲线', '《示例小说》正文第 1–4 章'];
function snapshot(stage: Stage, revision: number): CollaborationSnapshot {
  const advanced = stage !== 'world';
  const chapter = stage === 'chapter' || stage === 'done';
  const done = stage === 'done';
  const tasks: CollaborationSnapshot['tasks'] = titles.map((title, n) => ({
    id: 'stage-' + n, rootTaskId: 'stage-0', originMessageId: n === 0 || n === 1 && advanced || n === 2 && chapter ? 'assignment-' + n : 'human',
    assigneeMemberId: roles[n + 1][0], coordinatorMemberId: 'leader', goalRevision: 1, purpose: 'work',
    workStatus: n === 0 && advanced || n === 1 && chapter || n === 2 && done ? 'in_review' : n === 0 || n === 1 && advanced && stage !== 'failed' || n === 2 && chapter ? 'in_progress' : 'waiting',
    title, instructions: title, expectedOutput: '完整文档', deliverable: { kind: 'document', title },
    dependsOnTaskIds: n ? ['stage-' + (n - 1)] : [], contextRefs: [], resourceClaims: [],
    returnTo: { conversationId: id, replyToMessageId: 'human' }, timeoutSeconds: 7200,
    currentAttemptId: 'attempt-' + n, kind: 'task', createdAt: date,
    ...(n === 1 && !advanced || n === 2 && !chapter ? { pendingAssignment: { senderMemberId: 'leader', correlationId: 'novel', causationMessageId: 'human', hopCount: 1 } } : {}),
  }));
  const attempts: CollaborationSnapshot['attempts'] = tasks.map((task, n) => {
    const completed = n === 0 && advanced || n === 1 && chapter || n === 2 && done;
    const failed = n === 1 && stage === 'failed';
    const status = task.pendingAssignment ? 'queued' : failed ? 'failed' : completed ? 'succeeded' : 'running';
    return { id: task.currentAttemptId, taskId: task.id, number: n === 1 && chapter ? 2 : 1, status,
      ...(task.pendingAssignment ? { waitReason: stage === 'failed' ? 'dependency_failed' as const : 'dependency' as const } : { startedAt: date }),
      ...(completed || failed ? { finishedAt: date } : {}), updatedAt: date, contextSequence: 1,
      output: completed ? '文档已交付。' : '', resourceClaims: [], tools: [], checklist: [],
      ...(failed ? { error: { code: 'provider.timeout', category: 'timeout' as const, message: '细纲执行超时，请重试本阶段。正文仍在计划中，尚未派工。', retryable: true, traceId: 'fixture' } } : {}),
      ...(completed ? { artifacts: [{ id: 'doc-' + n, taskId: task.id, attemptId: task.currentAttemptId, title: task.title,
        kind: 'document' as const, content: '# ' + task.title + '\n\n本阶段交付内容。', sha256: 'fixture', bytes: 120, createdAt: date }] } : {}),
    };
  });
  const messages: CollaborationSnapshot['messages'] = [{ id: 'human', conversationId: id, senderMemberId: 'user', recipientMemberIds: ['leader'], mentions: [], kind: 'chat', blocks: [{ type: 'text', text: '请按世界观 → 细纲 → 正文推进，每个阶段交付后再派下一阶段。' }], expectsResponse: true, correlationId: 'novel', hopCount: 0, sequence: 1, createdAt: date }];
  for (const [n, task] of tasks.entries()) {
    if (task.pendingAssignment) continue;
    messages.push({ id: 'assignment-' + n, conversationId: id, senderMemberId: 'leader', recipientMemberIds: [task.assigneeMemberId], mentions: [{ memberId: task.assigneeMemberId, label: roles[n + 1][1] }], kind: 'task_assignment', blocks: [{ type: 'text', text: task.instructions }], taskId: task.id, attemptId: task.currentAttemptId, expectsResponse: true, correlationId: 'novel', causationId: 'human', replyToMessageId: 'human', hopCount: 1, sequence: messages.length + 1, createdAt: date });
    if (attempts[n].status === 'succeeded' || attempts[n].status === 'failed') messages.push({
      id: 'result-' + n, conversationId: id, senderMemberId: task.assigneeMemberId, recipientMemberIds: ['leader'], mentions: [], kind: 'task_result', blocks: [{ type: 'text', text: attempts[n].output || attempts[n].error?.message || '' }], taskId: task.id, attemptId: task.currentAttemptId, expectsResponse: false, correlationId: 'novel', replyToMessageId: 'human', hopCount: 2, sequence: messages.length + 1, createdAt: date,
    });
  }
  return { conversation: { id, workspaceId: 'fixture', kind: 'group', title: '小说小队 · 逐阶段派工', coordinatorMemberId: 'leader', createdAt: date,
    policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 7200, statusTimeoutSeconds: 120 },
    room: { version: 1, state: stage === 'failed' ? 'blocked' : done ? 'review' : 'running', goal: '世界观交付后派细纲，细纲交付后派正文。', goalRevision: 1, sourceSequence: 1,
      checkpoint: { version: revision, savedAt: date, pendingTaskIds: tasks.filter((_, n) => attempts[n].status !== 'succeeded').map(t => t.id), completedTaskIds: tasks.filter((_, n) => attempts[n].status === 'succeeded').map(t => t.id), artifactIds: attempts.flatMap(a => a.artifacts?.map(x => x.id) ?? []), note: stage === 'failed' ? '细纲超时，等待重试；正文尚未派工。' : '' } } },
    members: [{ id: 'user', name: '你', kind: 'user', avatar: '', role: '用户', active: true }, ...roles.map(([memberId, name, color]) => ({ id: memberId, agentId: memberId, name, kind: 'agent' as const, avatar: botAvatarSeed('drop', color), role: '', active: true }))], tasks, attempts, messages, deliveries: [], revision, receipts: {} };
}
function fixtureStore() {
  let current = snapshot('world', 1);
  const listeners = new Set<(event: { type: string; payload: { conversationId: string } }) => void>();
  return {
    runtime: { onEvent: (listener: (event: { type: string; payload: { conversationId: string } }) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      collaboration: async () => ({ snapshot: current, executionVersion: COLLABORATION_EXECUTION_VERSION }),
      listWaitingBrowserHandoffs: async () => ({ handoffs: [] }),
      listPendingToolApprovals: async () => ({ approvals: [] }),
    },
    advance(stage: Stage) { current = snapshot(stage, current.revision + 1); for (const listener of listeners) listener({ type: 'collaboration.updated', payload: { conversationId: id } }); },
  };
}
export default function StagedDispatchFixture() {
  const [store] = useState(() => { const store = fixtureStore(); Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: store.runtime } }); return store; });
  const [stage, setStage] = useState<Stage>('world');
  const parameters = new URLSearchParams(location.search);
  if (parameters.get('viewport') === 'mobile') {
    parameters.delete('viewport');
    return <main style={{ height: '100dvh', display: 'flex', justifyContent: 'center', overflow: 'auto', padding: 16 }}>
      <iframe title="逐阶段派工窄屏验收" src={'/?' + parameters.toString()} width="390" height="844" style={{ border: 0, flex: '0 0 390px' }} />
    </main>;
  }
  const conversation = { id, workspaceId: 'fixture', title: '小说小队 · 逐阶段派工', collaborationKind: 'group', track: 'agent', targetRef: 'leader', executionMode: 'workspace', interactionMode: 'execute', createdAt: date, updatedAt: date } as Conversation;
  const agents = roles.map(([agentId, name]) => ({ id: agentId, name, enabled: true, archived: false, description: '' })) as GlobalAgent[];
  return <DialogProvider><main className="agent-chat-workspace" style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <nav aria-label="逐阶段派工验收" style={{ display: 'flex', gap: 8, padding: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--color-border)' }}>
      {Object.entries(stageLabels).map(([key, label]) => <button className="collab-pill" key={key} aria-pressed={stage === key} onClick={() => { setStage(key as Stage); store.advance(key as Stage); }}>{label}</button>)}
      <small>离线验收 · 真实聊天组件 · 不调用外部模型</small>
    </nav>
    <CollaborationChatView conversation={conversation} agents={agents} workspace onOpenConversation={() => {}} />
  </main></DialogProvider>;
}
