// Runtime loader for the lazily-built mermaid vendor chunk (mirrors
// xterm-vendor-loader). First mermaid block triggers the script fetch; the
// script stays cached on globalThis for the rest of the session.
export interface MermaidVendor {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string, container?: Element): Promise<{ svg: string }>;
  parse(text: string): Promise<unknown>;
}

declare global {
  interface Window {
    SyncThinkMermaid?: MermaidVendor;
  }
}

let vendorPromise: Promise<MermaidVendor> | undefined;

export function loadMermaidVendor(): Promise<MermaidVendor> {
  if (window.SyncThinkMermaid) return Promise.resolve(window.SyncThinkMermaid);
  if (vendorPromise) return vendorPromise;
  vendorPromise = new Promise<MermaidVendor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-sync-think-mermaid]');
    const script = existing ?? document.createElement('script');
    const cleanupListeners = () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanupListeners();
      if (window.SyncThinkMermaid) {
        resolve(window.SyncThinkMermaid);
      } else {
        script.remove();
        reject(new Error('Mermaid vendor loaded without an export'));
      }
    };
    const onError = () => {
      cleanupListeners();
      script.remove();
      reject(new Error('Mermaid vendor failed to load'));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = new URL('./mermaid-vendor.js', window.location.href).href;
      script.async = true;
      script.dataset.syncThinkMermaid = 'true';
      document.head.append(script);
    }
  }).catch((error) => {
    vendorPromise = undefined;
    throw error;
  });
  return vendorPromise;
}
