import { useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, MoreHorizontal, Plus, X } from 'lucide-react';
import type { AgentWorkspaceContact } from './agent-workspace-contacts.js';
import { readChatFolders, removeChatFolder, writeChatFolders, type ChatFolders } from './chat-folders.js';
import './chat-folders.css';

function FolderIcon({ create = false }: { create?: boolean }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" />{create && <path d="M12 10v6m-3-3h6" />}</svg>;
}
type RoomContact = Extract<AgentWorkspaceContact, { kind: 'group' }>;
type Edit = { kind: 'create'; chatId?: string } | { kind: 'rename'; id: string } | { kind: 'delete'; id: string };
export default function GroupChatFolders({ scope, contacts, searchTerm, onCreateChat, renderContact }: {
  scope: string; contacts: readonly RoomContact[]; searchTerm: string;
  onCreateChat(): void; renderContact(contact: RoomContact, folderMenu?: ReactNode): ReactNode;
}) {
  const [state, setState] = useState(() => readChatFolders(scope));
  const [edit, setEdit] = useState<Edit>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [menuFolderId, setMenuFolderId] = useState<string>();
  const update = (change: (current: ChatFolders) => ChatFolders) => {
    const next = change(state);
    setState(next);
    setStorageError(writeChatFolders(scope, next) ? '' : '分组本次已生效，但保存失败；重新打开前请检查本地存储空间。');
  };
  const startEdit = (next: Edit) => { setEdit(next); setName(next.kind === 'rename' ? state.folders.find(folder => folder.id === next.id)?.name ?? '' : ''); setError(''); };
  const move = (chatId: string, folderId?: string) => update(current => {
    const assignments = { ...current.assignments };
    if (folderId) assignments[chatId] = folderId; else delete assignments[chatId];
    return { ...current, assignments };
  });
  const confirm = () => {
    if (!edit) return;
    if (edit.kind === 'delete') { update(current => removeChatFolder(current, edit.id)); setEdit(undefined); return; }
    const trimmed = name.trim();
    if (!trimmed) { setError('请输入分组名称'); return; }
    if (trimmed.length > 40) { setError('分组名称最多 40 个字符'); return; }
    if (state.folders.some(folder => folder.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase() && (edit.kind !== 'rename' || folder.id !== edit.id))) { setError('已有同名分组，请换一个名称'); return; }
    if (edit.kind === 'rename') update(current => ({ ...current, folders: current.folders.map(folder => folder.id === edit.id ? { ...folder, name: trimmed } : folder) }));
    else {
      const id = crypto.randomUUID();
      update(current => ({ folders: [...current.folders, { id, name: trimmed, collapsed: false }], assignments: edit.chatId ? { ...current.assignments, [edit.chatId]: id } : current.assignments }));
    }
    setEdit(undefined);
  };
  const row = (contact: RoomContact) => renderContact(contact, <Menu.Sub>
    <Menu.SubTrigger>移动到分组</Menu.SubTrigger>
    <Menu.Portal><Menu.SubContent className="aw-menu" sideOffset={6}>
      <Menu.Item onSelect={() => move(contact.conversation.id)}>未分组{!state.assignments[contact.conversation.id] ? ' ✓' : ''}</Menu.Item>
      {state.folders.map(folder => <Menu.Item key={folder.id} onSelect={() => move(contact.conversation.id, folder.id)}>{folder.name}{state.assignments[contact.conversation.id] === folder.id ? ' ✓' : ''}</Menu.Item>)}
      <Menu.Separator /><Menu.Item onSelect={() => startEdit({ kind: 'create', chatId: contact.conversation.id })}>新建分组并移入…</Menu.Item>
    </Menu.SubContent></Menu.Portal>
  </Menu.Sub>);
  const loose = contacts.filter(contact => !state.assignments[contact.conversation.id]);
  return <section aria-label="群聊列表">
    <div className="aw-section-heading"><span>群聊</span><div className="aw-folder-tools"><button type="button" className="aw-icon" aria-label="创建群聊分组" title="创建分组" onClick={() => startEdit({ kind: 'create' })}><FolderIcon create /></button><button type="button" className="aw-icon" aria-label="新建群聊" title="新建群聊" onClick={onCreateChat}><Plus size={15} /></button></div></div>
    {storageError && <p className="aw-section-hint" role="alert">{storageError}</p>}
    {state.folders.map(folder => {
      const children = contacts.filter(contact => state.assignments[contact.conversation.id] === folder.id);
      if (searchTerm && !children.length) return null;
      const expanded = Boolean(searchTerm) || !folder.collapsed;
      return <section key={folder.id} className="aw-chat-folder" aria-label={`${folder.name}分组`}>
        <div className="aw-chat-folder__heading">
          <button type="button" className="aw-chat-folder__toggle" aria-expanded={expanded} aria-label={`${expanded ? '折叠' : '展开'}分组：${folder.name}`} onClick={() => update(current => ({ ...current, folders: current.folders.map(item => item.id === folder.id ? { ...item, collapsed: !item.collapsed } : item) }))}><ChevronDown size={13} className={expanded ? '' : 'is-collapsed'} /><FolderIcon /><span>{folder.name}</span><small>{children.length}</small></button>
          <Menu.Root modal={false} open={menuFolderId === folder.id} onOpenChange={open => setMenuFolderId(open ? folder.id : undefined)}><Menu.Trigger asChild><button className="aw-icon" type="button" aria-label={`${folder.name}分组的选项`} onClick={() => { if (menuFolderId !== folder.id) setMenuFolderId(folder.id); }}><MoreHorizontal size={14} /></button></Menu.Trigger><Menu.Portal><Menu.Content className="aw-menu" side="right" align="start" onCloseAutoFocus={event => event.preventDefault()}><Menu.Item onSelect={() => startEdit({ kind: 'rename', id: folder.id })}>重命名分组</Menu.Item><Menu.Item onSelect={() => startEdit({ kind: 'delete', id: folder.id })}>删除分组</Menu.Item></Menu.Content></Menu.Portal></Menu.Root>
        </div>
        {expanded && <div className="aw-chat-folder__items">{children.map(row)}{!children.length && <p className="aw-section-hint">通过群聊的「⋯ → 移动到分组」添加。</p>}</div>}
      </section>;
    })}
    {state.folders.length > 0 && loose.length > 0 && <div className="aw-folder-loose-label">未分组</div>}
    {loose.map(row)}
    {!contacts.length && !state.folders.length && <p className="aw-section-hint">{searchTerm ? '没有匹配的群聊' : '邀请小队或选择成员，创建独立群聊。'}</p>}
    {contacts.length > 1 && <p className="aw-section-hint">切换群聊只切换查看，后台任务继续执行。</p>}
    <Dialog.Root open={Boolean(edit)} onOpenChange={open => { if (!open) setEdit(undefined); }}><Dialog.Portal><Dialog.Overlay className="aw-dialog-overlay" /><Dialog.Content className="aw-folder-dialog" onOpenAutoFocus={event => { if (edit?.kind === 'delete') event.preventDefault(); }}><Dialog.Title>{edit?.kind === 'delete' ? '删除分组' : edit?.kind === 'rename' ? '重命名分组' : '创建群聊分组'}</Dialog.Title><Dialog.Description>{edit?.kind === 'delete' ? '仅删除这个分组，群聊会回到「未分组」。聊天记录、成员和正在执行的工作都保持不变。' : '分组只整理当前工作区的群聊，不改变小队配置或后台工作。'}</Dialog.Description><Dialog.Close asChild><button className="aw-icon aw-folder-dialog__close" aria-label="关闭分组弹窗"><X size={16} /></button></Dialog.Close>
      <form onSubmit={event => { event.preventDefault(); confirm(); }}>
        {edit?.kind !== 'delete' && <label>分组名称<input aria-label="分组名称" value={name} maxLength={40} placeholder="例如：小说组、视频组" onChange={event => { setName(event.target.value); setError(''); }} /></label>}
        {error && <p role="alert">{error}</p>}
        <div className="aw-folder-dialog__actions"><button type="button" className="aw-text-button" onClick={() => setEdit(undefined)}>取消</button><button type="submit" className="aw-primary" onClick={event => { event.preventDefault(); confirm(); }}>{edit?.kind === 'delete' ? '确认删除分组' : '保存分组'}</button></div>
      </form>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}

