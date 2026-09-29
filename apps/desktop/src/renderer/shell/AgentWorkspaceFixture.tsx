/** Offline QA fixture only. This file is reachable from qa-entry, never shell-entry. */
import { lazy, useEffect, useState } from 'react';
import type { CollaborationCommand, CollaborationSnapshot, Conversation, GlobalAgent, Team } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import AgentWorkspace from './AgentWorkspace.js';
import { DialogProvider } from './Dialog.js';
import type { ConversationTransientSubscriptionEvent } from './use-conversation-transient-subscription.js';
const LegacyChat = lazy(() => import('./ChatView.js').then(module => ({ default: module.ChatView })));
const fixtureModels = [{ modelId: 'fixture-model', displayName: '离线验收模型', providerName: '本地 fixture' }];
const fixtureEvents: never[] = [];
import { botAvatarSeed } from './bot-avatar.js';

const date = '2026-09-28T09:00:00.000Z';
const definitions = [
  ['designer', '页面设计师', 'square', 'cyan', '把想法变成清晰、有节奏的界面。'],
  ['marketing', '营销顾问', 'star', 'cyan', '找到读者关心的问题，让表达更有说服力。'],
  ['product', '产品规划师', 'drop', 'blue', '梳理优先级、交互状态与可执行的下一步。'],
  ['reviewer', '内容审查员', 'square', 'orange', '让文字准确、简洁，并保持一致的语气。'],
  ['research', '研究助手', 'circle', 'yellow', '整理线索，明确事实与假设。'],
  ['security', '安全工程师', 'hexagon', 'cyan', '复核边界、权限与异常处理。'],
  ['seo', '搜索优化师', 'flower', 'violet', '从结构与搜索意图出发优化内容。'],
] as const;
function initialAgents(): GlobalAgent[] {
  return definitions.map(([id, name, shape, color, description]) => ({ id: id as GlobalAgent['id'], name, avatar: botAvatarSeed(shape, color), description, persona: '', defaultModelId: 'fixture-model' as GlobalAgent['defaultModelId'], fallbackModelIds: [], skillIds: [], mcpServerIds: [], reasoningEffort: 'auto', enabled: true, archived: false, availabilityScope: 'global', createdAt: date, updatedAt: date } as GlobalAgent));
}
function makeSnapshot(id: string, agents: readonly GlobalAgent[], kind: 'direct' | 'group', title: string): CollaborationSnapshot {
  return { conversation: { id, kind, title, workspaceId: 'fixture-workspace', coordinatorMemberId: agents[0]?.id, createdAt: date, policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 7200, statusTimeoutSeconds: 120 } }, members: [{ id: 'user', kind: 'user', name: '你', avatar: '', role: '用户', active: true }, ...agents.map(a => ({ id: a.id, agentId: a.id, name: a.name, avatar: a.avatar, kind: 'agent' as const, role: a.description, active: true }))], messages: [], deliveries: [], tasks: [], attempts: [], revision: 1, receipts: {} };
}
function conversationOf(snapshot: CollaborationSnapshot): Conversation {
  const c = snapshot.conversation;
  return { id: c.id, workspaceId: c.workspaceId, title: c.title, collaborationKind: c.kind, track: 'agent', targetRef: c.coordinatorMemberId ?? '', executionMode: 'workspace', interactionMode: 'execute', createdAt: date, updatedAt: date, lastMessagePreview: snapshot.messages.at(-1)?.blocks[0]?.text ?? '开始一场新的对话' } as Conversation;
}
function message(snapshot: CollaborationSnapshot, sender: string, text: string) {
  return { id: `message-${snapshot.conversation.id}-${snapshot.messages.length}`, conversationId: snapshot.conversation.id, senderMemberId: sender, recipientMemberIds: [], mentions: [], kind: 'chat' as const, blocks: [{ type: 'text' as const, text }], expectsResponse: sender === 'user', correlationId: 'fixture', hopCount: 0, sequence: snapshot.messages.length + 1, createdAt: date };
}

