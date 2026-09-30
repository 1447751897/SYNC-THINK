import { useState, type DragEvent } from 'react';
import { Bot, Check, MessageSquare, Search, Users, X } from 'lucide-react';
import type { Conversation, ConversationTrack } from '@sync-think/shared';
const TRACK_TAB_ICON = { model: MessageSquare, agent: Bot, team: Users };
const TRACK_TAB_LABEL: Record<ConversationTrack, string> = {
  model: '模型',
  agent: '智能体',
  team: '小队',
};
export interface PaneConversationManagerProps {
  conversations: readonly Conversation[];
  activeId?: string;
  paneSuffix: string;
  onSelect(id: string): void;
  onClose(id: string): void;
  onClosePane?(): void;
  onDismiss(): void;
  onDragStart(event: DragEvent<HTMLDivElement>, id: string): void;
  onDragEnd(): void;
}
/** Loaded only when the pane's advanced controls are opened. */
export default function PaneConversationManager(props: PaneConversationManagerProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const managedTabs = props.conversations.filter(
    (conversation) =>
      !normalizedQuery ||
      (conversation.title?.trim() || '新对话').toLocaleLowerCase().includes(normalizedQuery),
  );
  return (
    <>
      <div className="shell-tab-manager__header">
        <strong>对话标签</strong>
        <span>{props.conversations.length}</span>
      </div>
      <label className="shell-tab-manager__search">
        <Search size={13} aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索已打开的对话"
          placeholder="搜索已打开的对话"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </label>
      <div className="shell-tab-manager__list">
        {managedTabs.length > 0 ? (
          managedTabs.map((conversation) => {
            const id = String(conversation.id);
            const label = conversation.title?.trim() || '新对话';
            const active = id === props.activeId;
            const Icon = TRACK_TAB_ICON[conversation.track] ?? MessageSquare;
            return (
              <div
                key={id}
                className="shell-tab-manager__row"
                data-testid={`pane-conversation-${id}`}
                draggable
                onDragStart={(event) => props.onDragStart(event, id)}
                onDragEnd={props.onDragEnd}
                data-active={active ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className="shell-tab-manager__select"
                  aria-label={`切换到 ${label}`}
                  onClick={() => {
                    props.onDismiss();
                    props.onSelect(id);
                  }}
                >
                  <Icon size={13} />
                  <span title={label}>{label}</span>
                  <small>{TRACK_TAB_LABEL[conversation.track]}</small>
                  {active ? <Check size={13} /> : null}
                </button>
                <button
                  type="button"
                  className="shell-tab-manager__close"
                  aria-label={`关闭标签 ${label}`}
                  title={`关闭 ${label}`}
                  onClick={() => props.onClose(id)}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })
        ) : (
          <div className="shell-tab-manager__empty">没有匹配的对话</div>
        )}
      </div>
      <div className="shell-tab-manager__footer">
        <button
          type="button"
          disabled={!props.activeId || props.conversations.length <= 1}
          onClick={() => {
            for (const conversation of props.conversations) {
              const id = String(conversation.id);
              if (id !== props.activeId) props.onClose(id);
            }
            props.onDismiss();
          }}
        >
          关闭其他标签
        </button>
        {props.onClosePane ? (
          <button
            type="button"
            data-testid={`pane-menu-close-pane${props.paneSuffix}`}
            onClick={() => {
              props.onDismiss();
              props.onClosePane?.();
            }}
          >
            关闭窗格
          </button>
        ) : null}
      </div>
    </>
  );
}
