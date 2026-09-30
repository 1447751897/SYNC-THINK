import { AgentExecutionStatus } from './AgentExecutionStatus.js';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';
import { CopyTextButton } from './CopyTextButton.js';
import { useKeepAliveActive } from './KeepAliveLayer.js';
import { AvatarTravel, captureAvatarTravel, type AvatarFlight } from './agent-avatar-travel.js';
import { ArrowLeft, ArrowUp, AtSign, Check, ChevronRight, ListChecks, MoreHorizontal, PanelLeft, Plus, RotateCcw, Square, ThumbsDown, ThumbsUp, Users, X } from 'lucide-react';
import type { CollaborationAttempt, CollaborationAttemptStatus, CollaborationCommand, CollaborationMember, CollaborationSnapshot, CollaborationTask, Conversation, GlobalAgent } from '@sync-think/shared';
import { AgentAvatarView } from './AgentAvatarView.js';
import { MarkdownContent } from './MarkdownContent.js';
import { ComposerEditor, type ComposerEditorHandle } from './ComposerEditor.js';
import { agentMentionToken, detectAgentMentionQuery, serializeAgentMentions } from './collaboration-mentions.js';
import { CollaborationMessageText } from './CollaborationMessageText.js';
import { useCollaborationChat } from './use-collaboration-chat.js';
import { AvatarCluster } from './collaboration-identity.js';
import { AgentEditorPanel, announceReply } from './collaboration-agent-editor.js';
import './collaboration-chat.css';

import type { Team } from '@sync-think/shared';
import { CollaborationApprovals } from './CollaborationApprovals.js';
import { useVisibleResults } from './use-visible-results.js';

const CollaborationTaskTrace = lazy(() => import('./CollaborationTaskTrace.js'));
const CollaborationArtifacts = lazy(() => import('./CollaborationTaskTrace.js').then(module => ({ default: module.CollaborationArtifacts })));

export const COLLABORATION_STATUS: Record<CollaborationAttemptStatus, string> = {
  queued: '排队中', running: '执行中', waiting_input: '等待处理', stopping: '停止中',
  succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '执行中断',
};
const ACTIVE = new Set<CollaborationAttemptStatus>(['queued', 'running', 'waiting_input', 'stopping']);
const WAIT_REASON: Record<string, string> = { dependency: '等待前置任务', dependency_failed: '前置任务未完成', resource_busy: '等待工作区资源', capacity: '等待执行名额', member_removed: '执行成员已移除', loop_limit: '已达到协作轮数上限' };
import type { ModelOption } from './NewConversationDialog.js';
type Props = { projectFolder?: string; conversation: Conversation; agents: readonly GlobalAgent[]; teams?: readonly Team[]; active?: boolean; onOpenConversation(id: string): void; onAgentsChanged?(agent?: GlobalAgent): void; models?: readonly ModelOption[]; onEditAgent?(id: string): void; workspace?: boolean; onOpenSidebar?(): void; onNewChat?(): void; onSnapshot?(snapshot: CollaborationSnapshot): void; onResultsViewed?(runIds: readonly string[]): void };

function textOf(message: CollaborationSnapshot['messages'][number]) {
  return message.blocks.filter((block) => block.type === 'text' || block.type === 'error').map((block) => block.text ?? '').join('\n');
}

type Feedback = 'up' | 'down';
const FEEDBACK_KEY = 'sync-think.collab-feedback';
function readFeedback(): Record<string, Feedback> {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) ?? '{}') as Record<string, Feedback>; } catch { return {}; }
}
/** Local-only reply rating; kept on this device and never sent to agents. */
function useFeedback() {
  const [value, setValue] = useState(readFeedback);
  const toggle = (id: string, next: Feedback) => setValue((current) => {
    const updated = { ...current };
    if (updated[id] === next) delete updated[id]; else updated[id] = next;
    try { localStorage.setItem(FEEDBACK_KEY, JSON.stringify(updated)); } catch { /* storage full or blocked */ }
    return updated;
  });
  return [value, toggle] as const;
}

type ComposerDraft = { text: string; recipients: string[]; replyTo?: string; receipt?: { key: string; id: string } };
function readComposerDraft(key: string): ComposerDraft {
  const empty = { text: '', recipients: [] };
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return empty;
    let value: Partial<ComposerDraft>;
    try { value = JSON.parse(raw) as Partial<ComposerDraft>; } catch { return { ...empty, text: raw }; }
    if (!value || typeof value !== 'object') return empty;
    return { text: typeof value.text === 'string' ? value.text : '', recipients: Array.isArray(value.recipients) ? value.recipients.filter((id): id is string => typeof id === 'string') : [], replyTo: typeof value.replyTo === 'string' ? value.replyTo : undefined, receipt: typeof value.receipt?.key === 'string' && typeof value.receipt.id === 'string' ? value.receipt : undefined };
  } catch { return empty; }
}

