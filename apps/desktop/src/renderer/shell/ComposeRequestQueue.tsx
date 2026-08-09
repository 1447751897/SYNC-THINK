import { useEffect, useState } from 'react';
import { Clock3, PenLine, SendHorizonal, Trash2, X } from 'lucide-react';
import type { QueuedComposeRequest } from './compose-request-queue.js';

interface ComposeRequestQueueProps {
  items: readonly QueuedComposeRequest[];
  activeRun: boolean;
  dispatchingId?: string;
  blockedId?: string;
  dispatchError?: string;
  onEdit(requestId: string, text: string): void;
  onDelete(requestId: string): void;
  onInterject(requestId: string): void;
}

export function ComposeRequestQueue({
  items,
  activeRun,
  dispatchingId,
  blockedId,
  dispatchError,
  onEdit,
  onDelete,
  onInterject,
}: ComposeRequestQueueProps) {
  const [editingId, setEditingId] = useState<string | undefined>();
  const [editingText, setEditingText] = useState('');

  useEffect(() => {
    if (editingId && !items.some((item) => item.id === editingId)) {
      setEditingId(undefined);
      setEditingText('');
    }
  }, [editingId, items]);

  if (items.length === 0) return null;

  return (
    <section
      className="shell-compose-queue"
      aria-label="待处理需求"
      data-testid="compose-request-queue"
    >
      <div className="shell-compose-queue__head">
        <Clock3 size={13} aria-hidden="true" />
        <span>待处理需求</span>
        <span className="shell-compose-queue__count">{items.length}</span>
        <span className="shell-compose-queue__hint">
          {activeRun ? '当前回复完成后按顺序执行' : '即将执行队首需求'}
        </span>
      </div>

      <div className="shell-compose-queue__list">
        {items.map((item, index) => {
          const editing = editingId === item.id;
          const dispatching = dispatchingId === item.id;
          const blocked = blockedId === item.id;
          const attachmentNames = item.attachments.map((attachment) => attachment.name);
          return (
            <article
              key={item.id}
              className="shell-compose-queue__item"
              data-state={dispatching ? 'sending' : blocked ? 'error' : 'queued'}
              data-testid={`compose-request-queue-item-${item.id}`}
            >
              <div className="shell-compose-queue__ordinal">{index + 1}</div>
              <div className="shell-compose-queue__content">
                {editing ? (
                  <textarea
                    className="shell-compose-queue__edit-input"
                    value={editingText}
                    rows={2}
                    autoFocus
                    aria-label={`编辑待处理需求 ${index + 1}`}
                    data-testid={`compose-request-edit-input-${item.id}`}
                    onChange={(event) => setEditingText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setEditingId(undefined);
                        setEditingText('');
                      }
                      if (
                        event.key === 'Enter' &&
                        (event.ctrlKey || event.metaKey) &&
                        (editingText.trim() || item.attachments.length > 0)
                      ) {
                        event.preventDefault();
                        onEdit(item.id, editingText);
                        setEditingId(undefined);
                        setEditingText('');
                      }
                    }}
                  />
                ) : (
                  <>
                    <div className="shell-compose-queue__text">
                      {item.text.trim() || '仅包含附件的需求'}
                    </div>
                    {attachmentNames.length > 0 ? (
                      <div className="shell-compose-queue__attachments">
                        {attachmentNames.join('、')}
                      </div>
                    ) : null}
                  </>
                )}
                {blocked && dispatchError ? (
                  <div className="shell-compose-queue__error" role="status">
                    {dispatchError}
                  </div>
                ) : null}
              </div>

              <div className="shell-compose-queue__actions">
                {editing ? (
                  <>
                    <button
                      type="button"
                      className="shell-compose-queue__icon"
                      aria-label={`取消编辑待处理需求 ${index + 1}`}
                      title="取消"
                      onClick={() => {
                        setEditingId(undefined);
                        setEditingText('');
                      }}
                    >
                      <X size={13} />
                    </button>
                    <button
                      type="button"
                      className="shell-compose-queue__action"
                      disabled={!editingText.trim() && item.attachments.length === 0}
                      data-testid={`compose-request-edit-save-${item.id}`}
                      onClick={() => {
                        onEdit(item.id, editingText);
                        setEditingId(undefined);
                        setEditingText('');
                      }}
                    >
                      保存
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="shell-compose-queue__icon"
                      aria-label={`编辑待处理需求 ${index + 1}`}
                      title="编辑"
                      disabled={dispatching}
                      data-testid={`compose-request-edit-${item.id}`}
                      onClick={() => {
                        setEditingId(item.id);
                        setEditingText(item.text);
                      }}
                    >
                      <PenLine size={13} />
                    </button>
                    <button
                      type="button"
                      className="shell-compose-queue__icon is-danger"
                      aria-label={`删除待处理需求 ${index + 1}`}
                      title="删除"
                      disabled={dispatching}
                      data-testid={`compose-request-delete-${item.id}`}
                      onClick={() => onDelete(item.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      type="button"
                      className="shell-compose-queue__action is-interject"
                      disabled={Boolean(dispatchingId)}
                      data-testid={`compose-request-interject-${item.id}`}
                      onClick={() => onInterject(item.id)}
                    >
                      <SendHorizonal size={13} />
                      {dispatching ? '发送中' : blocked ? '重试' : '插话'}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
