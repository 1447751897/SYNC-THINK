import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { FolderKanban, X } from 'lucide-react';

export interface ProjectCreateDialogProps {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => void;
}

export function ProjectCreateDialog(props: ProjectCreateDialogProps) {
  const [name, setName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!props.open) return;
    setName('');
    setValidationError(null);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.open]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.onClose, props.open]);

  if (!props.open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setValidationError('请输入项目名称');
      return;
    }
    props.onSubmit(normalizedName);
  };

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) props.onClose();
  };

  const visibleError = props.error ?? validationError;

  return (
    <div className="st-project-dialog__backdrop" onMouseDown={closeFromBackdrop}>
      <section
        className="st-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="st-project-dialog-title"
        aria-describedby="st-project-dialog-description"
        aria-busy={props.busy}
      >
        <header className="st-project-dialog__header">
          <span className="st-project-dialog__icon" aria-hidden="true">
            <FolderKanban size={18} strokeWidth={1.8} />
          </span>
          <span className="st-project-dialog__heading">
            <strong id="st-project-dialog-title">新建项目</strong>
            <small id="st-project-dialog-description">项目可以稍后绑定本地文件夹</small>
          </span>
          <button
            type="button"
            className="st-project-dialog__icon-button"
            aria-label="关闭新建项目"
            title="关闭"
            onClick={props.onClose}
          >
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        <form className="st-project-dialog__form" onSubmit={submit}>
          <label className="st-project-dialog__field">
            <span>项目名称</span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              maxLength={256}
              autoComplete="off"
              placeholder="例如：SYNC-THINK"
              disabled={props.busy}
              aria-invalid={Boolean(visibleError)}
              onChange={(event) => {
                setName(event.target.value);
                setValidationError(null);
              }}
            />
          </label>

          {visibleError ? (
            <p className="st-project-dialog__error" role="alert">
              {visibleError}
            </p>
          ) : null}

          <footer className="st-project-dialog__actions">
            <button type="button" className="st-project-dialog__button" onClick={props.onClose}>
              取消
            </button>
            <button
              type="submit"
              className="st-project-dialog__button st-project-dialog__button--primary"
              disabled={props.busy}
            >
              {props.busy ? '正在创建…' : '创建项目'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
