import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Lightweight NewMax-style application dialogs.
 *
 * Replaces window.prompt / window.confirm / window.alert with in-app dialogs
 * that match the dark, rounded NewMax visual language used by the shell.
 *
 * Usage:
 *   const dialog = useDialog();
 *   const ok = await dialog.confirm({ title, message });
 *   const value = await dialog.prompt({ title, message, defaultValue });
 *   dialog.alert({ title, message });
 */

export interface ConfirmOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  message?: ReactNode;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  /** When provided, returning truthy blocks submission and shows the error inline. */
  validate?: (value: string) => string | undefined;
}

export interface AlertOptions {
  title?: string;
  message: ReactNode;
  dismissText?: string;
}

interface DialogApi {
  confirm(options: ConfirmOptions): Promise<boolean>;
  prompt(options: PromptOptions): Promise<string | null>;
  alert(options: AlertOptions): Promise<void>;
}

type ActiveDialog =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | {
      kind: 'prompt';
      options: PromptOptions;
      resolve: (value: string | null) => void;
      value: string;
      error?: string;
    }
  | { kind: 'alert'; options: AlertOptions; resolve: () => void };

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within <DialogProvider>');
  return ctx;
}

export function DialogProvider(props: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveDialog | null>(null);

  const close = useCallback(() => setActive(null), []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setActive({ kind: 'confirm', options, resolve });
      }),
    [],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setActive({
          kind: 'prompt',
          options,
          resolve,
          value: options.defaultValue ?? '',
        });
      }),
    [],
  );

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>((resolve) => {
        setActive({ kind: 'alert', options, resolve });
      }),
    [],
  );

  const api: DialogApi = { confirm, prompt, alert };

  return (
    <DialogContext.Provider value={api}>
      {props.children}
      {active ? (
        <DialogSurface
          dialog={active}
          onChange={(next) => {
            if (next === null) {
              close();
            } else {
              setActive(next);
            }
          }}
        />
      ) : null}
    </DialogContext.Provider>
  );
}

function DialogSurface(props: {
  dialog: ActiveDialog;
  onChange(next: ActiveDialog | null): void;
}) {
  const { dialog } = props;

  const backdropClose = () => {
    // Only alerts dismiss on backdrop; confirm/prompt require an explicit choice.
    if (dialog.kind === 'alert') {
      dialog.resolve();
      props.onChange(null);
    }
  };

  return (
    <div
      className="st-backdrop-in fixed inset-0 z-[210] flex items-center justify-center bg-black/50 backdrop-blur-[2px]"
      data-testid="app-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) backdropClose();
      }}
    >
      <div className="st-modal-in w-[440px] max-w-[calc(100vw-32px)] rounded-(--radius-card) border border-border bg-overlay p-4 shadow-2xl">
        <div className="mb-2 flex items-start gap-2">
          <div className="flex-1">
            <h3 className="text-[14px] font-semibold text-text">
              {dialog.options.title ?? defaultTitle(dialog.kind)}
            </h3>
            {dialog.options.message ? (
              <div className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                {dialog.options.message}
              </div>
            ) : null}
          </div>
          {dialog.kind === 'alert' ? (
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-(--radius-row) text-text-faint hover:bg-hover hover:text-text"
              title="关闭"
              onClick={() => {
                dialog.resolve();
                props.onChange(null);
              }}
            >
              <X size={15} />
            </button>
          ) : null}
        </div>

        {dialog.kind === 'prompt' ? (
          <div className="mt-2">
            <input
              data-testid="app-dialog-prompt-input"
              className="st-field-input w-full"
              autoFocus
              value={dialog.value}
              placeholder={dialog.options.placeholder}
              onChange={(e) =>
                props.onChange({ ...dialog, value: e.target.value, error: undefined })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitPrompt(dialog, props.onChange);
                } else if (e.key === 'Escape') {
                  dialog.resolve(null);
                  props.onChange(null);
                }
              }}
            />
            {dialog.error ? (
              <div className="mt-1.5 text-[12px] text-error">{dialog.error}</div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {dialog.kind === 'prompt' || dialog.kind === 'confirm' ? (
            <button
              type="button"
              data-testid="app-dialog-cancel"
              className="h-8 rounded-(--radius-row) px-3 text-[12.5px] text-text-secondary hover:bg-hover"
              onClick={() => {
                if (dialog.kind === 'confirm') {
                  dialog.resolve(false);
                } else {
                  dialog.resolve(null);
                }
                props.onChange(null);
              }}
            >
              {cancelText(dialog)}
            </button>
          ) : null}
          <button
            type="button"
            data-testid="app-dialog-confirm"
            className="st-dialog-primary h-8 rounded-(--radius-row) px-3 text-[12.5px] font-medium hover:opacity-90"
            onClick={() => {
              if (dialog.kind === 'confirm') {
                dialog.resolve(true);
                props.onChange(null);
              } else if (dialog.kind === 'alert') {
                dialog.resolve();
                props.onChange(null);
              } else if (dialog.kind === 'prompt') {
                submitPrompt(dialog, props.onChange);
              }
            }}
            data-variant={dialog.kind === 'confirm' && dialog.options.danger ? 'danger' : 'accent'}
          >
            {confirmText(dialog)}
          </button>
        </div>
      </div>
    </div>
  );
}

function submitPrompt(
  dialog: Extract<ActiveDialog, { kind: 'prompt' }>,
  onChange: (next: ActiveDialog | null) => void,
): void {
  const value = dialog.value;
  const trimmed = value.trim();
  if (!trimmed) {
    onChange({ ...dialog, error: '请输入内容' });
    return;
  }
  const validateErr = dialog.options.validate?.(trimmed);
  if (validateErr) {
    onChange({ ...dialog, error: validateErr });
    return;
  }
  dialog.resolve(trimmed);
  onChange(null);
}

function defaultTitle(kind: ActiveDialog['kind']): string {
  if (kind === 'confirm') return '确认';
  if (kind === 'prompt') return '请输入';
  return '提示';
}

function cancelText(dialog: ActiveDialog): string {
  if (dialog.kind === 'confirm' || dialog.kind === 'prompt') {
    return dialog.options.cancelText ?? '取消';
  }
  return '取消';
}

function confirmText(dialog: ActiveDialog): string {
  if (dialog.kind === 'confirm') {
    return dialog.options.confirmText ?? (dialog.options.danger ? '删除' : '确认');
  }
  if (dialog.kind === 'prompt') {
    return dialog.options.confirmText ?? '确定';
  }
  return dialog.options.dismissText ?? '知道了';
}
