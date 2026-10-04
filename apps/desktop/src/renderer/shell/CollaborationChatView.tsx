import { GroupConversationSettings } from './GroupConversationSettings.js';
import * as Dialog from '@radix-ui/react-dialog';
import { TaskSelect } from './TaskSelect.js';
import './board-composer.css';
import { TaskRoomBar } from './TaskRoomBar.js';
import { AgentExecutionStatus } from './AgentExecutionStatus.js';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { AgentWorkspaceAvatar } from './AgentWorkspaceAvatar.js';
import { CopyTextButton } from './CopyTextButton.js';
import { useKeepAliveActive } from './KeepAliveLayer.js';
import { AvatarTravel, captureAvatarTravel, type AvatarFlight } from './agent-avatar-travel.js';
import { ArrowLeft, ArrowUp, AtSign, Check, ChevronRight, ListChecks, MoreHorizontal, PanelLeft, Paperclip, Plus, RotateCcw, Square, ThumbsDown, ThumbsUp, Users, X } from 'lucide-react';
import { isCollaborationTaskBusy } from '@sync-think/shared';
import type { CollaborationAttempt, CollaborationAttemptStatus, CollaborationCommand, CollaborationMember, CollaborationSnapshot, CollaborationTask, Conversation, GlobalAgent } from '@sync-think/shared';
import { AgentAvatarView } from './AgentAvatarView.js';
import { MarkdownContent } from './MarkdownContent.js';
import { useComposerImageUploads } from './use-composer-image-uploads.js';
import { isImageFile, type ComposeAttachment } from './compose-mention.js';
import { CollaborationMessageAttachments } from './CollaborationMessageAttachments.js';
import { ComposerEditor, type ComposerEditorHandle } from './ComposerEditor.js';
import { agentMentionToken, detectAgentMentionQuery, serializeAgentMentions } from './collaboration-mentions.js';
import { CollaborationMessageText } from './CollaborationMessageText.js';
import { useCollaborationChat } from './use-collaboration-chat.js';
import { AvatarCluster } from './collaboration-identity.js';
import { AgentEditorPanel, announceReply } from './collaboration-agent-editor.js';
import './collaboration-chat.css';

import type { Team } from '@sync-think/shared';
import { GroupBrowserSettings, GroupBrowserHandoffs } from './GroupBrowserAutomation.js';
import { CollaborationApprovals } from './CollaborationApprovals.js';
import { useVisibleResults } from './use-visible-results.js';

const CollaborationTaskTrace = lazy(() => import('./CollaborationTaskTrace.js'));
const CollaborationArtifacts = lazy(() => import('./CollaborationTaskTrace.js').then(module => ({ default: module.CollaborationArtifacts })));
const CollaborationResultsPanel = lazy(() => import('./CollaborationTaskTrace.js').then(module => ({ default: module.CollaborationResultsPanel })));

export const COLLABORATION_STATUS: Record<CollaborationAttemptStatus, string> = {
  queued: '排队中', running: '执行中', waiting_input: '等待处理', stopping: '停止中',
  succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '执行中断',
};
const ACTIVE = new Set<CollaborationAttemptStatus>(['queued', 'running', 'waiting_input', 'stopping']);
const RETRYABLE = new Set<CollaborationAttemptStatus>(['failed', 'interrupted', 'cancelled']);
function retryScopeOpen(snapshot: CollaborationSnapshot, task: CollaborationTask): boolean {
  if (task.replacedByTaskId || !snapshot.members.some(member => member.id === task.assigneeMemberId && member.active)) return false;
  const room = snapshot.conversation.room;
  const work = Boolean(task.consultation?.workScoped) || task.purpose !== 'discussion' && task.kind !== 'reply';
  return !room || !work || room.state !== 'completed' && (task.goalRevision === undefined || task.goalRevision === room.goalRevision);
}
function retryPaused(snapshot: CollaborationSnapshot, task: CollaborationTask): boolean {
  const work = Boolean(task.consultation?.workScoped) || task.purpose !== 'discussion' && task.kind !== 'reply';
  return work && ['paused', 'pausing'].includes(snapshot.conversation.room?.state ?? '');
}
function canRetryTask(snapshot: CollaborationSnapshot, task: CollaborationTask, attempt?: CollaborationAttempt): boolean {
  return Boolean(attempt && attempt.id === task.currentAttemptId && RETRYABLE.has(attempt.status) && attempt.error?.retryable !== false && retryScopeOpen(snapshot, task));
}
const WAIT_REASON: Record<string, string> = { peer_reply: '等待成员回复', dependency: '等待前置交付', dependency_failed: '等待前置恢复并交付', resource_busy: '等待工作区资源', capacity: '等待执行名额', member_removed: '执行成员已移除', loop_limit: '已达到协作轮数上限', room_paused: '群聊已暂停' };
import type { ModelOption } from './NewConversationDialog.js';
type Props = { projectFolder?: string; conversation: Conversation; agents: readonly GlobalAgent[]; teams?: readonly Team[]; active?: boolean; onOpenConversation(id: string): void; onAgentsChanged?(agent?: GlobalAgent): void; models?: readonly ModelOption[]; onEditAgent?(id: string): void; workspace?: boolean; onOpenSidebar?(): void; onNewChat?(): void; onSnapshot?(snapshot: CollaborationSnapshot): void; onResultsViewed?(runIds: readonly string[]): void };

function textOf(message: CollaborationSnapshot['messages'][number]) {
  return message.blocks.filter((block) => block.type === 'text' || block.type === 'error').map((block) => block.text ?? '').join('\n');
}

