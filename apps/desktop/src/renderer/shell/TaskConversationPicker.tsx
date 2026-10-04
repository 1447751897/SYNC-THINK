import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, MessageSquare, Plus, Search, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Conversation, ScheduledTaskConversationTarget } from '@sync-think/shared';
import type { WorkspaceSummary } from '@sync-think/protocol';
import './task-conversation-picker.css';
import { useTaskSheetPortalContainer } from './TaskSheet.js';

export function TaskConversationPicker({ value, workspaceId, workspaces, onChange }: {
  value?: ScheduledTaskConversationTarget;
  workspaceId?: string;
  workspaces: readonly WorkspaceSummary[];
  onChange(value: ScheduledTaskConversationTarget, conversation?: Conversation): void;
}) {
  const portalContainer = useTaskSheetPortalContainer();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [inboxWorkspaceIds, setInboxWorkspaceIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const mode = value?.mode ?? 'task';
  useEffect(() => {
    if (!open && mode !== 'existing') return;
    const api = window.syncThink?.runtime;
    if (!api?.listConversations) { setError('Runtime 未连接，暂时没有会话列表'); return; }
    let disposed = false;
    setLoading(true); setError('');
    void Promise.all([
      api.listConversations({ includeArchived: false }),
      !workspaceId && api.listWorkspaces ? api.listWorkspaces() : Promise.resolve({ workspaces: [] }),
    ]).then(([result, scopes])=>{
      if (!disposed) {
        setConversations(result.conversations.filter(c=>!c.archivedAt && (c.track !== 'team' || c.collaborationKind === 'group')));
        setInboxWorkspaceIds(scopes.workspaces.filter(scope=>scope.name==='__inbox__').map(scope=>scope.workspaceId));
      }
    }).catch(()=>{if(!disposed)setError('会话列表加载失败，请重试');}).finally(()=>{if(!disposed)setLoading(false);});
    return ()=>{disposed=true;};
  }, [open, mode, revision, workspaceId]);
  const selected = value?.mode === 'existing' ? conversations.find(c=>c.id===value.conversationId) : undefined;
  const options = useMemo(()=>conversations.filter(c=>
    (c.workspaceId === workspaceId || !workspaceId && (!c.workspaceId || inboxWorkspaceIds.includes(c.workspaceId))) &&
    `${c.title} ${workspaces.find(w=>w.workspaceId===c.workspaceId)?.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
  ).sort((a,b)=>Number(Boolean(b.pinnedAt))-Number(Boolean(a.pinnedAt)) || b.updatedAt.localeCompare(a.updatedAt)),[conversations,workspaceId,query,workspaces,inboxWorkspaceIds]);
  const label = mode==='new' ? '每次运行时新建会话' : mode==='existing' ? selected?.title || '已选已有会话' : '此任务的专属会话';
  const pick = (target: ScheduledTaskConversationTarget, conversation?: Conversation) => {
    // Runtime's internal inbox is the global scope, not a selectable workspace.
    onChange(target, conversation?.workspaceId && inboxWorkspaceIds.includes(conversation.workspaceId) ? { ...conversation, workspaceId: undefined } : conversation);
    setOpen(false); setQuery('');
  };
  return <div className="task-run-target">
    <Menu.Root modal={false} open={open} onOpenChange={setOpen}>
      <Menu.Trigger asChild><button type="button" className="task-editor__select-box" aria-label="运行会话"><span className="task-editor__select-value"><MessageSquare size={16}/><span className="task-editor__select-label">{label}</span></span><ChevronDown size={14}/></button></Menu.Trigger>
      <Menu.Portal container={portalContainer}><Menu.Content className="task-run-target__menu" align="start" sideOffset={6} collisionPadding={12} onCloseAutoFocus={()=>setQuery('')}>
        <div className="task-run-target__search"><Search size={14}/><input placeholder="搜索聊天" aria-label="搜索运行会话" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape')setOpen(false);}}/></div>
        <Menu.Item className="task-run-target__item" onSelect={()=>pick({mode:'new'})}><Plus size={16}/><span>每次运行时新建会话</span>{mode==='new'&&<Check size={14}/>}</Menu.Item>
        <Menu.Item className="task-run-target__item" onSelect={()=>pick({mode:'task'})}><Plus size={16}/><span>此任务的专属会话</span>{mode==='task'&&<Check size={14}/>}</Menu.Item>
        <Menu.Separator className="task-run-target__separator"/>
        <Menu.Label className="task-run-target__group">{workspaceId ? workspaces.find(w=>w.workspaceId===workspaceId)?.name ?? '所选工作区' : '不绑定工作区'} · 已有会话</Menu.Label>
        <div className="task-run-target__list">
          {loading ? <p role="status"><LoaderCircle size={14} className="shell-process-spin"/> 加载会话…</p> : error ? <div role="alert">{error}<button type="button" onClick={()=>setRevision(n=>n+1)}>重试</button></div> : options.length===0 ? <p>没有匹配的会话</p> : options.map(conversation=><Menu.Item key={conversation.id} className="task-run-target__item" onSelect={()=>pick({mode:'existing',conversationId:conversation.id},conversation)}><MessageSquare size={15}/><span><strong>{conversation.title||'未命名会话'}</strong><small>{new Date(conversation.updatedAt).toLocaleDateString('zh-CN')} · {conversation.track==='model'?'模型':conversation.track==='agent'?'智能体':'小队'}</small></span>{value?.mode==='existing'&&value.conversationId===conversation.id&&<Check size={14}/>}</Menu.Item>)}
        </div>
      </Menu.Content></Menu.Portal>
    </Menu.Root>
    <small className="task-run-target__hint">{mode==='new' ? '每轮从新上下文开始；浏览器登录资料继续保留。' : mode==='existing' ? '接着已有上下文执行；运行前校验工作区、执行者及会话状态。' : '首次创建任务会话，后续运行在同一会话中继续。'}</small>
  </div>;
}
