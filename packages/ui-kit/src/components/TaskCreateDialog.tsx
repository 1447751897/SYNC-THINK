import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { MessageSquareText, X } from 'lucide-react';

export interface TaskCreateDialogSubmit {
  title: string;
  goal: string;
}

export interface TaskCreateDialogProps {
  readonly open: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly workspaceName?: string | null;
  readonly parentTaskTitle?: string | null;
  readonly onClose: () => void;
  readonly onSubmit: (input: TaskCreateDialogSubmit) => void;
}

export function TaskCreateDialog(props: TaskCreateDialogProps) {
  const open = props.open;
  const onClose = props.onClose;
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isChild = Boolean(props.parentTaskTitle);

  useEffect(() => {
    if (!open) return;
    setTitle(isChild ? '子任务' : '新任务');
    setGoal('');
    setValidationError(null);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isChild, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!props.open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setValidationError('请输入任务标题');
      return;
    }
    const normalizedGoal = goal.trim() || normalizedTitle;
    props.onSubmit({ title: normalizedTitle, goal: normalizedGoal });
  };

  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) props.onClose();
  };

  const visibleError = props.error ?? validationError;
  const description = isChild
    ? `将挂在「${props.parentTaskTitle}」下，并显式引用父任务上下文`
    : props.workspaceName
      ? `创建到项目「${props.workspaceName}」`
      : '创建后即可开始对话';

  return (
    <div className="st-project-dialog__backdrop" onMouseDown={closeFromBackdrop}>
      <section
        className="st-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="st-task-dialog-title"
        aria-describedby="st-task-dialog-description"
        aria-busy={props.busy}
        data-testid="task-create-dialog"
      >
        <header className="st-project-dialog__header">
          <span className="st-project-dialog__icon" aria-hidden="true">
            <MessageSquareText size={18} strokeWidth={1.8} />
          </span>
          <span className="st-project-dialog__heading">
            <strong id="st-task-dialog-title">{isChild ? '新建子任务' : '新建任务'}</strong>
            <small id="st-task-dialog-description">{description}</small>
          </span>
          <button
            type="button"
            className="st-project-dialog__icon-button"
            aria-label="关闭新建任务"
            title="关闭"
            onClick={props.onClose}
          >
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        <form className="st-project-dialog__form" onSubmit={submit} data-testid="task-create-form">
          <label className="st-project-dialog__field">
            <span>任务标题</span>
            <input
              ref={inputRef}
              type="text"
              value={title}
              maxLength={256}
              autoComplete="off"
              placeholder="例如：规划本周功能"
              disabled={props.busy}
              aria-invalid={Boolean(visibleError)}
              data-testid="task-create-title"
              onChange={(event) => {
                setTitle(event.target.value);
                setValidationError(null);
              }}
            />
          </label>

          <label className="st-project-dialog__field">
            <span>任务目标（可选）</span>
            <textarea
              value={goal}
              maxLength={2000}
              rows={3}
              autoComplete="off"
              placeholder="一句话说明要完成什么；留空则与标题相同"
              disabled={props.busy}
              data-testid="task-create-goal"
              onChange={(event) => {
                setGoal(event.target.value);
                setValidationError(null);
              }}
            />
          </label>

          {visibleError ? (
            <p className="st-project-dialog__error" role="alert" data-testid="task-create-error">
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
              data-testid="task-create-submit"
            >
              {props.busy ? '正在创建…' : isChild ? '创建子任务' : '创建任务'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
