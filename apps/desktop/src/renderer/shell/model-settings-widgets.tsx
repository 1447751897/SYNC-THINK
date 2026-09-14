import { useEffect } from 'react';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import clsx from 'clsx';

export interface ImportDialogState {
  providerId?: string;
  target?: 'provider' | 'create';
  protocol: string;
  discovered: Array<{ providerModelId: string; displayName: string; alreadyAdded: boolean }>;
  selectedIds: string[];
  query: string;
  applying: boolean;
}

export function AddModelInlineRow({
  value,
  busy,
  confirmTestId,
  placeholder = '模型 ID',
  inputAriaLabel = '模型 ID',
  groupAriaLabel = '手动添加模型',
  onChange,
  onConfirm,
  onDismiss,
}: {
  value: string;
  busy: boolean;
  confirmTestId?: string;
  placeholder?: string;
  inputAriaLabel?: string;
  groupAriaLabel?: string;
  onChange: (value: string) => void;
  onConfirm: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  return (
    <div className="model-add-model-inline" role="group" aria-label={groupAriaLabel}>
      <Plus size={14} aria-hidden="true" />
      <input
        className="model-add-model-inline__input"
        value={value}
        placeholder={placeholder}
        disabled={busy}
        aria-label={inputAriaLabel}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            void onConfirm();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onDismiss();
          }
        }}
      />
      <button
        type="button"
        className="model-add-model-inline__confirm"
        data-testid={confirmTestId}
        disabled={busy || !value.trim()}
        aria-label="添加"
        onClick={() => void onConfirm()}
      >
        <Check size={14} />
      </button>
      <button
        type="button"
        className="model-add-model-inline__dismiss"
        disabled={busy}
        aria-label="收起"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ImportModelsDialog({
  dialog,
  onClose,
  onChange,
  onApply,
}: {
  dialog: ImportDialogState;
  onClose: () => void;
  onChange: (next: ImportDialogState) => void;
  onApply: () => void;
}) {
  const query = dialog.query.trim().toLocaleLowerCase('zh-CN');
  const filtered = dialog.discovered.filter((item) => {
    if (!query) return true;
    return (
      item.providerModelId.toLocaleLowerCase('zh-CN').includes(query) ||
      item.displayName.toLocaleLowerCase('zh-CN').includes(query)
    );
  });
  const selected = new Set(dialog.selectedIds);
  const selectedCount = dialog.selectedIds.length;
  const totalCount = dialog.discovered.length;
  const alreadyAddedIds = dialog.discovered
    .filter((item) => item.alreadyAdded)
    .map((item) => item.providerModelId);
  const willRemove = alreadyAddedIds.filter((id) => !selected.has(id)).length;
  const willAdd = dialog.selectedIds.filter((id) => !alreadyAddedIds.includes(id)).length;
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((item) => selected.has(item.providerModelId));
  const impactParts = [
    willAdd > 0 ? `将新增 ${willAdd}` : null,
    willRemove > 0 ? `将移除 ${willRemove}` : null,
  ].filter((part): part is string => Boolean(part));

  const toggleId = (id: string) => {
    const next = new Set(dialog.selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...dialog, selectedIds: [...next] });
  };

  const toggleVisible = () => {
    const next = new Set(dialog.selectedIds);
    if (allVisibleSelected) {
      for (const item of filtered) next.delete(item.providerModelId);
    } else {
      for (const item of filtered) next.add(item.providerModelId);
    }
    onChange({ ...dialog, selectedIds: [...next] });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dialog.applying) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog.applying, onClose]);

  return (
    <div
      className="model-import-overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (dialog.applying || event.target !== event.currentTarget) return;
        onClose();
      }}
    >
      <div
        className="model-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-import-title"
        aria-describedby="model-import-desc"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="model-import-dialog__head">
          <h3 id="model-import-title">导入模型</h3>
          <button type="button" aria-label="关闭" disabled={dialog.applying} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p id="model-import-desc" className="model-import-dialog__desc">
          从服务商拉到 {totalCount} 个模型。勾选要加入优先级的模型；取消勾选会从列表拿掉。
        </p>
        <label className="model-import-dialog__search">
          <Search size={14} aria-hidden="true" />
          <input
            value={dialog.query}
            placeholder="搜索模型 ID 或显示名"
            aria-label="搜索模型"
            autoFocus
            disabled={dialog.applying}
            onChange={(event) => onChange({ ...dialog, query: event.target.value })}
          />
        </label>
        <div className="model-import-dialog__meta">
          <span>
            已选 {selectedCount} 个
            {impactParts.length > 0 ? ` · ${impactParts.join(' · ')}` : ''}
          </span>
          <button
            type="button"
            disabled={dialog.applying || filtered.length === 0}
            onClick={toggleVisible}
          >
            {allVisibleSelected ? '清空' : '全选'}
          </button>
        </div>
        <div className="model-import-dialog__list">
          {filtered.length === 0 ? (
            <p className="model-import-dialog__empty">没有匹配的模型</p>
          ) : (
            filtered.map((item) => {
              const checked = selected.has(item.providerModelId);
              return (
                <label
                  key={item.providerModelId}
                  className={clsx('model-import-dialog__row', checked && 'is-checked')}
                >
                  <input
                    className="model-import-dialog__input"
                    type="checkbox"
                    checked={checked}
                    disabled={dialog.applying}
                    onChange={() => toggleId(item.providerModelId)}
                  />
                  <span className="model-import-dialog__check" aria-hidden="true">
                    {checked ? <Check size={11} strokeWidth={2.75} /> : null}
                  </span>
                  <span className="model-import-dialog__name">{item.displayName}</span>
                  {item.alreadyAdded ? (
                    <em className="model-import-dialog__badge">已添加</em>
                  ) : null}
                </label>
              );
            })
          )}
        </div>
        <div className="model-import-dialog__footer">
          <button type="button" className="is-cancel" disabled={dialog.applying} onClick={onClose}>
            取消
          </button>
          <button type="button" className="is-primary" disabled={dialog.applying} onClick={onApply}>
            {dialog.applying ? (
              <>
                <Loader2 size={14} className="model-settings-spin" /> 应用中…
              </>
            ) : (
              `应用到优先级 (${selectedCount})`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