// Keep production handoffs conversational; long instructions stay available on demand.
function CollaborationHandoffText({ text, children }: { text: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const long = text.length > 240;
  return <>
    <p id={contentId}>{children} {expanded || !long ? text : text.slice(0, 240) + '…'}</p>
    {long && <button type="button" className="collab-link" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>{expanded ? '收起交接说明' : '展开交接说明'}</button>}
  </>;
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

type ComposerDraft = { visibility?: 'public' | 'private'; intent?: 'chat' | 'discussion' | 'work'; text: string; recipients: string[]; attachments?: ComposeAttachment[]; replyTo?: string; receipt?: { key: string; id: string } };
function readComposerDraft(key: string): ComposerDraft {
  const empty = { text: '', recipients: [] };
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return empty;
    let value: Partial<ComposerDraft>;
    try { value = JSON.parse(raw) as Partial<ComposerDraft>; } catch { return { ...empty, text: raw }; }
    if (!value || typeof value !== 'object') return empty;
    return { visibility: value.visibility === 'private' ? 'private' : 'public', attachments: Array.isArray(value.attachments) ? value.attachments.filter(item => item && typeof item.path === 'string' && typeof item.name === 'string' && ['file', 'dir', 'image'].includes(item.kind)).slice(0, 28) : [], intent: value.intent === 'work' || value.intent === 'discussion' ? value.intent : 'chat', text: typeof value.text === 'string' ? value.text : '', recipients: Array.isArray(value.recipients) ? value.recipients.filter((id): id is string => typeof id === 'string') : [], replyTo: typeof value.replyTo === 'string' ? value.replyTo : undefined, receipt: typeof value.receipt?.key === 'string' && typeof value.receipt.id === 'string' ? value.receipt : undefined };
  } catch { return empty; }
}

export function CollaborationChatView({ projectFolder, conversation, agents, teams = [], active = true, onOpenConversation, onAgentsChanged, models, onEditAgent, workspace = false, onOpenSidebar, onNewChat, onSnapshot, onResultsViewed }: Props) {
  const layerActive = useKeepAliveActive();
  const { snapshot, error, command } = useCollaborationChat(String(conversation.id), active && layerActive);
  const draftKey = `sync-think.collaboration-draft.v1:${conversation.id}`;
  const [savedDraft] = useState(() => readComposerDraft(draftKey));
  const [draft, setDraft] = useState(savedDraft.text);
  const [attachments, setAttachments] = useState<ComposeAttachment[]>(savedDraft.attachments ?? []);
  const [attachmentNotice, setAttachmentNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const imageUploads = useComposerImageUploads({ attachments, setAttachments, scopeKey: String(conversation.id), onError: file => setAttachmentNotice('图片读取失败：' + file.name) });
  const addFiles = (files: FileList | File[]) => {
    setAttachmentNotice('');
    imageUploads.addFiles(files);
    for (const file of Array.from(files).filter(file => !isImageFile(file))) {
      if (file.size > 50 * 1024 * 1024) { setAttachmentNotice('单个文件请控制在 50 MB 内：' + file.name); continue; }
      const path = window.syncThink?.runtime?.pathForFile?.(file);
      if (!path) { setAttachmentNotice('文件路径读取失败，请重新选择：' + file.name); continue; }
      setAttachments(current => current.some(item => item.path === path) || current.filter(item => item.kind !== 'image').length >= 20 ? current
        : [...current, { path, name: file.name, kind: 'file', mimeType: file.type, sizeBytes: file.size }]);
    }
  };
  const [visibility, setVisibility] = useState<'public' | 'private'>(savedDraft.visibility ?? 'public');
  const [intent, setIntent] = useState<'chat' | 'discussion' | 'work'>(savedDraft.intent ?? 'chat');
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
  const [panel, setPanel] = useState<'tasks' | 'members' | 'agent' | 'results' | null>(null);
  const [editing, setEditing] = useState<string>();
  const editMember = (id: string) => { const member = snapshot?.members.find(item => item.id === id); if (workspace && onEditAgent && member?.agentId) { setPanel(null); onEditAgent(member.agentId); } else { setEditing(id); setPanel('agent'); } };
  const [selectedTask, setSelectedTask] = useState<string>();
  const [selectedArtifact, setSelectedArtifact] = useState<string>();
  const resultsOpened = useRef(false);
  const [taskDialog, setTaskDialog] = useState(false);
  const [sending, setSending] = useState(false);
  const [operation, setOperation] = useState<string>();
  const sendRequest = useRef<{ key: string; id: string } | undefined>(savedDraft.receipt);
  useEffect(() => {
    try {
      if (draft || attachments.length || recipients.length || replyTo || sendRequest.current) sessionStorage.setItem(draftKey, JSON.stringify({ text: draft, intent, visibility, recipients, attachments, replyTo, receipt: sendRequest.current } satisfies ComposerDraft));
      else sessionStorage.removeItem(draftKey);
    } catch { /* storage unavailable; in-memory state remains authoritative */ }
  }, [draft, attachments, recipients, replyTo, intent, visibility, sending, draftKey]);
  useEffect(() => {
    const receipt = sendRequest.current;
    if (receipt && snapshot?.receipts['send:' + receipt.id]
      && receipt.key === JSON.stringify([draft, recipients, replyTo, ...(visibility === 'private' ? ['private'] : []), ...(snapshot?.conversation.room ? [intent] : []), ...(attachments.length ? [attachments.map(item => [item.path, item.name, item.sizeBytes])] : [])])) {
      setDraft(''); setAttachments([]); setReplyTo(undefined); sendRequest.current = undefined;
    }
  }, [snapshot?.receipts, snapshot?.conversation.room, draft, attachments, recipients, replyTo, intent, visibility]);
  const retryRequests = useRef(new Map<string, string>());
  const busyRetries = useRef(new Set<string>());
  const [retryingTaskIds, setRetryingTaskIds] = useState<ReadonlySet<string>>(() => new Set());
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
  const tasksById = useMemo(() => new Map(snapshot?.tasks.map(task => [task.id, task]) ?? []), [snapshot?.tasks]);
  const deliveryProjection = useMemo(() => {
    const notes = new Map<string, CollaborationSnapshot['messages']>();
    const hidden = new Set<string>();
    if (!snapshot?.conversation.room) return { notes, hidden };
    const byOrigin = new Map(snapshot.tasks.map(task => [task.originMessageId, task]));
    const results = snapshot.messages.filter(message => message.kind === 'task_result' && message.attemptId && currentAttempts.get(message.attemptId)?.artifacts?.length);
    for (const message of snapshot.messages) {
      // Fold an explicit, causally linked delivery notification into the actual file delivery.
      // Questions, unrelated peer conversation, and notes without a real file stay in chat.
      if (message.kind !== 'chat' || message.expectsResponse || message.taskId || !message.recipientMemberIds.length || message.recipientMemberIds.some(id => membersById.get(id)?.kind === 'user')) continue;
      const task = byOrigin.get(message.causationId ?? message.replyToMessageId ?? '');
      if (!task || task.assigneeMemberId !== message.senderMemberId) continue;
      const result = results.find(item => item.taskId === task.id && item.senderMemberId === message.senderMemberId && item.sequence > message.sequence);
      if (!result) continue;
      hidden.add(message.id); notes.set(result.id, [...notes.get(result.id) ?? [], message]);
    }
    return { notes, hidden };
  }, [snapshot?.conversation.room, snapshot?.messages, snapshot?.tasks, currentAttempts, membersById]);
  const artifactCount = snapshot?.attempts.reduce((count, attempt) => count + (attempt.artifacts?.length ?? 0), 0) ?? 0;
  useEffect(() => {
    if (snapshot?.conversation.room && artifactCount && !resultsOpened.current) {
      resultsOpened.current = true;
      setPanel(current => current ?? 'results');
    }
  }, [snapshot?.conversation.room, artifactCount]);
  const activity = tasks.filter(task =>
    isCollaborationTaskBusy(task, currentAttempts.get(task.currentAttemptId), snapshot?.conversation.room));
  const failures = tasks.filter((task) => { const attempt = currentAttempts.get(task.currentAttemptId); return attempt && ['failed', 'interrupted'].includes(attempt.status) && !attempt.pauseRequested; });
  const chosenTask = tasks.find((task) => task.id === selectedTask);
  const agentMembers = members.filter((member) => member.active && member.kind !== 'user' && !member.teamParticipantId);
  const mentionMembers = snapshot?.conversation.room ? members.filter(member => member.active && member.kind !== 'user') : agentMembers;
  const mentionOptions = mention ? mentionMembers.filter(member => member.active && member.kind !== 'user' && member.name.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase())) : [];
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
      && [JSON.stringify([savedDraft.text, savedDraft.recipients, savedDraft.replyTo]), JSON.stringify([savedDraft.text, savedDraft.recipients, savedDraft.replyTo, savedDraft.intent ?? 'discussion'])].includes(savedDraft.receipt.key)) {
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
    if ((!draft.trim() && !attachments.length) || busySend.current || imageUploads.isBusy()) return;
    if (!snapshot) return;
    if (visibility === 'private' && intent === 'work') { setAttachmentNotice('私信用于定向交流；正式工作请使用公开消息，避免把私人信息写入共享任务目标。'); return; }
    if (visibility === 'private' && !recipients.length && !replyTo) { setAttachmentNotice('私信请先 @ 指定接收成员。'); return; }
    const travel = workspace && snapshot.messages.length === 0 ? captureAvatarTravel(emptyCluster.current, headerCluster.current, agentMembers) : [];
    const { text, mentions } = outbound;
    const key = JSON.stringify([draft, recipients, replyTo, ...(visibility === 'private' ? ['private'] : []), ...(snapshot?.conversation.room ? [intent] : []), ...(attachments.length ? [attachments.map(item => [item.path, item.name, item.sizeBytes])] : [])]);
    if (sendRequest.current?.key !== key) sendRequest.current = { key, id: crypto.randomUUID() };
    const images = attachments.filter(item => item.kind === 'image').map(item => ({ id: item.path.replace(/^image:/, ''), name: item.name, mimeType: item.mimeType ?? 'image/png', dataUrl: item.previewUrl }));
    const files = attachments.filter(item => item.kind !== 'image').map(item => ({ path: item.path, name: item.name, kind: item.kind as 'file' | 'dir', mimeType: item.mimeType, sizeBytes: item.sizeBytes }));
    busySend.current = true;
    setSending(true);
    try {
      await command({ action: 'send', conversationId: String(conversation.id), clientRequestId: sendRequest.current.id, text, ...(images.length ? { images, attachmentContext: { conversationId: String(conversation.id), workspacePath: projectFolder } } : {}), ...(files.length ? { files } : {}), ...(snapshot.conversation.room ? { intent } : {}), mentions, recipientMemberIds: recipients, replyToMessageId: replyTo, ...(visibility === 'private' ? { visibility } : {}) });
      if (travel.length) setFlights(travel);
      setDraft((current) => current === draft ? '' : current);
      const sentPaths = new Set(attachments.map(item => item.path));
      setAttachments(current => current.filter(item => !sentPaths.has(item.path)));
      setAttachmentNotice('');
      if (intent === 'work') setIntent('chat');
      setReplyTo(undefined); sendRequest.current = undefined;
      follow.current = true;
      input.current?.focus();
    } catch { /* Keep the draft and request id so a transport retry is idempotent. */ }
    finally { busySend.current = false; setSending(false); }
  };
  const retry = async (task: CollaborationTask) => {
    if (!snapshot || busyRetries.current.has(task.id) || !canRetryTask(snapshot, task, currentAttempts.get(task.currentAttemptId)) || retryPaused(snapshot, task)) return;
    // Fence rapid clicks synchronously. A later attempt gets a distinct receipt;
    // a transport retry of this attempt retains the original idempotency key.
    const key = task.id + ':' + task.currentAttemptId;
    const id = retryRequests.current.get(key) ?? crypto.randomUUID();
    retryRequests.current.set(key, id);
    busyRetries.current.add(task.id);
    setRetryingTaskIds(new Set(busyRetries.current));
    try {
      await command({ action: 'retry', conversationId: String(conversation.id), taskId: task.id, clientRequestId: id });
      retryRequests.current.delete(key);
    } catch { /* The hook reports failures; retain the receipt for a deliberate transport retry. */ }
    finally { busyRetries.current.delete(task.id); setRetryingTaskIds(new Set(busyRetries.current)); }
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


  return <div className={snapshot?.conversation.room ? 'collab-chat collab-chat--room' : 'collab-chat'} data-testid="collaboration-chat">
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
      {(!snapshot?.conversation.room && (!workspace || activity.length > 0 || failures.length > 0) || snapshot?.conversation.parentConversationId) && <div className="collab-chat__summary">
        {(!workspace || activity.length > 0 || failures.length > 0) && <button className="collab-pill" onClick={() => { setPanel('tasks'); setSelectedTask(undefined); }}><ListChecks size={14} />{activity.length ? `活动任务 ${activity.length}` : tasks.length ? '执行已结束' : '当前无任务'}{failures.length ? ` · 失败 ${failures.length}` : ''}<ChevronRight size={13} /></button>}
        {snapshot?.conversation.parentConversationId && <button className="collab-pill" onClick={() => onOpenConversation(snapshot.conversation.parentConversationId!)}><ArrowLeft size={13} />返回关联会话</button>}
      </div>}
      {error && <div className="collab-notice" role="alert">{error}<button className="collab-pill" onClick={() => void run({ action: 'get', conversationId: String(conversation.id) }, 'refresh')}>重新连接</button></div>}
      {snapshot?.conversation.room && <TaskRoomBar key={snapshot.conversation.id} snapshot={snapshot} onCommand={command} onSelectTask={id => { setSelectedTask(id); setPanel('tasks'); }} artifactCount={artifactCount} resultsOpen={panel === 'results'} onOpenResults={() => setPanel(current => current === 'results' ? null : 'results')} />}
      <CollaborationApprovals snapshot={snapshot} active={active && layerActive} />
      <GroupBrowserHandoffs snapshot={snapshot} active={active && layerActive} />
      <div className="collab-chat__messages" ref={viewport} onScroll={() => { const el = viewport.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70; }}>
        {!snapshot ? <p className="collab-empty" role="status">正在加载会话…</p> : snapshot.messages.length === 0 ? snapshot.conversation.kind === 'group' && agentMembers.length > 0 ? <div ref={emptyCluster} className="collab-empty collab-empty--group" data-testid="collaboration-group-empty"><AvatarCluster members={agentMembers} size={workspace ? 64 : 48} max={3} animate /><strong>{snapshot.conversation.room ? '和大家聊聊' : '几个头脑，一场对话'}</strong><p>{agentMembers.map((member) => member.name).join('、')} 都在这里。先聊想法，确认后直接说“开始”，协调员会安排成员执行；@ 可指定成员。</p></div> : <div className="collab-empty">{workspace && agentMembers[0] && <Avatar name={agentMembers[0].name} avatar={agentMembers[0].avatar} size={84} animate />}<strong>{workspace && agentMembers[0] ? `和${agentMembers[0].name}聊聊` : '从一条消息开始协作'}</strong><p>{snapshot.conversation.kind === 'model' ? '与模型对话，或点击「调用智能体」分配独立任务。' : snapshot.conversation.kind === 'group' ? '回复优先交给原作者；未指定时由当前负责人或协调员处理，@ 可指定成员。' : '消息与任务都保留在这里。任务执行时仍可继续聊天。'}</p></div> : null}
        {workspace && snapshot?.messages.length ? <div className="collab-chat__date">{new Date(snapshot.messages[0].createdAt).toLocaleDateString([], { month: 'long', day: 'numeric' })}</div> : null}
        {snapshot?.messages.map((message) => {
          const sender = membersById.get(message.senderMemberId);
          const messageTask = message.taskId ? tasksById.get(message.taskId) : undefined;
          if (snapshot.conversation.room) {
            if (deliveryProjection.hidden.has(message.id) || message.kind === 'system' || message.kind === 'task_assignment' && (!messageTask || messageTask.purpose === 'coordination')) return null;
            const assignment = message.kind === 'task_assignment' && messageTask;
            const attempt = assignment ? currentAttempts.get(messageTask.currentAttemptId)
              : message.attemptId ? currentAttempts.get(message.attemptId) : undefined;
            // Legacy batches may already contain unsent downstream handoffs and synthetic
            // dependency failures. Keep them in task history, not the public dispatch stream.
            if (assignment && !attempt?.startedAt && (messageTask.pendingAssignment ||
              attempt?.waitReason === 'dependency' || attempt?.waitReason === 'dependency_failed')) return null;
            if (!assignment && !attempt?.startedAt && attempt?.error?.code === 'dependency_failed') return null;
            const artifacts = attempt?.artifacts ?? [];
            const internalResult = message.kind === 'task_result' || sender?.kind !== 'user' && (messageTask?.purpose === 'work' || messageTask?.purpose === 'coordination' || artifacts.length > 0);
            // Project committed dispatches and deliveries, not the model's internal receipts.
            if (assignment || internalResult) {
              // Preserve visibility for older records whose transport succeeded but dispatch never did.
              const legacyNoProgress = messageTask?.purpose === 'coordination' && attempt?.status === 'succeeded' && !artifacts.length && attempt.tools.some(tool => tool.status === 'failed') && !tasks.some(task => task.parentTaskId === messageTask.id) && !tasks.some(task => task.rootTaskId === messageTask.rootTaskId && currentAttempts.get(task.currentAttemptId)?.artifacts?.length);
              const blocked = attempt && (['failed', 'interrupted', 'cancelled'].includes(attempt.status) || legacyNoProgress);
              if (!assignment && !artifacts.length && !blocked && !messageTask?.handoff && !attempt?.workHandoff && (messageTask?.kind !== 'task' || messageTask?.purpose === 'coordination')) return null;
              const handoff = deliveredHandoff(attempt);
              const recipients = assignment ? [messageTask.assigneeMemberId] : handoff ? [handoff.recipientMemberId] : messageTask?.handoff ? message.recipientMemberIds : [];
              const status = attempt ? COLLABORATION_STATUS[attempt.status] : messageTask ? COLLABORATION_STATUS[currentAttempts.get(messageTask.currentAttemptId)?.status ?? 'queued'] : '';
              const delivered = attempt?.status === 'succeeded';
              const latestAttempt = messageTask ? currentAttempts.get(messageTask.currentAttemptId) : undefined;
              const inlineRetry = Boolean(!assignment && blocked && messageTask && canRetryTask(snapshot, messageTask, attempt));
              const retryPending = Boolean(!assignment && blocked && messageTask && attempt && latestAttempt && retryScopeOpen(snapshot, messageTask) && (attempt.id === latestAttempt.id && retryingTaskIds.has(messageTask.id) || latestAttempt.number === attempt.number + 1 && ACTIVE.has(latestAttempt.status)));
              const blockerText = attempt?.error?.message ?? (legacyNoProgress ? '本轮派工失败，尚未产生实际任务或成果。请核对执行详情中的参数和资料后重试。' : '执行未完成，请核对执行记录。');
              const split = blockerText.indexOf(' 下一步：');
              const blockerReason = split >= 0 ? blockerText.slice(0, split) : blockerText;
              const nextStep = attempt?.error?.nextStep ?? (split >= 0 ? blockerText.slice(split + ' 下一步：'.length) : undefined);
              return <article className="collab-message collab-event" key={message.id} data-message-id={message.id} data-event-kind={assignment ? 'assignment' : blocked ? 'blocker' : artifacts.length ? 'delivery' : 'completion'}>
                <div className="collab-message__identity"><Avatar name={sender?.name ?? '系统'} avatar={sender?.avatar} size={workspace ? 20 : 26} /><strong>{sender?.name ?? '系统'}</strong><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
                <div className="collab-message__body collab-event__body">
                  <div className="collab-event__heading"><span className={assignment ? 'task-room-tag task-room-tag--execution' : delivered ? 'task-room-tag task-room-tag--results' : 'task-room-tag task-room-tag--paused'}>{assignment ? '派工' : blocked ? artifacts.length ? '文档草稿' : '工作阻塞' : handoff ? ({ review: '请求审核', work: '交接工作', report: '回报与决策' }[handoff.kind]) : messageTask?.handoff ? '审核／回应' : artifacts.length ? delivered ? '文档交付' : '文档草稿' : blocked ? '工作阻塞' : status}</span>{assignment && <small>{status}</small>}{blocked && artifacts.length > 0 && <span className="task-room-tag task-room-tag--error">工作阻塞</span>}</div>
                  {assignment ? <p>{recipients.map(id => <span className="collab-mention-chip" key={id}>@{membersById.get(id)?.name ?? '已移除成员'}</span>)} 请完成：{messageTask.title}</p> : artifacts.length ? artifacts.map(artifact => <button type="button" className="collab-event__document" key={artifact.id} onClick={() => { setSelectedArtifact(artifact.id); setPanel('results'); }}><span>▤ {artifact.title}</span><small>在右侧打开 →</small></button>) : <p>{messageTask?.title}</p>}
                  {!assignment && !blocked && (handoff || messageTask?.handoff) && <CollaborationHandoffText text={handoff?.text ?? textOf(message)}>{recipients.map(id => <span className="collab-mention-chip" key={id}>@{membersById.get(id)?.name ?? '已移除成员'}</span>)}</CollaborationHandoffText>}
                  {!assignment && blocked && messageTask?.handoff && <p>{recipients.map(id => <span className="collab-mention-chip" key={id}>@{membersById.get(id)?.name ?? '已移除成员'}</span>)} 执行遇到阻塞，请核对下一步。</p>}
                  {blocked && <p role="status" className="collab-event__blocker">{blockerReason.slice(0, 200)}{blockerReason.length > 200 ? '…' : ''}</p>}
                  {blocked && nextStep && <p className="collab-event__blocker">下一步：{nextStep.slice(0, 200)}{nextStep.length > 200 ? '…' : ''}</p>}
                  {deliveryProjection.notes.get(message.id)?.map(note => <div className="collab-event__note" key={note.id}><CollaborationMessageText text={textOf(note)} mentions={[]} members={membersById} projectFolder={projectFolder} conversationId={String(conversation.id)} /></div>)}
                  {messageTask && <div className="collab-event__actions">
                    {(inlineRetry || retryPending) && <button type="button" className="collab-link collab-event__retry" disabled={retryPending || retryPaused(snapshot, messageTask)} title={retryPaused(snapshot, messageTask) ? '请先继续本群工作后重试' : '仅重试这项执行，保留已有成果与历史记录'} onClick={() => void retry(messageTask)}><RotateCcw size={13} />{retryPending ? '重试中…' : '重试'}</button>}
                    <button type="button" className="collab-link" onClick={() => { setSelectedTask(messageTask.id); setPanel('tasks'); }}>查看执行详情</button>
                  </div>}
                </div>
              </article>;
            }
          }
          // New workflow assignments/results belong in task details, not the public conversation.
          if (!snapshot.conversation.room && snapshot.conversation.kind !== 'model' && (message.kind === 'system' || (messageTask?.deliverable && (message.kind === 'task_assignment' || message.kind === 'task_result')))) return null;
          const workflowNodes = tasks.filter(task => task.kind === 'task' && task.returnTo.replyToMessageId === message.id);
          const associated = (workflowNodes.length ? workflowNodes : tasks.filter(task => task.originMessageId === message.id)).filter(task => !snapshot.conversation.room || task.kind !== 'reply');
          const finalArtifacts = messageTask?.kind === 'summary' ? tasks.filter(task => task.rootTaskId === messageTask.rootTaskId && task.kind === 'task' && !tasks.some(other => other.dependsOnTaskIds.includes(task.id)))
            .flatMap(task => { const a = currentAttempts.get(task.currentAttemptId); return a?.status === 'succeeded' ? a.artifacts ?? [] : []; }) : [];
          const deliveries = snapshot.deliveries.filter((delivery) => delivery.messageId === message.id);
          const pausedDelivery = deliveries.some(d => snapshot.attempts.find(a => a.id === d.attemptId)?.pauseRequested);
          const failedDelivery = deliveries.some(d => d.status === 'failed' && !snapshot.attempts.find(a => a.id === d.attemptId)?.pauseRequested);
          const deliveryLabel = failedDelivery ? '消息处理失败 · 任务中查看原因' : pausedDelivery ? (snapshot.conversation.room?.state === 'paused' ? '本群已暂停 · 等待继续' : '暂停前输出 · 已保留') : deliveries.some(d => snapshot.attempts.find(a => a.id === d.attemptId)?.waitReason === 'peer_reply') ? '等待成员回复' : deliveries.every((item) => item.status === 'cancelled') ? '已取消' : deliveries.every((item) => item.status === 'processed') ? (message.expectsResponse ? '已回复' : '已送达 · 不触发回复') : deliveries.some((item) => item.status === 'processing') ? '处理中' : '已排队';
          const quoted = message.replyToMessageId && (!snapshot.conversation.room || sender?.kind === 'user') ? snapshot.messages.find((item) => item.id === message.replyToMessageId) : undefined;
          const text = textOf(message);
          return <article key={message.id} className={`collab-message ${sender?.kind === 'user' ? 'is-user' : ''} ${message.kind === 'system' ? 'is-system' : ''} ${initialMessages.current?.has(message.id) ? '' : 'is-new'}`} data-message-id={message.id}>
            <div className="collab-message__identity">{sender?.kind === 'agent' ? <button type="button" className="collab-message__who" aria-label={`编辑${sender.name}`} onClick={() => editMember(sender.id)}><Avatar name={sender.name} avatar={sender.avatar} size={workspace ? 20 : 26} /><strong>{sender.name}</strong></button> : <><Avatar name={sender?.name ?? '系统'} avatar={sender?.avatar} size={workspace ? 20 : 26} /><strong>{sender?.name ?? '系统'}</strong></>}<span>{sender?.role}</span>{message.visibility === 'private' && <span className="collab-tag">私信 · 仅参与者可见</span>}{message.kind === 'task_result' && <span className="collab-tag">任务结果</span>}{!snapshot.conversation.room && sender?.kind !== 'user' && message.recipientMemberIds.some(id => id !== sender?.id) && <span className="collab-tag collab-peer-route">→ {message.recipientMemberIds.map(id => membersById.get(id)?.name ?? '已移除成员').join('、')}</span>}{sender?.kind !== 'user' && message.expectsResponse && deliveries.length > 0 && <span className="collab-peer-status">{deliveryLabel}</span>}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
            {quoted && <button className="collab-message__quote" onClick={() => viewport.current?.querySelector(`[data-message-id="${CSS.escape(quoted.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>回复：{snapshot.conversation.room && quoted.taskId && (quoted.kind === 'task_result' || tasksById.get(quoted.taskId)?.purpose === 'coordination' || tasksById.get(quoted.taskId)?.purpose === 'work') ? tasksById.get(quoted.taskId)?.title ?? '执行记录' : textOf(quoted).slice(0, 100)}</button>}
            {message.contextRefs?.map((reference) => <button className="collab-message__quote" key={`${reference.conversationId}:${reference.messageId}`} onClick={() => onOpenConversation(reference.conversationId)}>查看关联群聊消息</button>)}
            {(text || message.mentions.length > 0) && <div className="collab-message__body">{snapshot.conversation.room && sender?.kind !== 'user' && message.mentions.length === 0 && message.recipientMemberIds.some(id => membersById.get(id)?.kind !== 'user') && <div className="collab-message__mentions">{message.recipientMemberIds.filter(id => id !== sender?.id).map(id => <span className="collab-mention-chip" key={id}>@{membersById.get(id)?.name ?? '已移除成员'}</span>)}</div>}<CollaborationMessageText text={text} mentions={message.mentions} members={membersById} projectFolder={projectFolder} conversationId={String(conversation.id)} /></div>}
            <CollaborationMessageAttachments blocks={message.blocks} projectFolder={projectFolder} />
            {finalArtifacts.length > 0 && <Suspense fallback={<p className="collab-muted">读取产物…</p>}><CollaborationArtifacts artifacts={finalArtifacts} projectFolder={projectFolder} /></Suspense>}
            {workspace ? associated.length > 0 && <button className="aw-task-link" onClick={() => { setSelectedTask(associated.length === 1 ? associated[0].id : undefined); setPanel('tasks'); }}><ListChecks size={13} />{associated.length} 项协作任务<ChevronRight size={13} /></button> : associated.map((task) => <TaskCard key={task.id} task={task} attempt={currentAttempts.get(task.currentAttemptId)} member={membersById.get(task.assigneeMemberId)} onOpen={() => { setSelectedTask(task.id); setPanel('tasks'); }} />)}
            <div className={`collab-message__actions${failedDelivery ? ' has-error' : ''}`}>
              <button className="collab-link" onClick={() => { setReplyTo(message.id); setVisibility(message.visibility === 'private' ? 'private' : 'public'); input.current?.focus(); }}>回复</button>
              {message.taskId && <button className="collab-link" onClick={() => { setSelectedTask(message.taskId); setPanel('tasks'); }}>{messageTask?.purpose === 'discussion' ? '查看回复执行' : '查看任务'}</button>}
              {deliveries.length > 0 && (sender?.kind === 'user' || failedDelivery || pausedDelivery || deliveries.some(d => !['processed', 'cancelled'].includes(d.status))) && <span>{deliveryLabel}</span>}
              {failedDelivery && <button className="collab-link" disabled={operation === `message:${message.id}`} onClick={() => retryMessage(message.id)}>重新投递</button>}
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
      <form className="collab-composer" data-composer-style="attachments" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); addFiles(event.dataTransfer.files); } }} onSubmit={(event) => { event.preventDefault(); void send(); }}>
        {snapshot?.conversation.room && <div className="task-room-intent" role="group" aria-label="本次消息目的"><button type="button" className="collab-pill" aria-pressed={intent === 'chat'} onClick={() => setIntent('chat')}>聊天</button><button type="button" className="collab-pill" aria-pressed={intent === 'discussion'} onClick={() => setIntent('discussion')}>只讨论</button><button type="button" className="collab-pill" aria-pressed={intent === 'work'} disabled={['paused', 'pausing', 'completed'].includes(snapshot.conversation.room.state)} onClick={() => setIntent('work')}>分配小工作</button><small>{intent === 'chat' ? '先沟通，明确开工后由协调员安排' : intent === 'discussion' ? '严格只解答，即使说“开始”也不派工' : '@ 成员执行一次；未指定时由协调员安排'}</small></div>}
        {replyTo && <div className="collab-composer__reference">回复：{snapshot?.messages.find((item) => item.id === replyTo)?.blocks[0]?.text?.slice(0, 80)}<button type="button" className="collab-pill" aria-label="取消回复" onClick={() => setReplyTo(undefined)}><X size={12} /></button></div>}

        {mention && <div id={mentionListId} className="collab-mention" role="listbox" aria-label="选择接收成员">{mentionOptions.map((member, index) => <button type="button" role="option" id={`${mentionListId}-${index}`} data-highlighted={index === highlightedMention ? 'true' : undefined} aria-selected={recipients.includes(member.id)} key={member.id} onMouseDown={event => event.preventDefault()} onClick={() => chooseMention(member)}><Avatar name={member.name} avatar={member.avatar} size={22} />{member.name}<span>{member.role}</span></button>)}</div>}
        {attachmentNotice && <p className="collab-attachment-notice" role="alert">{attachmentNotice}</p>}
        <input ref={fileInput} type="file" multiple aria-label="选择群聊附件" hidden onChange={event => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} />
        <ComposerEditor attachments={imageUploads.items} onRemoveAttachment={imageUploads.remove} onPaste={event => { const files = Array.from(event.clipboardData.files ?? []); if (!files.length) for (const item of Array.from(event.clipboardData.items ?? [])) { const file = item.kind === 'file' ? item.getAsFile() : null; if (file) files.push(file); } if (files.length) { event.preventDefault(); addFiles(files); } }} ref={input} ariaLabel="协作消息" inputTestId="collaboration-draft" ariaAutocomplete="list" ariaControls={mention ? mentionListId : undefined} ariaActiveDescendant={mentionOptions.length ? `${mentionListId}-${highlightedMention}` : undefined} className="collab-composer__editor" minHeight={32} maxHeight={200} placeholder={workspace ? '你好，今天想一起做些什么？' : snapshot?.conversation.kind === 'model' ? '继续与模型对话…' : '输入消息，@ 指定成员…'} value={draft}
          onChange={(value, selection) => { setDraft(value); setMention(detectAgentMentionQuery(value, selection.start)); setMentionIndex(0); }}
          onKeyDown={(event) => { if (event.nativeEvent.isComposing) return; if (event.key === 'Escape') { setMention(null); return; } if (mention && mentionOptions.length) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setMentionIndex((highlightedMention + (event.key === 'ArrowDown' ? 1 : mentionOptions.length - 1)) % mentionOptions.length); return; } if (event.key === 'Enter') { event.preventDefault(); chooseMention(mentionOptions[highlightedMention]); return; } } if (event.key === 'Enter' && !event.shiftKey && (!mention || !mentionOptions.length)) { event.preventDefault(); void send(); } }} />
        <div className="collab-composer__toolbar">{workspace ? <Menu.Root><Menu.Trigger asChild><button type="button" className="collab-pill collab-composer__add" aria-label="添加到对话"><Plus size={20} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="aw-menu" side="top" align="start" sideOffset={10}>
          <Menu.Item onSelect={() => fileInput.current?.click()}><Paperclip size={16} />添加图片、音频或文件</Menu.Item>
          <Menu.Item onSelect={openMentionPicker}><AtSign size={16} />指定接收成员</Menu.Item>
          <Menu.Item disabled={!snapshot} onSelect={() => setTaskDialog(true)}><Plus size={16} />创建协作任务</Menu.Item>
          <Menu.Item onSelect={() => { setSelectedTask(undefined); setPanel('tasks'); }}><ListChecks size={16} />任务与执行历史</Menu.Item>
        </Menu.Content></Menu.Portal></Menu.Root> : <button type="button" className="collab-pill" disabled={!snapshot} onClick={() => setTaskDialog(true)}><Plus size={15} />{snapshot?.conversation.kind === 'model' ? '调用智能体' : '创建任务'}</button>}
        {snapshot?.conversation.kind === 'group' && <select className="collab-pill" aria-label="消息可见范围" value={visibility} onChange={event => setVisibility(event.target.value as 'public' | 'private')}><option value="public">公开消息</option><option value="private">私信 · 先 @ 接收者</option></select>}
        <button type="button" className="collab-pill" aria-label="添加附件" title="添加图片、音频或文件" onClick={() => fileInput.current?.click()}><Paperclip size={15} /></button>
        <button type="button" className="collab-pill" onClick={openMentionPicker}><AtSign size={15} />成员</button>{snapshot?.conversation.kind === 'group' && <button type="button" className="collab-pill" aria-label="群聊联网读取" aria-pressed={snapshot.conversation.policy.networkEnabled === true} disabled={Boolean(operation)} title="用于后续执行的公开网页与源码读取；不授予文件写入或登录权限" onClick={() => void command({ action: 'policy', conversationId: snapshot.conversation.id, policy: { networkEnabled: snapshot.conversation.policy.networkEnabled !== true } })}>联网 {snapshot.conversation.policy.networkEnabled ? '开' : '关'}</button>}<span className="collab-composer__hint">{snapshot?.conversation.kind === 'group' && !recipients.length ? (replyTo ? '回复所选成员' : intent === 'work' ? '交给协调员安排工作' : '自动路由 · @ 可指定成员') : '任务执行时可继续发送'}</span><button type="submit" className="collab-send" aria-label="发送消息" disabled={(!draft.trim() && !attachments.length) || sending || imageUploads.pending || !snapshot || Boolean(snapshot.conversation.room && intent === 'work' && ['paused', 'pausing', 'completed'].includes(snapshot.conversation.room.state))}><ArrowUp size={18} /></button></div>
      </form>
    </div>
    {panel && snapshot && <aside className={`collab-panel${panel === 'tasks' ? ' collab-panel--tasks' : panel === 'results' ? ' collab-panel--results' : ''}`} aria-label={panel === 'results' ? '群聊成果' : panel === 'tasks' ? '执行详情' : panel === 'agent' ? '智能体设置' : '会话成员'}><header><strong>{panel === 'results' ? `成果 · ${artifactCount}` : panel === 'agent' ? (workspace ? membersById.get(editing ?? '')?.name ?? '智能体设置' : '智能体设置') : panel === 'members' ? '会话成员' : chosenTask ? '任务详情' : '任务执行'}</strong><button className="collab-pill" onClick={() => setPanel(null)} aria-label="关闭详情"><X size={15} /></button></header>
      {panel === 'results' ? <Suspense fallback={<p className="collab-muted">读取成果…</p>}><CollaborationResultsPanel snapshot={snapshot} selectedId={selectedArtifact} onSelect={setSelectedArtifact} projectFolder={projectFolder} onSelectTask={id => { setSelectedTask(id); setPanel('tasks'); }} /></Suspense> : panel === 'agent' && editing && membersById.get(editing) ? <AgentEditorPanel models={models} workspace={workspace} member={membersById.get(editing)!} agent={agents.find((agent) => agent.id === membersById.get(editing)!.agentId)} onSaved={onAgentsChanged} /> : panel === 'members' ? <MembersPanel conversation={conversation} snapshot={snapshot} agents={agents} teams={teams} busy={Boolean(operation)} onCommand={(request) => void run(request, 'members')} onDirect={openDirect} onEdit={editMember} /> : chosenTask ? <TaskDetail snapshot={snapshot} projectFolder={projectFolder} onSelectTask={setSelectedTask} task={chosenTask} attempts={snapshot.attempts.filter((attempt) => attempt.taskId === chosenTask.id)} member={membersById.get(chosenTask.assigneeMemberId)} busy={operation === chosenTask.id || retryingTaskIds.has(chosenTask.id)} onBack={() => setSelectedTask(undefined)} onCancel={() => void run({ action: 'cancel', conversationId: String(conversation.id), taskId: chosenTask.id, includeChildren: true }, chosenTask.id)} onRetry={() => retry(chosenTask)} /> : <TaskExecutionList tasks={tasks} attempts={currentAttempts} members={membersById} onSelect={setSelectedTask} />}
    </aside>}
    {flights.length > 0 && <AvatarTravel flights={flights} onComplete={() => setFlights([])} />}
    {taskDialog && snapshot && <CreateTaskDialog snapshot={snapshot} onClose={() => setTaskDialog(false)} onCreate={async (request) => { const response = await run(request, 'dispatch'); if (response) { setTaskDialog(false); setPanel('tasks'); } }} />}
  </div>;
}

function taskState(task: CollaborationTask, attempt?: CollaborationAttempt): string {
  if (task.pendingAssignment && attempt?.status === 'queued') return '待派工';
  if (attempt?.waitReason === 'dependency_failed') return '等待前置恢复';
  if (attempt?.waitReason === 'dependency') return '等待前置交付';
  return attempt ? COLLABORATION_STATUS[attempt.status] : '准备中';
}
function TaskCard({ task, attempt, member, onOpen }: { task: CollaborationTask; attempt?: CollaborationAttempt; member?: CollaborationMember; onOpen(): void }) {
  return <button type="button" className="collab-task-card task-business-row" onClick={onOpen}>
    <span className="collab-task-card__title"><AgentAvatarView name={member?.name ?? '智能体'} avatar={member?.avatar} size={28} /><strong>{task.title}</strong><ChevronRight size={14} /></span>
    <span className="collab-task-card__meta"><span>{member?.name ?? '待指派'} · {task.kind === 'task' && task.purpose !== 'coordination' ? '工作' : '协调'}{attempt && ' · 第 ' + attempt.number + ' 次'}</span><span className="task-state" data-status={attempt?.waitReason?.startsWith('dependency') ? 'queued' : attempt?.status}>{taskState(task, attempt)}</span></span>
    {task.planRef && <span className="collab-task-card__meta">计划 v{task.planRef.revision}{task.planRef.stepId ? ' · ' + task.planRef.stepId : ''}</span>}
    {attempt?.waitReason && <span className="task-business-row__hint">{WAIT_REASON[attempt.waitReason] ?? attempt.waitReason}</span>}
    {attempt?.observation === 'status_unconfirmed' && <span className="task-business-row__hint">状态待确认，正在核对运行情况</span>}
    {attempt?.error && <span className="task-business-row__hint">{attempt.error.message}</span>}
  </button>;
}
function TaskExecutionList({ tasks, attempts, members, onSelect }: { tasks: CollaborationTask[]; attempts: Map<string, CollaborationAttempt>; members: Map<string, CollaborationMember>; onSelect(id: string): void }) {
  const [filter, setFilter] = useState<'all' | 'work' | 'attention'>('all');
  const shown = tasks.filter(task => filter === 'all' || (filter === 'work' ? task.kind === 'task' && task.purpose !== 'coordination' : ['failed', 'interrupted', 'waiting_input'].includes(attempts.get(task.currentAttemptId)?.status ?? '') || Boolean(attempts.get(task.currentAttemptId)?.waitReason)));
  return <div className="collab-panel__body task-execution-list"><div className="task-section-intro"><h3>执行记录 <span>{tasks.length}</span></h3><p>工作与协调分开查看；等待前置不代表任务执行失败。</p></div><nav className="task-section-tabs" aria-label="筛选执行记录">{([['all', '全部'], ['work', '工作任务'], ['attention', '待处理']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}</nav>{shown.length === 0 ? <p className="collab-empty">此范围暂无执行记录。</p> : shown.map(task => <TaskCard key={task.id} task={task} attempt={attempts.get(task.currentAttemptId)} member={members.get(task.assigneeMemberId)} onOpen={() => onSelect(task.id)} />)}</div>;
}

function TaskGoalText({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const long = text.length > 160 || text.split('\n').length > 4;
  return <div className="task-inspector__description"><h4>{label}</h4><p id={id} data-collapsed={long && !expanded}>{text}</p>{long && <button type="button" className="collab-link task-inspector__expand" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? '收起' : '展开完整'}{label}</button>}</div>;
}

function TaskDetail({ snapshot, projectFolder, onSelectTask, task, attempts, member, busy, onBack, onCancel, onRetry }: { snapshot: CollaborationSnapshot; projectFolder?: string; onSelectTask(id: string): void; task: CollaborationTask; attempts: CollaborationAttempt[]; member?: CollaborationMember; busy: boolean; onBack(): void; onCancel(): void; onRetry(): void }) {
  const [tab, setTab] = useState<'checklist' | 'result' | 'history'>('checklist');
  const [attemptId, setAttemptId] = useState(task.currentAttemptId);
  const nextAttempt = useRef<{ taskId: string; attemptId?: string }>();
  // Preserve the inspector tab and the exact producer attempt on handoff navigation.
  useEffect(() => {
    const target = nextAttempt.current;
    setAttemptId(target?.taskId === task.id && target.attemptId ? target.attemptId : task.currentAttemptId);
    nextAttempt.current = undefined;
  }, [task.id, task.currentAttemptId]);
  const navigateTask = (id: string, targetAttemptId?: string) => {
    nextAttempt.current = { taskId: id, attemptId: targetAttemptId };
    onSelectTask(id);
  };
  const attempt = attempts.find(item => item.id === attemptId) ?? attempts.at(-1);
  const current = attempts.find(item => item.id === task.currentAttemptId);
  const artifacts = attempt?.artifacts ?? [];
  const depends = task.dependsOnTaskIds.map(id => snapshot.tasks.find(item => item.id === id)).filter(Boolean);
  return <div className="collab-panel__body task-inspector">
    <button className="collab-link" onClick={onBack}><ArrowLeft size={14} />所有任务</button>
    <div className="task-inspector__identity"><AgentAvatarView name={member?.name ?? '智能体'} avatar={member?.avatar} size={36} /><div><h3>{task.title}</h3><p>{member?.name} · {current && taskState(task, current)}</p></div></div>
    <section className="task-inspector__goal" aria-label="任务说明与交付要求"><TaskGoalText key={task.id + '-goal'} label="任务目标" text={task.instructions} /><TaskGoalText key={task.id + '-output'} label="预期交付" text={task.expectedOutput || '尚未明确，请协调员补充交付与验收要求。'} />{task.planRef && <small>关联计划：{task.planRef.planId} v{task.planRef.revision}{task.planRef.stepId ? ' · ' + task.planRef.stepId : ''} · 协作参考，不是完成凭据</small>}</section>
    <div className="task-inspector__controls">{attempts.length > 0 && <label className="collab-field">执行轮次<TaskSelect aria-label="执行记录" value={attempt?.id} onChange={event => setAttemptId(event.target.value)}>{attempts.map(item => <option key={item.id} value={item.id}>第 {item.number} 次 · {taskState(task, item)}</option>)}</TaskSelect></label>}
      {current && ACTIVE.has(current.status) ? <button className="collab-pill" disabled={busy || current.status === 'stopping'} onClick={onCancel}><Square size={12} />{current.status === 'stopping' ? '停止中' : '停止当前任务'}</button> : <button className="collab-pill" disabled={busy || !canRetryTask(snapshot, task, current) || retryPaused(snapshot, task)} onClick={onRetry}><RotateCcw size={13} />核对后重试</button>}
    </div>
    {attempt?.error && <section className="task-inspector__blocker" role="status" aria-label="工作阻塞详情"><h4>{attempt.waitReason?.startsWith('dependency') ? '前置交付尚未就绪' : attempt.status === 'interrupted' ? '执行已中断，已有成果仍保留' : '本轮需要处理'}</h4><p>{attempt.error.message}</p><p>下一步：{attempt.error.nextStep || '先核对已生成文件及外部操作回执，再决定是否重试，避免重复提交。'}</p><details><summary>技术详情</summary><code>{attempt.error.category} · {attempt.error.code}</code></details></section>}
    <div className="task-section-tabs" role="tablist" aria-label="任务详情内容">{([['checklist', '概览'], ['result', '成果'], ['history', '执行轨迹']] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    <section role="tabpanel" aria-label={tab === 'checklist' ? '概览' : tab === 'result' ? '成果' : '执行轨迹'}>
    {tab === 'checklist' && <>{depends.length > 0 && <section className="task-inspector__dependencies"><h4>前置交付</h4>{depends.map(item => item && <button type="button" key={item.id} className="task-dependency" onClick={() => onSelectTask(item.id)}><span>{item.title}</span><ChevronRight size={14} /></button>)}</section>}{attempt?.waitReason && <p className="task-experience-note">{WAIT_REASON[attempt.waitReason] ?? attempt.waitReason}</p>}{attempt?.checklist.length ? <ul className="collab-checklist">{attempt.checklist.map(item => <li key={item.id}><span>{item.status === 'completed' ? <Check size={14} /> : item.status === 'in_progress' ? '◉' : '○'}</span>{item.text}</li>)}</ul> : <p className="task-experience-note">本轮尚未提交执行清单。协调员可根据实际结果动态调整分工。</p>}<p className="task-experience-note">执行状态仅表示执行轮次；是否完成业务目标，需结合真实产物、验收与外发回执核对。</p></>}
    {tab === 'result' && <><p className="task-experience-note">第 {attempt?.number ?? 1} 次执行 · {artifacts.length} 个实际成果</p>{artifacts.length > 0 && <Suspense fallback={<p>读取成果…</p>}><CollaborationArtifacts artifacts={artifacts} projectFolder={projectFolder} /></Suspense>}{attempt?.output && !ACTIVE.has(attempt.status) ? <MarkdownContent text={attempt.output} projectFolder={projectFolder} streaming={false} /> : <p className="collab-muted">{attempt && ACTIVE.has(attempt.status) ? '本轮仍在执行，成果提交后会显示在这里。' : '本轮没有返回文本结果，执行轨迹已保留。'}</p>}</>}
    {tab === 'history' && <Suspense fallback={<p className="collab-muted">正在加载任务详情…</p>}><CollaborationTaskTrace key={attempt?.id} snapshot={snapshot} task={task} attempt={attempt} onSelectTask={navigateTask} projectFolder={projectFolder} /></Suspense>}
    </section>
  </div>;
}

function MembersPanel({ conversation, snapshot, agents, teams, busy, onCommand: sendCommand, onDirect, onEdit }: { conversation: Conversation; snapshot: CollaborationSnapshot; agents: readonly GlobalAgent[]; teams: readonly Team[]; busy: boolean; onCommand(request: CollaborationCommand): void; onDirect(member: CollaborationMember): void; onEdit(memberId: string): void }) {
  const onCommand = (request: CollaborationCommand) => sendCommand(request.action === 'members' ? { ...request, expectedTopologyRevision: snapshot.conversation.topologyRevision ?? 0 } : request);
  const running = snapshot.tasks.some(task => snapshot.attempts.some(attempt => attempt.id === task.currentAttemptId && ACTIVE.has(attempt.status)));
  const availableTeams = teams.filter(team => !snapshot.members.some(member => member.active && member.teamSnapshot?.id === team.id));
  const [section, setSection] = useState<'members' | 'settings' | 'schedules'>('members');
  const [editingRole, setEditingRole] = useState<CollaborationMember>();
  const [roleDraft, setRoleDraft] = useState('');
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
  return <div className="collab-panel__body collab-members-panel">
    <nav className="task-section-tabs" aria-label="会话管理分区">{([['members', '成员'], ['settings', '执行设置'], ['schedules', '定时任务']] as const).filter(([id]) => id !== 'schedules' || Boolean(snapshot.conversation.room)).map(([id, label]) => <button type="button" key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}</nav>
    <div hidden={section !== 'members'}>
      <div className="task-section-intro"><h3>协作成员 <span>{activeMembers.length}</span></h3><p>职责描述不增加工具权限；成员加入后不会自动开工。</p></div>
      {running && <p className="task-experience-note">有任务执行中，暂时锁定协调权移交；其他成员仍可按职责加入协作。</p>}
      {activeMembers.map((member) => <div className="collab-member" key={member.id}><div className="collab-member__identity"><AgentAvatarView name={member.name} avatar={member.avatar} size={30} /><strong>{member.name}</strong>{member.id === snapshot.conversation.coordinatorMemberId && <span className="collab-tag">协调员</span>}</div>{member.kind === 'team' && <details><summary>{member.role} · 成员与角色</summary><ol>{member.teamSnapshot?.members.map(config => <li key={config.agentId}>{agents.find(agent => agent.id === config.agentId)?.name ?? config.agentId} · {config.title || config.role}</li>)}</ol><small>加入版本：{member.teamSnapshot?.updatedAt}；小队定义更新需退出后重新添加。</small></details>}{member.kind !== 'user' && <><div className="collab-member__role"><span>{member.role === 'coordinator' ? '负责协调与验收' : member.role === 'member' ? '按分工执行任务' : member.role || '尚未填写职责'}</span><button type="button" className="collab-link" disabled={busy} onClick={() => { setEditingRole(member); setRoleDraft(member.role); }}>编辑职责</button></div><div className="collab-toolbar">{member.kind !== 'team' && !snapshot.conversation.room && <button className="collab-link" disabled={busy} onClick={() => onDirect(member)}>打开单聊</button>}{member.kind === 'agent' && <button className="collab-link" onClick={() => onEdit(member.id)}>编辑</button>}{snapshot.conversation.kind === 'group' && member.id !== snapshot.conversation.coordinatorMemberId && <><button className="collab-link" disabled={busy || running} onClick={() => onCommand({ action: 'members', conversationId: snapshot.conversation.id, coordinatorMemberId: member.id })}>设为协调员</button><button className="collab-link" disabled={busy || snapshot.tasks.some(task => task.assigneeMemberId === member.id && snapshot.attempts.some(attempt => attempt.id === task.currentAttemptId && ACTIVE.has(attempt.status)))} title="成员有活动任务时，请先完成或停止其任务" onClick={() => onCommand({ action: 'members', conversationId: snapshot.conversation.id, removeMemberIds: [member.id] })}>移出群聊</button></>}</div></>}</div>)}
    {snapshot.conversation.kind === 'group' && availableTeams.length > 0 && <label className="collab-field">添加小队<TaskSelect aria-label="添加小队" value="" disabled={busy} onChange={event => { if (event.target.value) onCommand({ action: 'members', conversationId: snapshot.conversation.id, addTeamIds: [event.target.value] }); }}><option value="">选择已有小队…</option>{availableTeams.map(team => <option key={team.id} value={team.id}>{team.name} · {team.members.length} 位成员</option>)}</TaskSelect></label>}
    {snapshot.conversation.kind !== 'direct' && available.length > 0 && <label className="collab-field">添加智能体<TaskSelect aria-label="添加智能体" value="" disabled={busy} onChange={(event) => { if (event.target.value) onCommand({ action: 'members', conversationId: snapshot.conversation.id, addAgentIds: [event.target.value] }); }}><option value="">选择智能体…</option>{available.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</TaskSelect></label>}

    </div>
    <div hidden={section !== 'settings'}>
    {snapshot.conversation.kind === 'group' && <GroupConversationSettings key={snapshot.conversation.id} snapshot={snapshot} busy={busy} onCommand={onCommand} />}
      <div className="task-section-intro"><h3>执行边界</h3><p>设置影响后续执行，不改变正在运行的授权范围。</p></div>
      <label className="collab-field">执行权限（文件与网页）<TaskSelect aria-label="任务文件权限" value={permission} disabled={busy || permissionBusy} onChange={e => void changePermission(e.target.value as 'ask' | 'workspace' | 'full-access')}><option value="ask">只读工作区 · 可交付文档</option><option value="workspace">允许工作区操作</option><option value="full-access">完全访问</option></TaskSelect><small>文档由宿主保存为本群成果版本；修改约定工作文件需执行者「继承会话权限」。设置用于后续执行。</small></label>{permissionError && <p role="alert" className="collab-notice">{permissionError}</p>}<label className="collab-toggle"><input type="checkbox" aria-label="允许群聊联网读取" checked={snapshot.conversation.policy.networkEnabled === true} disabled={busy} onChange={event => onCommand({ action: 'policy', conversationId: snapshot.conversation.id, policy: { networkEnabled: event.target.checked } })} /><span>允许群聊联网读取<small>对后续执行生效。读取公开仓库无需本地副本；运行测试或修改文件时另行准备源码。产物仍保存在本群独立目录。</small></span></label>

      <details className="task-advanced"><summary>高级协作设置</summary>    {snapshot.conversation.kind === 'group' && <label className="collab-toggle"><input type="checkbox" checked={snapshot.conversation.policy.allowGroupMessages ?? snapshot.conversation.policy.allowPeerDirect} disabled={busy} onChange={(event) => onCommand({ action: 'policy', conversationId: snapshot.conversation.id, policy: { allowGroupMessages: event.target.checked } })} /><span>允许群内智能体互相咨询<small>仅本群成员间的咨询；关闭后仍可联系协调员。不会开启私聊或跨群共享。旧群可在这里开启。</small></span></label>}
    {snapshot.conversation.kind === 'group' && !snapshot.conversation.room && <label className="collab-toggle"><input type="checkbox" checked={snapshot.conversation.policy.allowPeerDirect} disabled={busy} onChange={(event) => onCommand({ action: 'policy', conversationId: snapshot.conversation.id, policy: { allowPeerDirect: event.target.checked } })} /><span>允许智能体之间发起单聊<small>默认关闭；开启后关联单聊保留在聊天列表中。</small></span></label>}
    <label className="collab-field">任务超时（秒）<input type="number" min={30} max={86400} key={snapshot.conversation.policy.taskTimeoutSeconds} defaultValue={snapshot.conversation.policy.taskTimeoutSeconds} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 30 && value <= 86400 && value !== snapshot.conversation.policy.taskTimeoutSeconds) onCommand({ action: 'policy', conversationId: snapshot.conversation.id, policy: { taskTimeoutSeconds: value } }); }} /></label>
    <label className="collab-field">状态核对间隔（秒）<input type="number" min={10} max={3600} key={snapshot.conversation.policy.statusTimeoutSeconds} defaultValue={snapshot.conversation.policy.statusTimeoutSeconds} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 10 && value <= 3600 && value !== snapshot.conversation.policy.statusTimeoutSeconds) onCommand({ action: 'policy', conversationId: snapshot.conversation.id, policy: { statusTimeoutSeconds: value } }); }} /></label>
</details>
    </div>
    {snapshot.conversation.room && <div hidden={section !== 'schedules'}><div className="task-section-intro"><h3>本群周期任务</h3><p>复用当前会话，不为每次触发创建另一个群聊。</p></div></div>}
    {snapshot.conversation.room && <div hidden={section === 'members'}><GroupBrowserSettings section={section === 'schedules' ? 'schedules' : 'browser'} snapshot={snapshot} busy={busy} onCommand={onCommand} /></div>}
    {editingRole && <Dialog.Root open onOpenChange={open => { if (!open) setEditingRole(undefined); }}><Dialog.Portal><Dialog.Overlay className="task-profile-backdrop" /><Dialog.Content className="task-profile-dialog"><header><div><Dialog.Title>编辑 {editingRole.name} 的职责</Dialog.Title><Dialog.Description>职责帮助协调员分工，不授予额外执行权限。</Dialog.Description></div><Dialog.Close asChild><button type="button" aria-label="关闭职责编辑"><X size={16} /></button></Dialog.Close></header><form onSubmit={event => { event.preventDefault(); if (!roleDraft.trim() || busy) return; onCommand({ action: 'members', conversationId: snapshot.conversation.id, roles: { [editingRole.id]: roleDraft.trim() } }); setEditingRole(undefined); }}><label>职责描述<textarea aria-label={editingRole.name + '的角色'} rows={4} value={roleDraft} onChange={event => setRoleDraft(event.target.value)} /></label><footer><button type="button" onClick={() => setEditingRole(undefined)}>取消</button><button type="submit" disabled={busy || !roleDraft.trim()} className="is-primary">保存职责</button></footer></form></Dialog.Content></Dialog.Portal></Dialog.Root>}
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

function deliveredHandoff(attempt?: CollaborationAttempt) { return attempt?.status === 'succeeded' ? attempt.workHandoff : undefined; }
