import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, AtSign, Check, ChevronRight, ListChecks, Plus, RotateCcw, Square, Users, X } from 'lucide-react';
import type { CollaborationAttempt, CollaborationAttemptStatus, CollaborationCommand, CollaborationMember, CollaborationSnapshot, CollaborationTask, Conversation, GlobalAgent } from '@sync-think/shared';
import { AgentAvatarView } from './AgentAvatarView.js';
import { MarkdownContent } from './MarkdownContent.js';
import { detectMentionQuery, stripMentionToken } from './compose-mention.js';
import { useCollaborationChat } from './use-collaboration-chat.js';
import './collaboration-chat.css';

export const COLLABORATION_STATUS: Record<CollaborationAttemptStatus, string> = {
  queued: '排队中', running: '执行中', waiting_input: '等待处理', stopping: '停止中',
  succeeded: '已完成', failed: '失败', cancelled: '已停止', interrupted: '执行中断',
};
const ACTIVE = new Set<CollaborationAttemptStatus>(['queued', 'running', 'waiting_input', 'stopping']);
const WAIT_REASON: Record<string, string> = { dependency: '等待前置任务', dependency_failed: '前置任务未完成', resource_busy: '等待工作区资源', capacity: '等待执行名额', member_removed: '执行成员已移除', loop_limit: '已达到协作轮数上限' };
type Props = { conversation: Conversation; agents: readonly GlobalAgent[]; active?: boolean; onOpenConversation(id: string): void };

function textOf(message: CollaborationSnapshot['messages'][number]) {
  return message.blocks.filter((block) => block.type === 'text' || block.type === 'error').map((block) => block.text ?? '').join('\n');
}