export function CollaborationChatView({ projectFolder, conversation, agents, teams = [], active = true, onOpenConversation, onAgentsChanged, models, onEditAgent, workspace = false, onOpenSidebar, onNewChat, onSnapshot, onResultsViewed }: Props) {
  const layerActive = useKeepAliveActive();
  const { snapshot, error, command } = useCollaborationChat(String(conversation.id), active && layerActive);
  const draftKey = `sync-think.collaboration-draft.v1:${conversation.id}`;
  const [savedDraft] = useState(() => readComposerDraft(draftKey));
  const [draft, setDraft] = useState(savedDraft.text);
  const Avatar = workspace ? AgentWorkspaceAvatar : AgentAvatarView;
  const snapshotCallback = useRef(onSnapshot);
  snapshotCallback.current = onSnapshot;
  useEffect(() => { if (snapshot) snapshotCallback.current?.(snapshot); }, [snapshot]);
  const emptyCluster = useRef<HTMLDivElement>(null);
  const headerCluster = useRef<HTMLButtonElement>(null);
  const [flights, setFlights] = useState<AvatarFlight[]>([]);
  const outbound = useMemo(() => serializeAgentMentions(draft), [draft]);
  const recipients = outbound.recipientMemberIds;
  const [mention, setMention] = useState<ReturnType<typeof detectAgentMentionQuery>>(null);
  const mentionListId = useId();
  const [mentionIndex, setMentionIndex] = useState(0);
  const [replyTo, setReplyTo] = useState<string | undefined>(savedDraft.replyTo);
  const [panel, setPanel] = useState<'tasks' | 'members' | 'agent' | null>(null);
  const [editing, setEditing] = useState<string>();
  const editMember = (id: string) => { const member = snapshot?.members.find(item => item.id === id); if (workspace && onEditAgent && member?.agentId) { setPanel(null); onEditAgent(member.agentId); } else { setEditing(id); setPanel('agent'); } };
  const [selectedTask, setSelectedTask] = useState<string>();
  const [taskDialog, setTaskDialog] = useState(false);
  const [sending, setSending] = useState(false);
  const [operation, setOperation] = useState<string>();
  const sendRequest = useRef<{ key: string; id: string } | undefined>(savedDraft.receipt);
  useEffect(() => {
    try {
      if (draft || recipients.length || replyTo || sendRequest.current) sessionStorage.setItem(draftKey, JSON.stringify({ text: draft, recipients, replyTo, receipt: sendRequest.current } satisfies ComposerDraft));
      else sessionStorage.removeItem(draftKey);
    } catch { /* storage unavailable; in-memory state remains authoritative */ }
  }, [draft, recipients, replyTo, sending, draftKey]);
  useEffect(() => {
    const receipt = sendRequest.current;
    if (receipt && snapshot?.receipts['send:' + receipt.id]
      && receipt.key === JSON.stringify([draft, recipients, replyTo])) {
      setDraft(''); setReplyTo(undefined); sendRequest.current = undefined;
    }
  }, [snapshot?.receipts, draft, recipients, replyTo]);
  const retryRequests = useRef(new Map<string, string>());
  const messageRetryRequests = useRef(new Map<string, string>());
  const busySend = useRef(false);
  const input = useRef<ComposerEditorHandle>(null);
  const pendingCaret = useRef<number>();
  useEffect(() => {
    if (pendingCaret.current === undefined) return;
    input.current?.focus();
    input.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = undefined;
  }, [draft]);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const members = useMemo(() => (snapshot?.members ?? []).map(member => { const agent = member.kind === 'team' ? undefined : agents.find(a => a.id === member.agentId); return agent ? { ...member, name: agent.name, avatar: agent.avatar } : member; }), [snapshot?.members, agents]);
  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const currentAttempts = useMemo(() => new Map(snapshot?.attempts.map((attempt) => [attempt.id, attempt]) ?? []), [snapshot?.attempts]);
  const tasks = snapshot?.tasks ?? [];
  const activity = tasks.filter((task) => ACTIVE.has(currentAttempts.get(task.currentAttemptId)?.status ?? 'succeeded'));
  const failures = tasks.filter((task) => ['failed', 'interrupted'].includes(currentAttempts.get(task.currentAttemptId)?.status ?? ''));
  const chosenTask = tasks.find((task) => task.id === selectedTask);
  const agentMembers = members.filter((member) => member.active && member.kind !== 'user' && !member.teamParticipantId);
  const mentionOptions = mention ? agentMembers.filter(member => member.active && member.kind !== 'user' && member.name.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase())) : [];
  const highlightedMention = Math.min(mentionIndex, Math.max(0, mentionOptions.length - 1));
  const chooseMention = (member: CollaborationMember) => {
    if (!mention) return;
    const token = agentMentionToken(member.id, member.name);
    const suffix = draft.slice(mention.caret);
    const spacing = suffix ? '' : ' ';
    pendingCaret.current = mention.atIndex + token.length + spacing.length;
    setMention(null); setMentionIndex(0);
    setDraft(draft.slice(0, mention.atIndex) + token + spacing + suffix);
  };
  const openMentionPicker = () => {
    const caret = input.current?.getSelection().start ?? draft.length;
    setMention({ atIndex: caret, caret, query: '' }); setMentionIndex(0);
    input.current?.focus();
  };
  // Migrate old detached recipients once, after member identities arrive.
  const migratedRecipients = useRef(false);
  useEffect(() => {
    if (!snapshot || migratedRecipients.current) return;
    migratedRecipients.current = true;
    if (savedDraft.receipt && snapshot.receipts['send:' + savedDraft.receipt.id]
      && savedDraft.receipt.key === JSON.stringify([savedDraft.text, savedDraft.recipients, savedDraft.replyTo])) {
      setDraft(''); sendRequest.current = undefined; return;
    }
    if (!savedDraft.recipients.length) return;
    setDraft(current => {
      const existing = serializeAgentMentions(current).recipientMemberIds;
      const prefix = savedDraft.recipients.filter(id => !existing.includes(id)).flatMap(id => {
        const member = membersById.get(id);
        return member ? [agentMentionToken(id, member.name)] : [];
      }).join(' ');
      return prefix ? `${prefix} ${current}` : current;
    });
  }, [snapshot, savedDraft, membersById]);
  const [feedback, toggleFeedback] = useFeedback();
  // Faces fly in once, when the first message turns an empty room into a conversation.
  const [arriving, setArriving] = useState(false);
  const hadMessages = useRef<boolean>();
  const messageCount = snapshot?.messages.length;
  // Only messages that arrive while the view is open get the entrance motion.
  const initialMessages = useRef<Set<string>>();
  if (snapshot && !initialMessages.current) initialMessages.current = new Set(snapshot.messages.map((message) => message.id));
  const announced = useRef(new Set<string>());
  useEffect(() => {
    for (const message of snapshot?.messages ?? []) {
      if (initialMessages.current?.has(message.id) || announced.current.has(message.id)) continue;
      announced.current.add(message.id);
      const sender = membersById.get(message.senderMemberId);
      if (sender && sender.kind === 'agent' && message.kind !== 'system') announceReply(sender, textOf(message));
    }
  }, [snapshot?.messages, membersById]);
  useEffect(() => {
    if (messageCount === undefined) return;
    if (hadMessages.current === false && messageCount > 0) setArriving(true);
    hadMessages.current = messageCount > 0;
  }, [messageCount]);
  const run = async (request: CollaborationCommand, key: string) => {
    setOperation(key);
    try { return await command(request); } catch { return undefined; } finally { setOperation(undefined); }
  };
  useEffect(() => {
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [snapshot?.revision]);

  useVisibleResults({ viewport, active: active && layerActive, ready: Boolean(snapshot),
    runIds: snapshot?.attempts.filter(attempt => !ACTIVE.has(attempt.status) && attempt.runId).map(attempt => String(attempt.runId)) ?? [], onViewed: onResultsViewed });

  const send = async () => {
    if (!draft.trim() || busySend.current) return;
    if (!snapshot) return;
    const travel = workspace && snapshot.messages.length === 0 ? captureAvatarTravel(emptyCluster.current, headerCluster.current, agentMembers) : [];
    const { text, mentions } = outbound;
    const key = JSON.stringify([draft, recipients, replyTo]);
    if (sendRequest.current?.key !== key) sendRequest.current = { key, id: crypto.randomUUID() };
    busySend.current = true;
    setSending(true);
    try {
      await command({ action: 'send', conversationId: String(conversation.id), clientRequestId: sendRequest.current.id, text, mentions, recipientMemberIds: recipients, replyToMessageId: replyTo });
      if (travel.length) setFlights(travel);
      setDraft((current) => current === draft ? '' : current);
      setReplyTo(undefined); sendRequest.current = undefined;
      follow.current = true;
      input.current?.focus();
    } catch { /* Keep the draft and request id so a transport retry is idempotent. */ }
    finally { busySend.current = false; setSending(false); }
  };
  const retry = (task: CollaborationTask) => {
    const id = retryRequests.current.get(task.id) ?? crypto.randomUUID();
    retryRequests.current.set(task.id, id);
    void run({ action: 'retry', conversationId: String(conversation.id), taskId: task.id, clientRequestId: id }, task.id).then((result) => { if (result) retryRequests.current.delete(task.id); });
  };
  const retryMessage = (messageId: string) => {
    const id = messageRetryRequests.current.get(messageId) ?? crypto.randomUUID();
    messageRetryRequests.current.set(messageId, id);
    void run({ action: 'retry-message', conversationId: String(conversation.id), messageId, clientRequestId: id }, `message:${messageId}`)
      .then((result) => { if (result) messageRetryRequests.current.delete(messageId); });
  };
  const openDirect = async (member: CollaborationMember) => {
    const user = members.find((item) => item.kind === 'user');
    if (!user) return;
    const result = await run({ action: 'direct', conversationId: String(conversation.id), clientRequestId: crypto.randomUUID(), memberIds: [user.id, member.id] }, member.id);
    if (result?.snapshot) onOpenConversation(result.snapshot.conversation.id);
  };


  return <div className="collab-chat" data-testid="collaboration-chat">
    <div className="collab-chat__main">
      {workspace ? <header className="collab-chat__header">
        <button className="aw-mobile-toggle aw-icon" aria-label="打开会话列表" onClick={onOpenSidebar}><PanelLeft size={18} /></button>
        <button ref={headerCluster} className="collab-chat__heading" aria-label={`成员 ${members.filter(member => member.active).length || ''}`} onClick={() => { if (snapshot?.conversation.kind === 'direct' && agentMembers[0]) editMember(agentMembers[0].id); else setPanel(value => value === 'members' ? null : 'members'); }}>
          {agentMembers.length > 1 ? <AvatarCluster members={agentMembers} size={16} max={3} /> : agentMembers[0] ? <Avatar name={agentMembers[0].name} avatar={agentMembers[0].avatar} size={22} /> : <Users size={16} />}
          <span>{conversation.title || snapshot?.conversation.title}</span><small className="collab-chat__subtitle">协调员：{snapshot?.members.find(member => member.id === snapshot.conversation.coordinatorMemberId)?.name ?? '加载中'}</small>
        </button>
        <span className="collab-chat__header-spacer" />
        <Menu.Root><Menu.Trigger asChild><button className="aw-icon" aria-label="会话选项"><MoreHorizontal size={18} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="aw-menu" align="end" sideOffset={6}>
          <Menu.Label className="aw-menu-label">本次对话</Menu.Label>
          {agentMembers.map(member => <Menu.Item key={member.id} onSelect={() => editMember(member.id)}><Avatar name={member.name} avatar={member.avatar} size={20} />{member.name}</Menu.Item>)}
          <Menu.Separator />
          <Menu.Item onSelect={() => setPanel('members')}><Users size={15} />管理会话成员</Menu.Item>
          <Menu.Item onSelect={() => { setSelectedTask(undefined); setPanel('tasks'); }}><ListChecks size={15} />任务与执行历史{tasks.length ? ` · ${tasks.length}` : ''}</Menu.Item>
          <Menu.Item disabled={!snapshot} onSelect={() => setTaskDialog(true)}><Plus size={15} />创建任务</Menu.Item>
          {onNewChat && <Menu.Item onSelect={onNewChat}>开始新的聊天</Menu.Item>}
        </Menu.Content></Menu.Portal></Menu.Root>
      </header> : <>
      <header className="collab-chat__header">
        {snapshot?.conversation.kind === 'group' && agentMembers.length > 0 && <AvatarCluster members={agentMembers} size={22} arriving={arriving} animate={activity.length > 0} />}
        <div className="collab-chat__title"><strong>{conversation.title || snapshot?.conversation.title}</strong><span className="collab-chat__subtitle">{snapshot?.conversation.kind === 'model' ? '模型对话 · 子智能体协作' : snapshot?.conversation.kind === 'direct' ? '智能体单聊' : '智能体群聊'}</span></div>
        <button className="collab-pill" onClick={() => setPanel((value) => value === 'members' ? null : 'members')} aria-pressed={panel === 'members'}><Users size={15} />成员 {members.filter((member) => member.active && !member.teamParticipantId).length || ''}</button>
      </header>
      </>}
      {(!workspace || activity.length > 0 || failures.length > 0 || snapshot?.conversation.parentConversationId) && <div className="collab-chat__summary">
        {(!workspace || activity.length > 0 || failures.length > 0) && <button className="collab-pill" onClick={() => { setPanel('tasks'); setSelectedTask(undefined); }}><ListChecks size={14} />{activity.length ? `活动任务 ${activity.length}` : tasks.length ? '执行已结束' : '当前无任务'}{failures.length ? ` · 失败 ${failures.length}` : ''}<ChevronRight size={13} /></button>}
        {snapshot?.conversation.parentConversationId && <button className="collab-pill" onClick={() => onOpenConversation(snapshot.conversation.parentConversationId!)}><ArrowLeft size={13} />返回关联会话</button>}
      </div>}
      {error && <div className="collab-notice" role="alert">{error}<button className="collab-pill" onClick={() => void run({ action: 'get', conversationId: String(conversation.id) }, 'refresh')}>重新连接</button></div>}
      <CollaborationApprovals snapshot={snapshot} active={active && layerActive} />
      <div className="collab-chat__messages" ref={viewport} onScroll={() => { const el = viewport.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70; }}>
        {!snapshot ? <p className="collab-empty" role="status">正在加载会话…</p> : snapshot.messages.length === 0 ? snapshot.conversation.kind === 'group' && agentMembers.length > 0 ? <div ref={emptyCluster} className="collab-empty collab-empty--group" data-testid="collaboration-group-empty"><AvatarCluster members={agentMembers} size={workspace ? 64 : 48} max={3} animate /><strong>几个头脑，一场对话</strong><p>{agentMembers.map((member) => member.name).join('、')} 都在这里。发一条消息，协调员会先接手；@ 成员可以直接点名。</p></div> : <div className="collab-empty">{workspace && agentMembers[0] && <Avatar name={agentMembers[0].name} avatar={agentMembers[0].avatar} size={84} animate />}<strong>{workspace && agentMembers[0] ? `和${agentMembers[0].name}聊聊` : '从一条消息开始协作'}</strong><p>{snapshot.conversation.kind === 'model' ? '与模型对话，或点击「调用智能体」分配独立任务。' : snapshot.conversation.kind === 'group' ? '直接发消息由协调员处理；@ 成员可指定接收者，也可以创建并行任务。' : '消息与任务都保留在这里。任务执行时仍可继续聊天。'}</p></div> : null}
        {workspace && snapshot?.messages.length ? <div className="collab-chat__date">{new Date(snapshot.messages[0].createdAt).toLocaleDateString([], { month: 'long', day: 'numeric' })}</div> : null}
        {snapshot?.messages.map((message) => {
          const sender = membersById.get(message.senderMemberId);
          const messageTask = tasks.find(task => task.id === message.taskId);
          // New workflow assignments/results belong in task details, not the public conversation.
          if (snapshot.conversation.kind !== 'model' && (message.kind === 'system' || (messageTask?.deliverable && (message.kind === 'task_assignment' || message.kind === 'task_result')))) return null;
          const workflowNodes = tasks.filter(task => task.kind === 'task' && task.returnTo.replyToMessageId === message.id);
          const associated = workflowNodes.length ? workflowNodes : tasks.filter(task => task.originMessageId === message.id);
          const finalArtifacts = messageTask?.kind === 'summary' ? tasks.filter(task => task.rootTaskId === messageTask.rootTaskId && task.kind === 'task' && !tasks.some(other => other.dependsOnTaskIds.includes(task.id)))
            .flatMap(task => { const a = currentAttempts.get(task.currentAttemptId); return a?.status === 'succeeded' ? a.artifacts ?? [] : []; }) : [];
          const deliveries = snapshot.deliveries.filter((delivery) => delivery.messageId === message.id);
          const quoted = message.replyToMessageId ? snapshot.messages.find((item) => item.id === message.replyToMessageId) : undefined;
          const text = textOf(message);
          return <article key={message.id} className={`collab-message ${sender?.kind === 'user' ? 'is-user' : ''} ${message.kind === 'system' ? 'is-system' : ''} ${initialMessages.current?.has(message.id) ? '' : 'is-new'}`} data-message-id={message.id}>
            <div className="collab-message__identity">{sender?.kind === 'agent' ? <button type="button" className="collab-message__who" aria-label={`编辑${sender.name}`} onClick={() => editMember(sender.id)}><Avatar name={sender.name} avatar={sender.avatar} size={workspace ? 20 : 26} /><strong>{sender.name}</strong></button> : <><Avatar name={sender?.name ?? '系统'} avatar={sender?.avatar} size={workspace ? 20 : 26} /><strong>{sender?.name ?? '系统'}</strong></>}<span>{sender?.role}</span>{message.kind === 'task_result' && <span className="collab-tag">任务结果</span>}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
            {quoted && <button className="collab-message__quote" onClick={() => viewport.current?.querySelector(`[data-message-id="${CSS.escape(quoted.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>回复：{textOf(quoted).slice(0, 100)}</button>}
            {message.contextRefs?.map((reference) => <button className="collab-message__quote" key={`${reference.conversationId}:${reference.messageId}`} onClick={() => onOpenConversation(reference.conversationId)}>查看关联群聊消息</button>)}
            {(text || message.mentions.length > 0) && <div className="collab-message__body"><CollaborationMessageText text={text} mentions={message.mentions} members={membersById} projectFolder={projectFolder} conversationId={String(conversation.id)} /></div>}
            {finalArtifacts.length > 0 && <Suspense fallback={<p className="collab-muted">读取产物…</p>}><CollaborationArtifacts artifacts={finalArtifacts} projectFolder={projectFolder} /></Suspense>}
            {workspace ? associated.length > 0 && <button className="aw-task-link" onClick={() => { setSelectedTask(associated.length === 1 ? associated[0].id : undefined); setPanel('tasks'); }}><ListChecks size={13} />{associated.length} 项协作任务<ChevronRight size={13} /></button> : associated.map((task) => <TaskCard key={task.id} task={task} attempt={currentAttempts.get(task.currentAttemptId)} member={membersById.get(task.assigneeMemberId)} onOpen={() => { setSelectedTask(task.id); setPanel('tasks'); }} />)}
            <div className={`collab-message__actions${deliveries.some(item => item.status === 'failed') ? ' has-error' : ''}`}>
              <button className="collab-link" onClick={() => { setReplyTo(message.id); input.current?.focus(); }}>回复</button>
              {message.taskId && <button className="collab-link" onClick={() => { setSelectedTask(message.taskId); setPanel('tasks'); }}>查看任务</button>}
              {deliveries.length > 0 && <span>{deliveries.some((item) => item.status === 'failed') ? '消息处理失败 · 任务中查看原因' : deliveries.every((item) => item.status === 'processed') ? '已处理' : deliveries.some((item) => item.status === 'processing') ? '处理中' : '已发送'}</span>}
              {deliveries.some((item) => item.status === 'failed') && <button className="collab-link" disabled={operation === `message:${message.id}`} onClick={() => retryMessage(message.id)}>重新投递</button>}
              {sender && sender.kind !== 'user' && message.kind !== 'system' && <span className="collab-feedback">
                {workspace && <CopyTextButton text={textOf(message)} label="复制回复" compact />}
                <button type="button" className="collab-feedback__button" aria-label="有帮助" aria-pressed={feedback[message.id] === 'up'} onClick={() => toggleFeedback(message.id, 'up')}><ThumbsUp size={13} /></button>
                <button type="button" className="collab-feedback__button" aria-label="没帮助" aria-pressed={feedback[message.id] === 'down'} onClick={() => toggleFeedback(message.id, 'down')}><ThumbsDown size={13} /></button>
              </span>}
            </div>
          </article>;
        })}
        {snapshot?.attempts.filter((attempt) => ACTIVE.has(attempt.status) && attempt.id === tasks.find((item) => item.id === attempt.taskId)?.currentAttemptId).map((attempt) => {
          const task = tasks.find((item) => item.id === attempt.taskId);
          const member = task ? membersById.get(task.assigneeMemberId) : undefined;
          const name = member?.name ?? '智能体';
          // State and commentary are not answer text. Keep progress compact and opt-in.
          if (attempt.status === 'queued') return null;
          const label = attempt.status === 'waiting_input' ? '等待你确认'
            : attempt.status === 'stopping' ? '正在停止…'
              : attempt.phase === 'working' ? '执行中…'
                : '思考中…';
          const quietChat = snapshot.conversation.kind !== 'model';
          const hasDetails = !quietChat && Boolean(attempt.commentary || attempt.tools.length);
          const showProgress = quietChat || !attempt.output || attempt.phase !== 'answering' && Boolean(attempt.phase) || attempt.status !== 'running';
          return <div key={`stream:${attempt.id}`} className="collab-live-turn">
            {showProgress && <div data-testid={`collaboration-thinking-${attempt.id}`}>
              {task?.kind === 'task' && <small className="collab-live-turn__task">{task.title}</small>}
              <AgentExecutionStatus name={name} avatar={member?.avatar} running={attempt.status === 'running' || attempt.status === 'stopping'} waiting={attempt.status === 'waiting_input'} label={workspace ? label : `${label} ${name}`} hasDetails={hasDetails}>
                    {attempt.commentary && <p>{attempt.commentary}</p>}
                    {attempt.tools.length > 0 && <ul>{attempt.tools.map(tool => <li key={tool.id}>{tool.name} · {COLLABORATION_STATUS[tool.status]}</li>)}</ul>}
                  </AgentExecutionStatus>
            </div>}
            {quietChat && task && <button type="button" className="collab-link collab-live-turn__details" onClick={() => { setSelectedTask(task.id); setPanel('tasks'); }}>任务详情 <ChevronRight size={13} /></button>}
            {!quietChat && attempt.output && <article className="collab-message is-streaming" data-testid={`collaboration-stream-${attempt.id}`}><div className="collab-message__identity"><Avatar name={name} avatar={member?.avatar} size={workspace ? 20 : 26} state="working" /><strong>{name}</strong>{task?.kind === 'task' && <span>{task.title}</span>}</div><div className="collab-message__body"><MarkdownContent text={attempt.output} streaming projectFolder={projectFolder} conversationId={String(conversation.id)} /></div></article>}
          </div>;
        })}
      </div>
      <form className="collab-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        {replyTo && <div className="collab-composer__reference">回复：{snapshot?.messages.find((item) => item.id === replyTo)?.blocks[0]?.text?.slice(0, 80)}<button type="button" className="collab-pill" aria-label="取消回复" onClick={() => setReplyTo(undefined)}><X size={12} /></button></div>}

        {mention && <div id={mentionListId} className="collab-mention" role="listbox" aria-label="选择接收成员">{mentionOptions.map((member, index) => <button type="button" role="option" id={`${mentionListId}-${index}`} data-highlighted={index === highlightedMention ? 'true' : undefined} aria-selected={recipients.includes(member.id)} key={member.id} onMouseDown={event => event.preventDefault()} onClick={() => chooseMention(member)}><Avatar name={member.name} avatar={member.avatar} size={22} />{member.name}<span>{member.role}</span></button>)}</div>}
        <ComposerEditor ref={input} ariaLabel="协作消息" inputTestId="collaboration-draft" ariaAutocomplete="list" ariaControls={mention ? mentionListId : undefined} ariaActiveDescendant={mentionOptions.length ? `${mentionListId}-${highlightedMention}` : undefined} className="collab-composer__editor" minHeight={32} maxHeight={200} placeholder={workspace ? '你好，今天想一起做些什么？' : snapshot?.conversation.kind === 'model' ? '继续与模型对话…' : '输入消息，@ 指定成员…'} value={draft}
          onChange={(value, selection) => { setDraft(value); setMention(detectAgentMentionQuery(value, selection.start)); setMentionIndex(0); }}
          onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Escape') { setMention(null); return; } if (mention && mentionOptions.length) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setMentionIndex((highlightedMention + (event.key === 'ArrowDown' ? 1 : mentionOptions.length - 1)) % mentionOptions.length); return; } if (event.key === 'Enter') { event.preventDefault(); chooseMention(mentionOptions[highlightedMention]); return; } } if (event.key === 'Enter' && !event.shiftKey && (!mention || !mentionOptions.length)) { event.preventDefault(); void send(); } }} />
        <div className="collab-composer__toolbar">{workspace ? <Menu.Root><Menu.Trigger asChild><button type="button" className="collab-pill collab-composer__add" aria-label="添加到对话"><Plus size={20} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="aw-menu" side="top" align="start" sideOffset={10}>
          <Menu.Item onSelect={openMentionPicker}><AtSign size={16} />指定接收成员</Menu.Item>
          <Menu.Item disabled={!snapshot} onSelect={() => setTaskDialog(true)}><Plus size={16} />创建协作任务</Menu.Item>
          <Menu.Item onSelect={() => { setSelectedTask(undefined); setPanel('tasks'); }}><ListChecks size={16} />任务与执行历史</Menu.Item>
        </Menu.Content></Menu.Portal></Menu.Root> : <button type="button" className="collab-pill" disabled={!snapshot} onClick={() => setTaskDialog(true)}><Plus size={15} />{snapshot?.conversation.kind === 'model' ? '调用智能体' : '创建任务'}</button>}
        <button type="button" className="collab-pill" onClick={openMentionPicker}><AtSign size={15} />成员</button><span className="collab-composer__hint">{snapshot?.conversation.kind === 'group' && !recipients.length ? '发送给协调员' : '任务执行时可继续发送'}</span><button type="submit" className="collab-send" aria-label="发送消息" disabled={!draft.trim() || sending || !snapshot}><ArrowUp size={18} /></button></div>
      </form>
    </div>
    {panel && snapshot && <aside className={`collab-panel${panel === 'tasks' ? ' collab-panel--tasks' : ''}`} aria-label={panel === 'tasks' ? '执行详情' : panel === 'agent' ? '智能体设置' : '会话成员'}><header><strong>{panel === 'agent' ? (workspace ? membersById.get(editing ?? '')?.name ?? '智能体设置' : '智能体设置') : panel === 'members' ? '会话成员' : chosenTask ? '任务详情' : '任务执行'}</strong><button className="collab-pill" onClick={() => setPanel(null)} aria-label="关闭详情"><X size={15} /></button></header>
      {panel === 'agent' && editing && membersById.get(editing) ? <AgentEditorPanel models={models} workspace={workspace} member={membersById.get(editing)!} agent={agents.find((agent) => agent.id === membersById.get(editing)!.agentId)} onSaved={onAgentsChanged} /> : panel === 'members' ? <MembersPanel conversation={conversation} snapshot={snapshot} agents={agents} teams={teams} busy={Boolean(operation)} onCommand={(request) => void run(request, 'members')} onDirect={openDirect} onEdit={editMember} /> : chosenTask ? <TaskDetail snapshot={snapshot} projectFolder={projectFolder} onSelectTask={setSelectedTask} task={chosenTask} attempts={snapshot.attempts.filter((attempt) => attempt.taskId === chosenTask.id)} member={membersById.get(chosenTask.assigneeMemberId)} busy={operation === chosenTask.id} onBack={() => setSelectedTask(undefined)} onCancel={() => void run({ action: 'cancel', conversationId: String(conversation.id), taskId: chosenTask.id, includeChildren: true }, chosenTask.id)} onRetry={() => retry(chosenTask)} /> : <div className="collab-panel__body">{tasks.length === 0 ? <p className="collab-empty">这里会保留本会话的任务与执行历史。</p> : tasks.map((task) => <TaskCard key={task.id} task={task} attempt={currentAttempts.get(task.currentAttemptId)} member={membersById.get(task.assigneeMemberId)} onOpen={() => setSelectedTask(task.id)} />)}</div>}
    </aside>}
    {flights.length > 0 && <AvatarTravel flights={flights} onComplete={() => setFlights([])} />}
    {taskDialog && snapshot && <CreateTaskDialog snapshot={snapshot} onClose={() => setTaskDialog(false)} onCreate={async (request) => { const response = await run(request, 'dispatch'); if (response) { setTaskDialog(false); setPanel('tasks'); } }} />}
  </div>;
}

function TaskCard({ task, attempt, member, onOpen }: { task: CollaborationTask; attempt?: CollaborationAttempt; member?: CollaborationMember; onOpen(): void }) {
  return <button className="collab-task-card" onClick={onOpen}><span className="collab-task-card__title"><AgentAvatarView name={member?.name ?? '智能体'} avatar={member?.avatar} size={22} /><strong>{task.title}</strong><ChevronRight size={14} /></span><span className="collab-task-card__meta">{member?.name} · <span data-status={attempt?.status}>{attempt ? COLLABORATION_STATUS[attempt.status] : '准备中'}</span>{attempt && ` · 第 ${attempt.number} 次执行`}</span>{task.planRef && <span className="collab-task-card__meta">计划 v{task.planRef.revision}{task.planRef.stepId ? ` · ${task.planRef.stepId}` : ''}</span>}{attempt?.waitReason && <span className="collab-task-card__meta">{WAIT_REASON[attempt.waitReason]}</span>}{attempt?.observation === 'status_unconfirmed' && <span className="collab-task-card__meta">状态待确认，正在核对运行情况</span>}{attempt?.error && <span className="collab-task-card__error">{attempt.error.message}</span>}</button>;
}

function TaskDetail({ snapshot, projectFolder, onSelectTask, task, attempts, member, busy, onBack, onCancel, onRetry }: { snapshot: CollaborationSnapshot; projectFolder?: string; onSelectTask(id: string): void; task: CollaborationTask; attempts: CollaborationAttempt[]; member?: CollaborationMember; busy: boolean; onBack(): void; onCancel(): void; onRetry(): void }) {
  const [tab, setTab] = useState<'checklist' | 'result' | 'history'>('history');
  const [attemptId, setAttemptId] = useState(task.currentAttemptId);
  useEffect(() => setAttemptId(task.currentAttemptId), [task.id, task.currentAttemptId]);
  const attempt = attempts.find((item) => item.id === attemptId) ?? attempts.at(-1);
  const current = attempts.find((item) => item.id === task.currentAttemptId);
  return <div className="collab-panel__body"><button className="collab-link" onClick={onBack}><ArrowLeft size={14} />所有任务</button><h3>{task.title}</h3><p className="collab-muted">{member?.name} · {current && COLLABORATION_STATUS[current.status]}</p>{task.planRef && <p className="collab-muted">关联计划：{task.planRef.planId} v{task.planRef.revision}{task.planRef.stepId ? ` · ${task.planRef.stepId}` : ''}</p>}<details className="collab-task-instructions"><summary>任务说明与交付要求</summary><p>{task.instructions}</p>{task.expectedOutput && <p className="collab-muted">预期结果：{task.expectedOutput}</p>}</details>
    <div className="collab-toolbar">{current && ACTIVE.has(current.status) ? <button className="collab-pill" disabled={busy || current.status === 'stopping'} onClick={onCancel}><Square size={12} />{current.status === 'stopping' ? '停止中' : '停止当前任务'}</button> : <button className="collab-pill" disabled={busy || current?.status === 'succeeded'} onClick={onRetry}><RotateCcw size={13} />重新执行</button>}</div>
    {attempts.length > 1 && <label className="collab-field">执行记录<select value={attempt?.id} onChange={(event) => setAttemptId(event.target.value)}>{attempts.map((item) => <option key={item.id} value={item.id}>第 {item.number} 次 · {COLLABORATION_STATUS[item.status]}</option>)}</select></label>}
    {attempt?.error && <div className="collab-notice" role="status">{attempt.error.message}<small>{attempt.error.category} · {attempt.error.code}</small></div>}
    <div className="collab-tabs" role="tablist" aria-label="任务详情内容">{([['checklist', '清单'], ['result', '结果'], ['history', '轨迹与产物']] as const).map(([id, label]) => <button className="collab-pill" role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === 'checklist' && (attempt?.checklist.length ? <ul className="collab-checklist">{attempt.checklist.map((item) => <li key={item.id}><span>{item.status === 'completed' ? <Check size={14} /> : item.status === 'in_progress' ? '◉' : '○'}</span>{item.text}</li>)}</ul> : <p className="collab-muted">该执行尚未提交任务清单。</p>)}
    {tab === 'result' && (attempt?.output && !ACTIVE.has(attempt.status) ? <MarkdownContent text={attempt.output} streaming={false} /> : <p className="collab-muted">{current && ACTIVE.has(current.status) ? '结果将在执行后展示。' : '本次执行没有返回文本，执行记录已保留。'}</p>)}
    {tab === 'history' && <Suspense fallback={<p className="collab-muted">正在加载任务详情…</p>}><CollaborationTaskTrace snapshot={snapshot} task={task} attempt={attempt} onSelectTask={onSelectTask} projectFolder={projectFolder} /></Suspense>}
  </div>;
}

function MembersPanel({ conversation, snapshot, agents, teams, busy, onCommand: sendCommand, onDirect, onEdit }: { conversation: Conversation; snapshot: CollaborationSnapshot; agents: readonly GlobalAgent[]; teams: readonly Team[]; busy: boolean; onCommand(request: CollaborationCommand): void; onDirect(member: CollaborationMember): void; onEdit(memberId: string): void }) {
  const onCommand = (request: CollaborationCommand) => sendCommand(request.action === 'members' ? { ...request, expectedTopologyRevision: snapshot.conversation.topologyRevision ?? 0 } : request);
  const running = snapshot.tasks.some(task => snapshot.attempts.some(attempt => attempt.id === task.currentAttemptId && ACTIVE.has(attempt.status)));
  const availableTeams = teams.filter(team => !snapshot.members.some(member => member.active && member.teamSnapshot?.id === team.id));
  const [permission, setPermission] = useState(conversation.executionMode ?? 'ask');
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  useEffect(() => setPermission(conversation.executionMode ?? 'ask'), [conversation.id, conversation.executionMode]);
  const changePermission = async (executionMode: 'ask' | 'workspace' | 'full-access') => {
    const api = window.syncThink?.runtime;
    if (!api?.setConversationExecutionMode) { setPermissionError('权限服务尚未连接'); return; }
    setPermissionBusy(true); setPermissionError('');
    try { await api.setConversationExecutionMode({ conversationId: conversation.id, executionMode }); setPermission(executionMode); }
    catch (cause) { setPermissionError(String(cause)); }
    finally { setPermissionBusy(false); }
  };
  const activeMembers = snapshot.members.filter((member) => member.active && !member.teamParticipantId);
  const available = agents.filter((agent) => !agent.archived && agent.enabled !== false && !activeMembers.some((member) => member.kind === 'agent' && member.agentId === agent.id));
  return <div className="collab-panel__body"><label className="collab-field">任务文件权限<select aria-label="任务文件权限" value={permission} disabled={busy || permissionBusy} onChange={e => void changePermission(e.target.value as 'ask' | 'workspace' | 'full-access')}><option value="ask">只读工作区 · 可交付文档</option><option value="workspace">允许工作区操作</option><option value="full-access">完全访问</option></select><small>文档交付不写工作区；修改文件需执行者「继承会话权限」。设置用于后续执行。</small></label>{permissionError && <p role="alert" className="collab-notice">{permissionError}</p>}<p className="collab-muted">新增成员或小队默认参与下一轮，不改动正在执行的工作链。小队保留内部负责人和依赖；角色不授予额外工具权限。</p>{running && <p className="collab-notice">当前有任务，完成或停止后再移交协调权；移出成员前请处理其任务。</p>}{activeMembers.map((member) => <div className="collab-member" key={member.id}><div className="collab-member__identity"><AgentAvatarView name={member.name} avatar={member.avatar} size={30} /><strong>{member.name}</strong>{member.id === snapshot.conversation.coordinatorMemberId && <span className="collab-tag">协调员</span>}</div>{member.kind === 'team' && <details><summary>{member.role} · 内部工作链</summary><ol>{member.teamSnapshot?.members.map(config => <li key={config.agentId}>{agents.find(agent => agent.id === config.agentId)?.name ?? config.agentId} · {config.title || config.role}</li>)}</ol><small>加入版本：{member.teamSnapshot?.updatedAt}；小队定义更新需退出后重新添加。</small></details>}{member.kind !== 'user' && <><input aria-label={`${member.name}的角色`} defaultValue={member.role} key={`${member.id}:${member.role}`} onBlur={(event) => { if (event.target.value.trim() !== member.role) onCommand({ action: 'members', conversationId: snapshot.conversation.id, roles: { [member.id]: event.target.value.trim() } }); }} /><div className="collab-toolbar">{member.kind !== 'team' && <button className="collab-link" disabled={busy} onClick={() => onDirect(member)}>打开单聊</button>}{member.kind === 'agent' && <button className="collab-link" onClick={() => onEdit(member.id)}>编辑</button>}{snapshot.conversation.kind === 'group' && member.id !== snapshot.conversation.coordinatorMemberId && <><button className="collab-link" disabled={busy || running} onClick={() => onCommand({ action: 'members', conversationId: snapshot.conversation.id, coordinatorMemberId: member.id })}>设为协调员</button><button className="collab-link" disabled={busy} onClick={() => onCommand({ action: 'members', conversationId: snapshot.conversation.id, removeMemberIds: [member.id] })}>移出群聊</button></>}</div></>}</div>)}
    {snapshot.conversation.kind === 'group' && availableTeams.length > 0 && <label className="collab-field">添加小队<select aria-label="添加小队" value="" disabled={busy} onChange={event => { if (event.target.value) onCommand({ action: 'members', conversationId: snapshot.conversation.id, addTeamIds: [event.target.value] }); }}><option value="">选择已有小队…</option>{availableTeams.map(team => <option key={team.id} value={team.id}>{team.name} · {team.members.length} 位成员</option>)}</select></label>}
    {snapshot.conversation.kind !== 'direct' && available.length > 0 && <label className="collab-field">添加智能体<select value="" disabled={busy} onChange={(event) => { if (event.target.value) onCommand({ action: 'members', conversationId: snapshot.conversation.id, addAgentIds: [event.target.value] }); }}><option value="">选择智能体…</option>{available.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>}
    {snapshot.conversation.kind === 'group' && <label className="collab-toggle"><input type="checkbox" checked={snapshot.conversation.policy.allowPeerDirect} disabled={busy} onChange={(event) => onCommand({ action: 'policy', conversationId: snapshot.conversation.id, policy: { allowPeerDirect: event.target.checked } })} /><span>允许智能体之间发起单聊<small>默认关闭；开启后关联单聊保留在聊天列表中。</small></span></label>}
    <label className="collab-field">任务超时（秒）<input type="number" min={30} max={86400} key={snapshot.conversation.policy.taskTimeoutSeconds} defaultValue={snapshot.conversation.policy.taskTimeoutSeconds} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 30 && value <= 86400 && value !== snapshot.conversation.policy.taskTimeoutSeconds) onCommand({ action: 'policy', conversationId: snapshot.conversation.id, policy: { taskTimeoutSeconds: value } }); }} /></label>
    <label className="collab-field">状态核对间隔（秒）<input type="number" min={10} max={3600} key={snapshot.conversation.policy.statusTimeoutSeconds} defaultValue={snapshot.conversation.policy.statusTimeoutSeconds} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 10 && value <= 3600 && value !== snapshot.conversation.policy.statusTimeoutSeconds) onCommand({ action: 'policy', conversationId: snapshot.conversation.id, policy: { statusTimeoutSeconds: value } }); }} /></label>
  </div>;
}

function CreateTaskDialog({ snapshot, onClose, onCreate }: { snapshot: CollaborationSnapshot; onClose(): void; onCreate(request: CollaborationCommand): Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [expected, setExpected] = useState('');
  const [deliveryKind, setDeliveryKind] = useState<'document' | 'file'>('document');
  const [deliveryPath, setDeliveryPath] = useState('');
  const [timeout, setTimeoutSeconds] = useState(snapshot.conversation.policy.taskTimeoutSeconds);
  const [busy, setBusy] = useState(false);
  const receipt = useRef<{ key: string; id: string }>();
  return <div className="collab-modal-backdrop"><form className="collab-modal" role="dialog" aria-modal="true" aria-label="创建智能体任务" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }} onSubmit={(event) => { event.preventDefault(); if (!selected.length || busy) return; const tasks = selected.map((assigneeMemberId) => ({ assigneeMemberId, title: title.trim(), instructions: instructions.trim(), expectedOutput: expected.trim(), deliverable: { kind: deliveryKind, title: title.trim(), ...(deliveryKind === 'file' ? { path: deliveryPath.trim() } : {}) }, timeoutSeconds: timeout })); const key = JSON.stringify(tasks); if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() }; setBusy(true); void onCreate({ action: 'dispatch', conversationId: snapshot.conversation.id, clientRequestId: receipt.current.id, tasks }).finally(() => setBusy(false)); }}><header><strong>{snapshot.conversation.kind === 'model' ? '调用子智能体' : '创建任务'}</strong><button type="button" className="collab-pill" onClick={onClose} disabled={busy} aria-label="关闭任务创建"><X size={15} /></button></header><p className="collab-muted">选择多个执行者时，各自独立执行并返回结果。</p><div className="collab-member-options">{snapshot.members.filter((member) => member.active && member.kind === 'agent').map((member) => <button type="button" className={`collab-pill ${selected.includes(member.id) ? 'is-selected' : ''}`} aria-pressed={selected.includes(member.id)} key={member.id} onClick={() => setSelected((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])}><AgentAvatarView name={member.name} avatar={member.avatar} size={20} />{member.name}</button>)}</div>{!snapshot.members.some((member) => member.active && member.kind === 'agent') && <p className="collab-muted">先在「成员」中添加可用智能体。</p>}<label className="collab-field">任务标题<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="collab-field">任务说明<textarea required value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label><label className="collab-field">交付方式<select value={deliveryKind} onChange={e => setDeliveryKind(e.target.value as 'document' | 'file')}><option value="document">会话文档 · 可预览和下载</option><option value="file">工作区文件 · 检查实际写入</option></select></label>{deliveryKind === 'file' && <label className="collab-field">工作区相对路径<input required value={deliveryPath} onChange={e => setDeliveryPath(e.target.value)} placeholder="novel/chapter-01.md" /></label>}<label className="collab-field">预期结果<input value={expected} onChange={(event) => setExpected(event.target.value)} /></label><label className="collab-field">超时（秒）<input type="number" min={30} max={86400} required value={timeout} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} /></label><footer><button className="collab-pill" type="button" onClick={onClose} disabled={busy}>取消</button><button className="collab-pill is-selected" type="submit" disabled={busy || !selected.length || !title.trim() || !instructions.trim()}>{busy ? '正在创建…' : `开始执行${selected.length > 1 ? `（${selected.length} 个任务）` : ''}`}</button></footer></form></div>;
}
