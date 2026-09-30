// Loaded only when creating/editing a workspace; validation and APIs are unchanged.
import { useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
const WORKSPACE_ICON_PRESETS = ['📁', '💼', '🧠', '🚀', '📦', '🛠', '📚', '🧪', '🏠', '⭐'] as const;

export default function WorkspaceFormDialog(props: {
  mode: 'create' | 'edit';
  initial?: { name: string; folderPath: string; icon?: string };
  onPickFolder(): Promise<{ canceled: boolean; path?: string }>;
  onClose(): void;
  onSubmit(input: { name: string; folderPath: string; icon?: string }): Promise<boolean>;
}) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [path, setPath] = useState(props.initial?.folderPath ?? '');
  const [icon, setIcon] = useState(props.initial?.icon ?? '');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const browse = async () => {
    const picked = await props.onPickFolder();
    if (picked.canceled || !picked.path) return;
    setPath(picked.path);
    if (!name.trim()) {
      const auto =
        picked.path
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop() ?? '';
      if (auto) setName(auto);
    }
  };

  const submit = async () => {
    const n = name.trim();
    const p = path.trim();
    if (!n) {
      setError('请填写工作区名称');
      return;
    }
    if (props.mode === 'create' && !p) {
      setError('必须选择本地文件夹');
      return;
    }
    setSubmitting(true);
    setError(undefined);
    let ok = false;
    try {
      ok = await props.onSubmit({
        name: n,
        folderPath: p,
        icon: icon.trim() || undefined,
      });
    } catch (err) {
      ok = false;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
    if (ok) {
      props.onClose();
      return;
    }
    setError((prev) => prev ?? (props.mode === 'create' ? '创建工作区失败' : '保存工作区失败'));
  };

  return (
    <div
      className="st-backdrop-in fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      data-testid={props.mode === 'create' ? 'create-workspace-dialog' : 'edit-workspace-dialog'}
      onMouseDown={(e) => {
        if (submitting) return;
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="st-modal-in w-[440px] rounded-(--radius-card) border border-border bg-overlay p-4 shadow-2xl">
        <div className="mb-3 flex items-center">
          <h3 className="flex-1 text-[14px] font-semibold text-text">
            {props.mode === 'create' ? '新建工作区' : '编辑工作区'}
          </h3>
          <button
            type="button"
            className="st-icon-motion flex h-7 w-7 items-center justify-center rounded-(--radius-row) text-text-faint hover:bg-hover hover:text-text"
            onClick={props.onClose}
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] text-text-secondary">工作区名称</span>
          <input
            data-testid="workspace-form-name"
            className="st-field-input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(undefined);
            }}
            placeholder="例如 SYNC-THINK"
            autoFocus
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-[12px] text-text-secondary">路径</span>
          <div className="flex gap-2">
            <input
              data-testid="workspace-form-path"
              className="st-field-input flex-1"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setError(undefined);
              }}
              placeholder="选择本地文件夹"
            />
            <button
              type="button"
              data-testid="workspace-form-browse"
              className="st-row-motion h-[34px] shrink-0 rounded-(--radius-row) border border-border px-3 text-[14px] text-text-secondary hover:bg-hover"
              onClick={() => void browse()}
            >
              浏览
            </button>
          </div>
        </label>

        <div className="mb-3">
          <span className="mb-1 block text-[12px] text-text-secondary">图标</span>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {WORKSPACE_ICON_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-(--radius-row) border text-[15px]',
                  icon === preset ? 'border-accent bg-accent-soft' : 'border-border hover:bg-hover',
                )}
                onClick={() => setIcon(preset)}
                title={preset}
              >
                {preset}
              </button>
            ))}
          </div>
          <input
            data-testid="workspace-form-icon"
            className="st-field-input"
            value={icon}
            onChange={(e) => setIcon(e.target.value.slice(0, 8))}
            placeholder="也可直接输入 emoji"
          />
        </div>

        {error ? <div className="mb-3 text-[12px] text-error">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="st-row-motion h-8 rounded-(--radius-row) px-3 text-[14px] text-text-secondary hover:bg-hover"
            onClick={props.onClose}
          >
            取消
          </button>
          <button
            type="button"
            data-testid="workspace-form-submit"
            disabled={submitting}
            className="st-row-motion h-8 rounded-(--radius-row) bg-accent px-3 text-[14px] font-medium text-[var(--color-accent-fg)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void submit()}
          >
            {submitting ? '保存中…' : props.mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