export function CollaborationChatView({ conversation, agents, active = true, onOpenConversation }: Props) {
  const { snapshot, error, command } = useCollaborationChat(String(conversation.id), active);
  const [draft, setDraft] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [mention, setMention] = useState<ReturnType<typeof detectMentionQuery>>(null);
  const [replyTo, setReplyTo] = useState<string>();
  const [panel, setPanel] = useState<'tasks' | 'members' | null>(null);
  const [selectedTask, setSelectedTask] = useState<string>();
  const [taskDialog, setTaskDialog] = useState(false);
  const [sending, setSending] = useState(false);
  const [operation, setOperation] = useState<string>();
  const sendRequest = useRef<{ key: string; id: string }>();
  const retryRequests = useRef(new Map<string, string>());
  const messageRetryRequests = useRef(new Map<string, string>());
  const busySend = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const members = snapshot?.members ?? [];
  const membersById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const currentAttempts = useMemo(() => new Map(snapshot?.attempts.map((attempt) => [attempt.id, attempt]) ?? []), [snapshot?.attempts]);
  const tasks = snapshot?.tasks ?? [];
  const activity = tasks.filter((task) => ACTIVE.has(currentAttempts.get(task.currentAttemptId)?.status ?? 'succeeded'));
  const failures = tasks.filter((task) => ['failed', 'interrupted'].includes(currentAttempts.get(task.currentAttemptId)?.status ?? ''));
  const chosenTask = tasks.find((task) => task.id === selectedTask);
  const run = async (request: CollaborationCommand, key: string) => {
    setOperation(key);
    try { return await command(request); } catch { return undefined; } finally { setOperation(undefined); }
  };
  useEffect(() => {
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [snapshot?.revision]);

  const send = async () => {
    if (!draft.trim() || busySend.current) return;
    const text = draft;
    const key = JSON.stringify([text, recipients, replyTo]);
    if (sendRequest.current?.key !== key) sendRequest.current = { key, id: crypto.randomUUID() };
    busySend.current = true;
    setSending(true);
    try {
      await command({ action: 'send', conversationId: String(conversation.id), clientRequestId: sendRequest.current.id, text, recipientMemberIds: recipients, replyToMessageId: replyTo });
      setDraft((current) => current === text ? '' : current);
      setRecipients([]); setReplyTo(undefined); sendRequest.current = undefined;
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
  const toggleRecipient = (memberId: string) => setRecipients((current) => current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]);

  return <div className="collab-chat" data-testid="collaboration-chat">
    <div className="collab-chat__main">
      <header className="collab-chat__header">
        <div><strong>{snapshot?.conversation.title ?? conversation.title}</strong><span className="collab-chat__subtitle">{snapshot?.conversation.kind === 'model' ? '模型对话 · 子智能体协作' : snapshot?.conversation.kind === 'direct' ? '智能体单聊' : '智能体群聊'}</span></div>
        <button className="collab-pill" onClick={() => setPanel((value) => value === 'members' ? null : 'members')} aria-pressed={panel === 'members'}><Users size={15} />成员 {members.filter((member) => member.active).length || ''}</button>
      </header>
      <div className="collab-chat__summary">
        <button className="collab-pill" onClick={() => { setPanel('tasks'); setSelectedTask(undefined); }}><ListChecks size={14} />{activity.length ? `活动任务 ${activity.length}` : tasks.length ? '执行已结束' : '当前无任务'}{failures.length ? ` · 失败 ${failures.length}` : ''}<ChevronRight size={13} /></button>
        {snapshot?.conversation.parentConversationId && <button className="collab-pill" onClick={() => onOpenConversation(snapshot.conversation.parentConversationId!)}><ArrowLeft size={13} />返回关联会话</button>}
      </div>
      {error && <div className="collab-notice" role="alert">{error}<button className="collab-pill" onClick={() => void run({ action: 'get', conversationId: String(conversation.id) }, 'refresh')}>重新连接</button></div>}
      <div className="collab-chat__messages" ref={viewport} onScroll={() => { const el = viewport.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70; }}>
        {!snapshot ? <p className="collab-empty" role="status">正在加载会话…</p> : snapshot.messages.length === 0 ? <div className="collab-empty"><strong>从一条消息开始协作</strong><p>{snapshot.conversation.kind === 'model' ? '与模型对话，或点击「调用智能体」分配独立任务。' : snapshot.conversation.kind === 'group' ? '直接发消息由协调员处理；@ 成员可指定接收者，也可以创建并行任务。' : '消息与任务都保留在这里。任务执行时仍可继续聊天。'}</p></div> : null}
        {snapshot?.messages.map((message) => {
          const sender = membersById.get(message.senderMemberId);
          const associated = tasks.filter((task) => task.originMessageId === message.id);
          const deliveries = snapshot.deliveries.filter((delivery) => delivery.messageId === message.id);
          const quoted = message.replyToMessageId ? snapshot.messages.find((item) => item.id === message.replyToMessageId) : undefined;
          return <article key={message.id} className={`collab-message ${sender?.kind === 'user' ? 'is-user' : ''} ${message.kind === 'system' ? 'is-system' : ''}`} data-message-id={message.id}>
            <div className="collab-message__identity"><AgentAvatarView name={sender?.name ?? '系统'} avatar={sender?.avatar} size={26} /><strong>{sender?.name ?? '系统'}</strong><span>{sender?.role}</span>{message.kind === 'task_result' && <span className="collab-tag">任务结果</span>}<time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
            {quoted && <button className="collab-message__quote" onClick={() => viewport.current?.querySelector(`[data-message-id="${CSS.escape(quoted.id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}>回复：{textOf(quoted).slice(0, 100)}</button>}
            {message.contextRefs?.map((reference) => <button className="collab-message__quote" key={`${reference.conversationId}:${reference.messageId}`} onClick={() => onOpenConversation(reference.conversationId)}>查看关联群聊消息</button>)}
            {message.recipientMemberIds.length > 0 && <div className="collab-message__recipients">{message.recipientMemberIds.map((id) => <span key={id}>@{membersById.get(id)?.name ?? '已离开的成员'}</span>)}</div>}
            {textOf(message) && <div className="collab-message__body"><MarkdownContent text={textOf(message)} /></div>}
            {associated.map((task) => <TaskCard key={task.id} task={task} attempt={currentAttempts.get(task.currentAttemptId)} member={membersById.get(task.assigneeMemberId)} onOpen={() => { setSelectedTask(task.id); setPanel('tasks'); }} />)}
            <div className="collab-message__actions">
              <button className="collab-link" onClick={() => { setReplyTo(message.id); input.current?.focus(); }}>回复</button>
              {message.taskId && <button className="collab-link" onClick={() => { setSelectedTask(message.taskId); setPanel('tasks'); }}>查看任务</button>}
              {deliveries.length > 0 && <span>{deliveries.some((item) => item.status === 'failed') ? '消息处理失败 · 任务中查看原因' : deliveries.every((item) => item.status === 'processed') ? '已处理' : deliveries.some((item) => item.status === 'processing') ? '处理中' : '已发送'}</span>}
              {deliveries.some((item) => item.status === 'failed') && <button className="collab-link" disabled={operation === `message:${message.id}`} onClick={() => retryMessage(message.id)}>重新投递</button>}
            </div>
          </article>;
        })}
        {snapshot?.attempts.filter((attempt) => ACTIVE.has(attempt.status) && attempt.output).map((attempt) => {
          const task = tasks.find((item) => item.id === attempt.taskId);
          const member = task ? membersById.get(task.assigneeMemberId) : undefined;
          return <article className="collab-message" key={`stream:${attempt.id}`} data-testid={`collaboration-stream-${attempt.id}`}><div className="collab-message__identity"><AgentAvatarView name={member?.name ?? '智能体'} avatar={member?.avatar} size={26} /><strong>{member?.name}</strong><span>{task?.title} · {COLLABORATION_STATUS[attempt.status]}</span></div><MarkdownContent text={attempt.output} streaming /></article>;
        })}
      </div>
      <form className="collab-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        {replyTo && <div className="collab-composer__reference">回复：{snapshot?.messages.find((item) => item.id === replyTo)?.blocks[0]?.text?.slice(0, 80)}<button type="button" className="collab-pill" aria-label="取消回复" onClick={() => setReplyTo(undefined)}><X size={12} /></button></div>}
        {recipients.length > 0 && <div className="collab-composer__recipients">{recipients.map((id) => <button type="button" className="collab-pill is-selected" key={id} onClick={() => toggleRecipient(id)}>@{membersById.get(id)?.name}<X size={12} /></button>)}</div>}
        {mention && <div className="collab-mention" role="listbox" aria-label="选择接收成员">{members.filter((member) => member.active && member.kind !== 'user' && member.name.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase())).map((member) => <button type="button" role="option" aria-selected={recipients.includes(member.id)} key={member.id} onClick={() => { setRecipients((current) => current.includes(member.id) ? current : [...current, member.id]); const next = stripMentionToken(draft, mention); setDraft(next.text); setMention(null); input.current?.focus(); }}><AgentAvatarView name={member.name} avatar={member.avatar} size={22} />{member.name}<span>{member.role}</span></button>)}</div>}
        <textarea ref={input} aria-label="协作消息" placeholder={snapshot?.conversation.kind === 'model' ? '继续与模型对话…' : '输入消息，@ 指定成员…'} value={draft} onChange={(event) => { setDraft(event.target.value); setMention(detectMentionQuery(event.target.value, event.target.selectionStart)); }} onKeyDown={(event) => { if (event.key === 'Escape') setMention(null); if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !mention) { event.preventDefault(); void send(); } }} />
        <div className="collab-composer__toolbar"><button type="button" className="collab-pill" onClick={() => { setMention({ atIndex: draft.length, caret: draft.length, query: '' }); input.current?.focus(); }}><AtSign size={15} />成员</button><button type="button" className="collab-pill" disabled={!snapshot} onClick={() => setTaskDialog(true)}><Plus size={15} />{snapshot?.conversation.kind === 'model' ? '调用智能体' : '创建任务'}</button><span className="collab-composer__hint">{snapshot?.conversation.kind === 'group' && !recipients.length ? '发送给协调员' : '任务执行时可继续发送'}</span><button type="submit" className="collab-send" aria-label="发送消息" disabled={!draft.trim() || sending || !snapshot}><ArrowUp size={18} /></button></div>
      </form>
    </div>
    {panel && snapshot && <aside className="collab-panel" aria-label={panel === 'tasks' ? '执行详情' : '会话成员'}><header><strong>{panel === 'members' ? '会话成员' : chosenTask ? '任务详情' : '任务执行'}</strong><button className="collab-pill" onClick={() => setPanel(null)} aria-label="关闭详情"><X size={15} /></button></header>
      {panel === 'members' ? <MembersPanel snapshot={snapshot} agents={agents} busy={Boolean(operation)} onCommand={(request) => void run(request, 'members')} onDirect={openDirect} /> : chosenTask ? <TaskDetail task={chosenTask} attempts={snapshot.attempts.filter((attempt) => attempt.taskId === chosenTask.id)} member={membersById.get(chosenTask.assigneeMemberId)} busy={operation === chosenTask.id} onBack={() => setSelectedTask(undefined)} onCancel={() => void run({ action: 'cancel', conversationId: String(conversation.id), taskId: chosenTask.id }, chosenTask.id)} onRetry={() => retry(chosenTask)} /> : <div className="collab-panel__body">{tasks.length === 0 ? <p className="collab-empty">这里会保留本会话的任务与执行历史。</p> : tasks.map((task) => <TaskCard key={task.id} task={task} attempt={currentAttempts.get(task.currentAttemptId)} member={membersById.get(task.assigneeMemberId)} onOpen={() => setSelectedTask(task.id)} />)}</div>}
    </aside>}
    {taskDialog && snapshot && <CreateTaskDialog snapshot={snapshot} onClose={() => setTaskDialog(false)} onCreate={async (request) => { const response = await run(request, 'dispatch'); if (response) { setTaskDialog(false); setPanel('tasks'); } }} />}
  </div>;
}

function TaskCard({ task, attempt, member, onOpen }: { task: CollaborationTask; attempt?: CollaborationAttempt; member?: CollaborationMember; onOpen(): void }) {
  return <button className="collab-task-card" onClick={onOpen}><span className="collab-task-card__title"><AgentAvatarView name={member?.name ?? '智能体'} avatar={member?.avatar} size={22} /><strong>{task.title}</strong><ChevronRight size={14} /></span><span className="collab-task-card__meta">{member?.name} · <span data-status={attempt?.status}>{attempt ? COLLABORATION_STATUS[attempt.status] : '准备中'}</span>{attempt && ` · 第 ${attempt.number} 次执行`}</span>{task.planRef && <span className="collab-task-card__meta">计划 v{task.planRef.revision}{task.planRef.stepId ? ` · ${task.planRef.stepId}` : ''}</span>}{attempt?.waitReason && <span className="collab-task-card__meta">{WAIT_REASON[attempt.waitReason]}</span>}{attempt?.observation === 'status_unconfirmed' && <span className="collab-task-card__meta">状态待确认，正在核对运行情况</span>}{attempt?.error && <span className="collab-task-card__error">{attempt.error.message}</span>}</button>;
}

function TaskDetail({ task, attempts, member, busy, onBack, onCancel, onRetry }: { task: CollaborationTask; attempts: CollaborationAttempt[]; member?: CollaborationMember; busy: boolean; onBack(): void; onCancel(): void; onRetry(): void }) {
  const [tab, setTab] = useState<'checklist' | 'result' | 'history'>('checklist');
  const [attemptId, setAttemptId] = useState(task.currentAttemptId);
  useEffect(() => setAttemptId(task.currentAttemptId), [task.id, task.currentAttemptId]);
  const attempt = attempts.find((item) => item.id === attemptId) ?? attempts.at(-1);
  const current = attempts.find((item) => item.id === task.currentAttemptId);
  return <div className="collab-panel__body"><button className="collab-link" onClick={onBack}><ArrowLeft size={14} />所有任务</button><h3>{task.title}</h3><p className="collab-muted">{member?.name} · {current && COLLABORATION_STATUS[current.status]}</p>{task.planRef && <p className="collab-muted">关联计划：{task.planRef.planId} v{task.planRef.revision}{task.planRef.stepId ? ` · ${task.planRef.stepId}` : ''}</p>}<p>{task.instructions}</p>{task.expectedOutput && <p className="collab-muted">预期结果：{task.expectedOutput}</p>}
    <div className="collab-toolbar">{current && ACTIVE.has(current.status) ? <button className="collab-pill" disabled={busy || current.status === 'stopping'} onClick={onCancel}><Square size={12} />{current.status === 'stopping' ? '停止中' : '停止当前任务'}</button> : <button className="collab-pill" disabled={busy} onClick={onRetry}><RotateCcw size={13} />重新执行</button>}</div>
    {attempts.length > 1 && <label className="collab-field">执行记录<select value={attempt?.id} onChange={(event) => setAttemptId(event.target.value)}>{attempts.map((item) => <option key={item.id} value={item.id}>第 {item.number} 次 · {COLLABORATION_STATUS[item.status]}</option>)}</select></label>}
    {attempt?.error && <div className="collab-notice" role="status">{attempt.error.message}<small>{attempt.error.category} · {attempt.error.code}</small></div>}
    <div className="collab-tabs" role="tablist" aria-label="任务详情内容">{([['checklist', '清单'], ['result', '结果'], ['history', '记录']] as const).map(([id, label]) => <button className="collab-pill" role="tab" aria-selected={tab === id} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === 'checklist' && (attempt?.checklist.length ? <ul className="collab-checklist">{attempt.checklist.map((item) => <li key={item.id}><span>{item.status === 'completed' ? <Check size={14} /> : item.status === 'in_progress' ? '◉' : '○'}</span>{item.text}</li>)}</ul> : <p className="collab-muted">该执行尚未提交任务清单。</p>)}
    {tab === 'result' && (attempt?.output ? <MarkdownContent text={attempt.output} streaming={ACTIVE.has(attempt.status)} /> : <p className="collab-muted">{current && ACTIVE.has(current.status) ? '结果将在执行后展示。' : '本次执行没有返回文本，执行记录已保留。'}</p>)}
    {tab === 'history' && <div className="collab-tool-list"><p className="collab-muted">{attempt?.startedAt ? `开始于 ${new Date(attempt.startedAt).toLocaleString()}` : '尚未开始'}{attempt?.finishedAt ? ` · 结束于 ${new Date(attempt.finishedAt).toLocaleString()}` : ''}</p>{attempt?.tools.map((tool) => <details key={tool.id} open={tool.status === 'running'}><summary>{tool.name} · {tool.status === 'running' ? '执行中' : tool.status === 'failed' ? '失败' : '已完成'}</summary><pre aria-label="执行命令">{tool.arguments || '无参数'}</pre>{tool.result && <pre>{tool.result}</pre>}</details>)}{!attempt?.tools.length && <p className="collab-muted">暂无工具调用。</p>}</div>}
  </div>;
}

function MembersPanel({ snapshot, agents, busy, onCommand, onDirect }: { snapshot: CollaborationSnapshot; agents: readonly GlobalAgent[]; busy: boolean; onCommand(request: CollaborationCommand): void; onDirect(member: CollaborationMember): void }) {
  const activeMembers = snapshot.members.filter((member) => member.active);
  const available = agents.filter((agent) => !agent.archived && agent.enabled !== false && !activeMembers.some((member) => member.agentId === agent.id));
  return <div className="collab-panel__body"><p className="collab-muted">成员角色只描述分工，工具权限仍受会话与智能体配置约束。</p>{activeMembers.map((member) => <div className="collab-member" key={member.id}><div className="collab-member__identity"><AgentAvatarView name={member.name} avatar={member.avatar} size={30} /><strong>{member.name}</strong>{member.id === snapshot.conversation.coordinatorMemberId && <span className="collab-tag">协调员</span>}</div>{member.kind !== 'user' && <><input aria-label={`${member.name}的角色`} defaultValue={member.role} key={`${member.id}:${member.role}`} onBlur={(event) => { if (event.target.value.trim() !== member.role) onCommand({ action: 'members', conversationId: snapshot.conversation.id, roles: { [member.id]: event.target.value.trim() } }); }} /><div className="collab-toolbar"><button className="collab-link" disabled={busy} onClick={() => onDirect(member)}>打开单聊</button>{snapshot.conversation.kind === 'group' && member.id !== snapshot.conversation.coordinatorMemberId && <><button className="collab-link" disabled={busy} onClick={() => onCommand({ action: 'members', conversationId: snapshot.conversation.id, coordinatorMemberId: member.id })}>设为协调员</button><button className="collab-link" disabled={busy} onClick={() => onCommand({ action: 'members', conversationId: snapshot.conversation.id, removeMemberIds: [member.id] })}>移出群聊</button></>}</div></>}</div>)}
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
  const [timeout, setTimeoutSeconds] = useState(snapshot.conversation.policy.taskTimeoutSeconds);
  const [busy, setBusy] = useState(false);
  const receipt = useRef<{ key: string; id: string }>();
  return <div className="collab-modal-backdrop"><form className="collab-modal" role="dialog" aria-modal="true" aria-label="创建智能体任务" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }} onSubmit={(event) => { event.preventDefault(); if (!selected.length || busy) return; const tasks = selected.map((assigneeMemberId) => ({ assigneeMemberId, title: title.trim(), instructions: instructions.trim(), expectedOutput: expected.trim(), timeoutSeconds: timeout })); const key = JSON.stringify(tasks); if (receipt.current?.key !== key) receipt.current = { key, id: crypto.randomUUID() }; setBusy(true); void onCreate({ action: 'dispatch', conversationId: snapshot.conversation.id, clientRequestId: receipt.current.id, tasks }).finally(() => setBusy(false)); }}><header><strong>{snapshot.conversation.kind === 'model' ? '调用子智能体' : '创建任务'}</strong><button type="button" className="collab-pill" onClick={onClose} disabled={busy} aria-label="关闭任务创建"><X size={15} /></button></header><p className="collab-muted">选择多个执行者时，各自独立执行并返回结果。</p><div className="collab-member-options">{snapshot.members.filter((member) => member.active && member.kind === 'agent').map((member) => <button type="button" className={`collab-pill ${selected.includes(member.id) ? 'is-selected' : ''}`} aria-pressed={selected.includes(member.id)} key={member.id} onClick={() => setSelected((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])}><AgentAvatarView name={member.name} avatar={member.avatar} size={20} />{member.name}</button>)}</div>{!snapshot.members.some((member) => member.active && member.kind === 'agent') && <p className="collab-muted">先在「成员」中添加可用智能体。</p>}<label className="collab-field">任务标题<input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="collab-field">任务说明<textarea required value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label><label className="collab-field">预期结果<input value={expected} onChange={(event) => setExpected(event.target.value)} /></label><label className="collab-field">超时（秒）<input type="number" min={30} max={86400} required value={timeout} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} /></label><footer><button className="collab-pill" type="button" onClick={onClose} disabled={busy}>取消</button><button className="collab-pill is-selected" type="submit" disabled={busy || !selected.length || !title.trim() || !instructions.trim()}>{busy ? '正在创建…' : `开始执行${selected.length > 1 ? `（${selected.length} 个任务）` : ''}`}</button></footer></form></div>;
}
