import { useState } from 'react';
import { Bell, CircleAlert, MessageCircleQuestion, ShieldCheck } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import type {
  ConversationNotice,
  ConversationNotificationPreferences,
} from '../../conversation-notification-contract.js';
import { conversationNoticeLabel } from '../../conversation-notification-contract.js';

export interface ConversationAttentionItem {
  conversationId: string;
  title: string;
  workspace: string;
  kind: Exclude<ConversationNotice['kind'], 'completed'>;
  sequence: number;
}
export function ConversationAttentionCenter(props: {
  items: readonly ConversationAttentionItem[];
  preferences: ConversationNotificationPreferences;
  onPreferencesChange(value: ConversationNotificationPreferences): void;
  onOpenConversation(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="conversation-attention-trigger"
          aria-label={`待处理 · ${props.items.length}`}
          data-testid="conversation-attention-trigger"
        >
          <Bell size={14} aria-hidden="true" />
          <span>待处理</span>
          {props.items.length > 0 && (
            <span className="conversation-attention-count">{props.items.length}</span>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="conversation-attention-overlay" />
        <Dialog.Content
          className="conversation-attention-dialog"
          aria-describedby="conversation-attention-description"
        >
          <header>
            <div>
              <Dialog.Title>
                会话待处理 <span>{props.items.length}</span>
              </Dialog.Title>
              <Dialog.Description id="conversation-attention-description">
                跨项目查看等待回答、审批和执行失败的会话。打开会话不会自动解决待处理请求。
              </Dialog.Description>
            </div>
            <Dialog.Close className="conversation-attention-close" aria-label="关闭待处理">
              ×
            </Dialog.Close>
          </header>
          <div className="conversation-attention-list">
            {props.items.length === 0 ? (
              <p className="conversation-attention-empty">没有待处理事项。</p>
            ) : (
              props.items.map((item) => {
                const Icon =
                  item.kind === 'answer'
                    ? MessageCircleQuestion
                    : item.kind === 'approval'
                      ? ShieldCheck
                      : CircleAlert;
                return (
                  <button
                    type="button"
                    key={item.conversationId}
                    className="conversation-attention-item"
                    onClick={() => {
                      setOpen(false);
                      props.onOpenConversation(item.conversationId);
                    }}
                  >
                    <Icon size={17} aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.workspace}</small>
                    </span>
                    <em>{conversationNoticeLabel(item.kind)}</em>
                  </button>
                );
              })
            )}
          </div>
          <footer>
            <label>
              <input
                type="checkbox"
                checked={props.preferences.completed}
                onChange={(event) =>
                  props.onPreferencesChange({
                    ...props.preferences,
                    completed: event.target.checked,
                  })
                }
              />
              任务完成时提醒
            </label>
            <label>
              <input
                type="checkbox"
                checked={props.preferences.sound}
                onChange={(event) =>
                  props.onPreferencesChange({ ...props.preferences, sound: event.target.checked })
                }
              />
              系统通知声音
            </label>
            <small>等待你处理和执行失败始终提醒；正在查看的会话不额外弹出提示。</small>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
