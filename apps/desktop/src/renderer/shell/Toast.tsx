import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { CircleAlert, CircleCheck, CircleX, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export type ToastAction = {
  label: string;
  onClick: () => void;
  keepOpen?: boolean;
};

export type ToastOptions = {
  id?: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
  dismissible?: boolean;
  progress?: number;
  action?: ToastAction;
  secondaryAction?: ToastAction;
  onDismiss?: () => void;
};

export type ToastItem = ToastOptions & { id: string; duration: number };

export type ToastApi = {
  toast(options: ToastOptions): string;
  update(id: string, options: Partial<ToastOptions>): void;
  dismiss(id: string): void;
};

const DEFAULT_DURATION_MS = 5000;

type ToastStore = {
  items: ToastItem[];
  listeners: Set<() => void>;
};

const store: ToastStore = {
  items: [],
  listeners: new Set(),
};

function emit(): void {
  for (const listener of store.listeners) listener();
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
}

function getSnapshot(): ToastItem[] {
  return store.items;
}

function replaceItems(next: ToastItem[]): void {
  store.items = next;
  emit();
}

export const toastApi: ToastApi = {
  toast(options) {
    const id = options.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const nextToast: ToastItem = {
      duration: DEFAULT_DURATION_MS,
      ...options,
      id,
    };
    const exists = store.items.some((item) => item.id === id);
    replaceItems(
      exists
        ? store.items.map((item) => (item.id === id ? nextToast : item))
        : [...store.items, nextToast],
    );
    return id;
  },
  update(id, options) {
    replaceItems(store.items.map((item) => (item.id === id ? { ...item, ...options } : item)));
  },
  dismiss(id) {
    replaceItems(store.items.filter((item) => item.id !== id));
  },
};

const ToastContext = createContext<ToastApi>(toastApi);

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function toastTypeFromTone(
  tone: string | undefined,
): ToastType {
  if (tone === 'error') return 'error';
  if (tone === 'warning') return 'warning';
  if (tone === 'success') return 'success';
  return 'info';
}

/** NewMax `ToastProvider`: host sits at `fixed top-4 right-4`. */
export function ToastProvider(props: { children: ReactNode }) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <ToastContext.Provider value={toastApi}>
      {props.children}
      <ToastContainer toasts={items} onDismiss={toastApi.dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer(props: { toasts: readonly ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="shell-toast-host" data-testid="shell-toast-host">
      {props.toasts.map((item) => (
        <ToastCard key={item.id} toast={item} onDismiss={props.onDismiss} />
      ))}
    </div>
  );
}

const TOAST_ICONS = {
  success: CircleCheck,
  error: CircleX,
  warning: CircleAlert,
  info: Info,
} as const;

function ToastCard(props: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const { toast, onDismiss } = props;
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setLeaving(false);
  }, [toast.id, toast.title, toast.description, toast.type]);

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) return undefined;
    const timer = window.setTimeout(() => setLeaving(true), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.duration]);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = window.setTimeout(() => onDismiss(toast.id), 200);
    return () => window.clearTimeout(timer);
  }, [leaving, onDismiss, toast.id]);

  const dismiss = useCallback(() => {
    toast.onDismiss?.();
    setLeaving(true);
  }, [toast]);

  const Icon = TOAST_ICONS[toast.type];
  return (
    <div
      className={`shell-toast${leaving ? ' is-leaving' : ''}`}
      data-testid="shell-toast"
      data-type={toast.type}
      data-toast-id={toast.id}
      role={toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'}
    >
      <div
        className="shell-toast__body"
        data-dismissible={toast.dismissible !== false ? 'true' : 'false'}
      >
        <Icon className="shell-toast__icon" size={16} aria-hidden="true" />
        <div className="shell-toast__copy">
          <p className="shell-toast__title">{toast.title}</p>
          {toast.description ? <p className="shell-toast__description">{toast.description}</p> : null}
          {toast.progress != null ? (
            <div className="shell-toast__progress">
              <div className="shell-toast__progress-track">
                <div
                  className="shell-toast__progress-bar"
                  style={{ width: `${Math.min(100, Math.max(0, toast.progress))}%` }}
                />
              </div>
              <p className="shell-toast__progress-label">{toast.progress.toFixed(0)}%</p>
            </div>
          ) : null}
          {toast.action || toast.secondaryAction ? (
            <div className="shell-toast__actions">
              {toast.action ? (
                <button
                  type="button"
                  className="shell-toast__action is-primary"
                  onClick={() => {
                    toast.action?.onClick();
                    if (!toast.action?.keepOpen) dismiss();
                  }}
                >
                  {toast.action.label}
                </button>
              ) : null}
              {toast.secondaryAction ? (
                <button
                  type="button"
                  className="shell-toast__action"
                  onClick={() => {
                    toast.secondaryAction?.onClick();
                    if (!toast.secondaryAction?.keepOpen) dismiss();
                  }}
                >
                  {toast.secondaryAction.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {toast.dismissible !== false ? (
          <button
            type="button"
            className="shell-toast__close"
            aria-label="关闭提示"
            onClick={dismiss}
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function resetToastStoreForTests(): void {
  store.items = [];
  emit();
}
