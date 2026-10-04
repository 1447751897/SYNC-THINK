import { MessageSquarePlus, Search } from 'lucide-react';
import type { Ref } from 'react';
import './sidebar-chat-actions.css';

/** Both sidebar modes share these controls; only their callbacks differ. */
export function SidebarChatActions({ onSearch, onNewConversation, searchLabel = '搜索', newConversationLabel = '新建对话', searching }: {
  onSearch(): void;
  onNewConversation(): void;
  searchLabel?: string;
  newConversationLabel?: string;
  searching?: boolean;
}) {
  return <div className="shell-sidebar-actions sidebar-chat-actions">
    <button type="button" data-testid="nav-search" className="sidebar-chat-action sidebar-chat-action--search st-press-motion st-nav-item text-text" title="搜索" aria-label={searchLabel} aria-pressed={searching} onClick={onSearch}>
      <span className="st-nav-icon"><Search size={15} /></span><span>搜索</span>
    </button>
    <button type="button" data-testid="nav-new-chat" className="sidebar-chat-action sidebar-chat-action--new st-press-motion st-nav-item text-text" title="新建对话" aria-label={newConversationLabel} onClick={onNewConversation}>
      <span className="st-nav-icon"><MessageSquarePlus size={15} /></span><span>新建对话</span>
    </button>
  </div>;
}

export function SidebarChatSearch({ value, onChange, onEmptyBlur, onClose, inputRef, autoFocus, label = '搜索对话', placeholder = '搜索对话…' }: {
  value: string;
  onChange(value: string): void;
  onEmptyBlur(): void;
  onClose(): void;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  label?: string;
  placeholder?: string;
}) {
  return <div className="sidebar-chat-search">
    <Search size={12} aria-hidden="true" />
    <input ref={inputRef} data-testid="sidebar-search" type="search" aria-label={label} autoFocus={autoFocus} value={value} placeholder={placeholder}
      onChange={event => onChange(event.target.value)} onBlur={() => { if (!value) onEmptyBlur(); }}
      onKeyDown={event => { if (event.key === 'Escape') { onClose(); } }} />
  </div>;
}