function fixtureStore() {
  let agents = initialAgents();
  if (new URLSearchParams(location.search).has('missing-agent-model')) agents = agents.map((agent, index) => index < 3 ? { ...agent, defaultModelId: 'deleted-model' as GlobalAgent['defaultModelId'] } : agent);
  try { const overrides = JSON.parse(localStorage.getItem('sync-think.qa.agent-appearance.v1') ?? '{}') as Record<string, string>; agents = agents.map(agent => ({ ...agent, avatar: overrides[agent.id] ?? agent.avatar })); } catch { /* QA only */ }
  let teams: Team[] = [{ id: 'fixture-team' as Team['id'], name: '产品小队', avatar: '', mission: '从规划、界面到发布一起完成工作', strategy: 'serial', coordinatorAgentId: agents[2].id, members: agents.slice(0, 3).map((a, memberOrder) => ({ agentId: a.id, memberOrder, role: ['designer', 'marketing', 'coordinator'][memberOrder], title: ['设计师', '营销顾问', '产品规划'][memberOrder], dependsOn: [] })), createdAt: date, updatedAt: date }];
  const teamConversations: Conversation[] = [];
  const transient = new Set<(event: ConversationTransientSubscriptionEvent) => void>();
  let streamSequence = 0;
  const persistAvatars = () => localStorage.setItem('sync-think.qa.agent-appearance.v1', JSON.stringify(Object.fromEntries(agents.map(a => [a.id, a.avatar]))));
  const group = makeSnapshot('fixture-group', agents.slice(0, 3), 'group', '设计 + 营销 + 产品');
  for (const [sender, text] of [
    ['user', '我想做一个更清晰的产品介绍页，你们会从哪里开始？'],
    ['designer', '先让第一屏只回答一个问题：这个产品能为谁解决什么。标题、说明和行动按钮保持一个清楚的阅读顺序。\n\n接着用一张真实的产品界面说明价值，而不是用很多装饰抢走注意力。统一字号、间距和圆角，比堆叠更多卡片更有效。'],
    ['marketing', '我会先确认读者最在意的结果，再围绕它组织内容。每个区域只讲一个重点，让人能迅速判断这是否与自己有关。\n\n最后检查行动按钮前的信息是否足够：我会得到什么、下一步是什么、是否还有未解答的疑问。'],
    ['product', '我会把首次访问、加载、空内容和失败这些状态一起梳理，而不只设计最理想的一屏。\n\n先做一条完整、容易理解的路径，再逐步补上细节。这样每一次点击都有明确反馈，也更容易验证设计是否真的有帮助。'],
  ]) group.messages.push(message(group, sender, text));
  const snapshots = new Map<string, CollaborationSnapshot>([[group.conversation.id, group]]);
  for (const a of agents) { const s = makeSnapshot(`direct-${a.id}`, [a], 'direct', a.name); s.messages.push(message(s, a.id, a.description)); snapshots.set(s.conversation.id, s); }
  const legacy = { ...conversationOf(makeSnapshot('legacy-designer', [agents[0]], 'direct', '你装了哪些技能')), collaborationKind: undefined, taskId: 'legacy-task', updatedAt: '2026-09-28T12:00:00.000Z', lastMessagePreview: '这是旧会话记录，保留原消息和发送接口。' } as Conversation;
  const legacyMessages = [
    { id: 'legacy-user', role: 'user', sequence: 1, threadId: 'legacy-thread', createdAt: date, blocks: [{ type: 'text', text: '你装了哪些技能？' }] },
    { id: 'legacy-answer', role: 'assistant', sequence: 2, threadId: 'legacy-thread', createdAt: date, blocks: [{ type: 'text', text: '我会帮你梳理页面的内容结构、排版与交互状态。\n\n这条消息来自旧会话接口。现在它和新聊天使用一致的气泡、署名和输入区，历史内容仍然保留。' }] },
  ];
  let notify = () => {};
  const listeners = new Set<(event: unknown) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const emit = (snapshot: CollaborationSnapshot) => { snapshot.revision++; snapshots.set(snapshot.conversation.id, { ...snapshot }); listeners.forEach(fn => fn({ type: 'collaboration.updated', payload: { conversationId: snapshot.conversation.id } })); notify(); };
  const promoted = new Map<string, Conversation>();
  const teamTargets = new Map<string, string>();
  const messagePages = new Map<string, typeof legacyMessages>([[legacy.id, legacyMessages]]);
  const threadFor = (id: string) => id === legacy.id ? 'legacy-thread' : 'qa-thread:' + id;
  const runtime = {
    subscribeConversationTransientStream: (_payload: unknown, listener: (event: ConversationTransientSubscriptionEvent) => void) => { transient.add(listener); return { ready: Promise.resolve({ subscriptionId: 'qa-live' }), unsubscribe: async () => { transient.delete(listener); } }; },
    createConversation: async (payload: Partial<Conversation>) => { const conversation = { ...legacy, ...payload, id: ('qa-team-' + teamConversations.length) as Conversation['id'], taskId: 'legacy-task' as Conversation['taskId'], collaborationKind: undefined }; teamConversations.push(conversation); notify(); return { conversation }; },
    createTeam: async (payload: Partial<Team>) => { const team = { ...teams[0], ...payload, id: ('qa-team-' + teams.length) as Team['id'] }; teams = [...teams, team]; notify(); return { team }; },
    updateTeam: async (payload: Partial<Team> & { teamId: string }) => { teams = teams.map(team => team.id === payload.teamId ? { ...team, ...payload } : team); notify(); return { team: teams.find(team => team.id === payload.teamId) }; },
    onEvent: (fn: (event: unknown) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    openTask: async ({ taskId }: { taskId: string }) => ({ task: { threadId: taskId === 'legacy-task' ? 'legacy-thread' : threadFor(taskId.replace('qa-task:', '')) } }),
    listConversationMessages: async ({ conversationId }: { conversationId: string }) => ({ messages: messagePages.get(conversationId) ?? [], hasMore: false }),
    appendMessage: async ({ threadId }: { threadId: string }) => { const messages = [...messagePages].find(([id]) => threadFor(id) === threadId)?.[1] ?? []; return { messageId: messages.at(-1)?.id, taskVersion: messages.length }; },
    getConversationRunProcess: async ({ runId }: { runId: string }) => ({ process: { runId, steps: [], fileChanges: [], running: false, doneCount: 0, errorCount: 0 } }),
    sendConversationMessage: async ({ text, conversationId }: { text: string; conversationId: string }) => {
      const legacyMessages = messagePages.get(conversationId) ?? [];
      messagePages.set(conversationId, legacyMessages);
      const threadId = threadFor(conversationId);
      legacyMessages.push({ id: 'legacy-user-' + legacyMessages.length, role: 'user', sequence: legacyMessages.length + 1, threadId, createdAt: date, blocks: [{ type: 'text', text }] });
      const runId = conversationId + ':run:' + legacyMessages.length;
      const emitFrame = (fields: Record<string, unknown>) => transient.forEach(listener => listener({ type: 'frame', frame: { threadId, runId, streamSequence: ++streamSequence, occurredAt: new Date().toISOString(), ...fields } } as ConversationTransientSubscriptionEvent));
      const schedule = (fn: () => void, ms: number) => { const timer = setTimeout(() => { fn(); timers.delete(timer); }, ms); timers.add(timer); };
      schedule(() => emitFrame({ kind: 'reasoning', textDelta: '核对当前任务与工具输入。' }), 150);
      schedule(() => emitFrame({ kind: 'text', provisional: true, textDelta: '统一聊天已收到消息，正在逐步输出回复。' }), 8000);
      schedule(() => { const text = '统一聊天已收到消息，正在逐步输出回复。'; legacyMessages.push(Object.assign({ id: runId, role: 'assistant', sequence: legacyMessages.length + 1, threadId, createdAt: date, blocks: [{ type: 'text', text }] }, { runId })); emitFrame({ kind: 'terminal', terminalState: 'completed', assistantTimeline: [{ id: 'final', sequence: 1, kind: 'text', phase: 'final_answer', text, status: 'completed' }] }); }, 11000);
      return { threadId, taskVersion: legacyMessages.length };
    },
    createGlobalAgent: async (payload: Partial<GlobalAgent>) => { const agent = { ...initialAgents()[0], ...payload, id: `created-agent-${agents.length}` as GlobalAgent['id'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; agents = [...agents, agent]; notify(); return { agent }; },
    listGlobalAgentWorkspaceActivations: async () => ({ activations: [] }),
    updateGlobalAgent: async (payload: { agentId: string } & Partial<GlobalAgent>) => { agents = agents.map(a => a.id === payload.agentId ? { ...a, ...payload, updatedAt: new Date().toISOString() } : a); persistAvatars(); notify(); return { agent: agents.find(a => a.id === payload.agentId) }; },
    collaboration: async (request: CollaborationCommand) => {
      if (request.action === 'create') {
        const team = teams.find(t => t.id === request.teamId);
        const selected = (team?.members.map(m => m.agentId) ?? request.agentIds).flatMap(id => agents.find(a => a.id === id) ?? []);
        const s = makeSnapshot(`created-${request.clientRequestId}`, selected, request.kind === 'direct' ? 'direct' : 'group', request.title);
        if (team) { teamTargets.set(s.conversation.id, team.id); s.conversation.coordinatorMemberId = team.coordinatorAgentId ?? selected[0]?.id; }
        snapshots.set(s.conversation.id, s); notify(); return { snapshot: s };
      }
      const snapshot = snapshots.get('conversationId' in request ? request.conversationId : '')!;
      if (!snapshot) throw new Error('QA 会话不存在');
      if (request.action === 'promote-direct') {
        const conversation = { ...conversationOf(snapshot), collaborationKind: undefined, taskId: 'qa-task:' + snapshot.conversation.id } as Conversation;
        if (!messagePages.has(conversation.id)) messagePages.set(conversation.id, snapshot.messages.map(message => ({
          id: message.id, role: message.senderMemberId === 'user' ? 'user' : 'assistant', sequence: message.sequence,
          threadId: threadFor(conversation.id), createdAt: message.createdAt,
          blocks: message.blocks.filter(block => block.type === 'text').map(block => ({ type: 'text', text: block.text ?? '' })),
        })));
        promoted.set(conversation.id, conversation); notify();
        return { promotedConversation: conversation, snapshot };
      }
      if (request.action === 'send') {
        snapshot.messages = [...snapshot.messages, { ...message(snapshot, 'user', request.text), recipientMemberIds: request.recipientMemberIds ?? [] }];
        const member = snapshot.members.find(m => m.id === request.recipientMemberIds?.[0]) ?? snapshot.members.find(m => m.id === snapshot.conversation.coordinatorMemberId) ?? snapshot.members.find(m => m.kind === 'agent')!;
        const taskId = `task-${snapshot.messages.length}`;
        snapshot.tasks = [...snapshot.tasks, { id: taskId, rootTaskId: taskId, originMessageId: snapshot.messages.at(-1)!.id, assigneeMemberId: member.id, title: '整理回复', instructions: request.text, expectedOutput: '', dependsOnTaskIds: [], contextRefs: [], resourceClaims: [], returnTo: { conversationId: snapshot.conversation.id, replyToMessageId: snapshot.messages.at(-1)!.id }, timeoutSeconds: 7200, currentAttemptId: taskId, kind: 'task', createdAt: date }];
        snapshot.attempts = [...snapshot.attempts, { id: taskId, taskId, number: 1, status: 'running', updatedAt: date, contextSequence: 0, output: '', resourceClaims: [], tools: [], checklist: [] }];
        emit(snapshot);
        const text = '我会先把目标拆成可以验证的小步骤，并在执行过程中保留上下文。\n\n这是离线 UI 验收数据，用来检查思考状态、增量回复和滚动行为；正式桌面由真实协作服务返回内容。';
        const workTimer = setTimeout(() => { snapshot.attempts = snapshot.attempts.map(a => a.id === taskId ? { ...a, phase: 'working', commentary: '我先核对你提供的设定，再一起讨论。', tools: [{ id: taskId + '-read', name: 'read_file', arguments: '', status: 'running' }] } : a); emit(snapshot); timers.delete(workTimer); }, 1800);
        const streamTimer = setTimeout(() => { snapshot.attempts = snapshot.attempts.map(a => a.id === taskId ? { ...a, phase: 'answering', output: text.slice(0, 34), tools: a.tools.map(tool => ({ ...tool, status: 'succeeded' })) } : a); emit(snapshot); timers.delete(streamTimer); }, 4200);
        const doneTimer = setTimeout(() => { snapshot.messages = [...snapshot.messages, message(snapshot, member.id, text)]; snapshot.attempts = snapshot.attempts.map(a => a.id === taskId ? { ...a, status: 'succeeded', output: text } : a); emit(snapshot); timers.delete(doneTimer); }, 6400);
        timers.add(workTimer); timers.add(streamTimer); timers.add(doneTimer);
      }
      return { snapshot: { ...snapshot } };
    },
  };
  return { runtime, agents: () => agents, teams: () => teams, conversations: () => [legacy, ...teamConversations, ...[...snapshots.values()].map(s => promoted.get(s.conversation.id) ?? (teamTargets.has(s.conversation.id) ? { ...conversationOf(s), track: 'team' as const, targetRef: teamTargets.get(s.conversation.id)! } : conversationOf(s)))], subscribe: (fn: () => void) => { notify = fn; }, cleanup: () => timers.forEach(clearTimeout), snapshots };
}

export default function AgentWorkspaceFixture() {
  const [store] = useState(() => {
    const value = fixtureStore();
    Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: value.runtime } });
    return value;
  });
  const [, refresh] = useState(0);
  useEffect(() => { store.subscribe(() => refresh(v => v + 1)); return () => store.cleanup(); }, [store]);
  const workspaces = [{ workspaceId: 'fixture-workspace', name: '产品设计', createdAt: date, updatedAt: date }, { workspaceId: '__projectless__', name: '不绑定工作区', createdAt: date, updatedAt: date }] as WorkspaceSummary[];
  const [workspaceId, setWorkspaceId] = useState('fixture-workspace');
  const [notice, setNotice] = useState('');
  return <DialogProvider><div data-testid="agent-workspace-fixture" data-phase3-ready="true" style={{ width: '100%', height: '100dvh', display: 'flex' }}>
    <AgentWorkspace key={workspaceId} workspaceId={workspaceId} workspaces={workspaces} agents={store.agents()} teams={store.teams()} models={fixtureModels} renderLegacyConversation={(conversation, onEditAgent, agents) => <LegacyChat agentWorkspace onEditAgent={onEditAgent} conversation={conversation} agents={agents} teams={store.teams()} models={fixtureModels} workspaces={[{ ...workspaces[0], folderPath: 'D:/fixture' }]} modelName="离线验收模型" eventHistory={fixtureEvents} onTitleUpdated={() => refresh(v => v + 1)} />} conversations={store.conversations()} onExit={() => setNotice('工作区切换已触发；此页只运行离线智能体 UI。')} onSelectWorkspace={setWorkspaceId} onRefresh={() => refresh(v => v + 1)} onSettings={() => setNotice('设置入口已触发；正式桌面连接完整设置。')} onManageAgents={() => setNotice('管理入口已触发；正式桌面连接智能体库。')} onTogglePin={(id, pinned) => { const s = store.snapshots.get(id); if (s) setNotice(pinned ? '置顶操作已触发' : '取消置顶操作已触发'); }} onRename={() => setNotice('重命名入口已触发')} onArchive={() => setNotice('归档入口已触发')} onUnarchive={() => setNotice('移出归档入口已触发')} />
    {notice && <div role="status" style={{ position: 'fixed', left: '50%', bottom: 20, padding: 12, background: 'var(--color-panel)', border: '1px solid var(--color-border)', borderRadius: 12, zIndex: 130 }} onClick={() => setNotice('')}>{notice}</div>}
  </div></DialogProvider>;
}
