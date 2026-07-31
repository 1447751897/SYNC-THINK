export interface XtermInstance {
  options?: { theme?: Record<string, string> };
  open(element: HTMLElement): void;
  write(text: string): void;
  clear(): void;
  reset(): void;
  dispose(): void;
  focus(): void;
  resize(columns: number, rows: number): void;
}

export interface XtermConstructor {
  new (options?: Record<string, unknown>): XtermInstance;
}

export interface XtermVendor {
  Terminal: XtermConstructor;
}

declare global {
  interface Window {
    SyncThinkXterm?: XtermVendor;
  }
}

let vendorPromise: Promise<XtermVendor> | undefined;

function ensureStylesheet(): void {
  if (document.querySelector('link[data-sync-think-xterm]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./xterm-vendor.css', window.location.href).href;
  link.dataset.syncThinkXterm = 'true';
  document.head.append(link);
}

export function loadXtermVendor(): Promise<XtermVendor> {
  ensureStylesheet();
  if (window.SyncThinkXterm) return Promise.resolve(window.SyncThinkXterm);
  if (vendorPromise) return vendorPromise;
  vendorPromise = new Promise<XtermVendor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-sync-think-xterm]');
    const script = existing ?? document.createElement('script');
    const cleanupListeners = () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanupListeners();
      if (window.SyncThinkXterm) {
        resolve(window.SyncThinkXterm);
      } else {
        script.remove();
        reject(new Error('Terminal vendor loaded without an export'));
      }
    };
    const onError = () => {
      cleanupListeners();
      script.remove();
      reject(new Error('Terminal vendor failed to load'));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = new URL('./xterm-vendor.js', window.location.href).href;
      script.async = true;
      script.dataset.syncThinkXterm = 'true';
      document.head.append(script);
    }
  }).catch((error) => {
    vendorPromise = undefined;
    throw error;
  });
  return vendorPromise;
}
