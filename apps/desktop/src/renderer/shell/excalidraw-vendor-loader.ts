export interface ExcalidrawVendorDocument {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface ExcalidrawVendorOptions {
  document: ExcalidrawVendorDocument;
  theme: 'light' | 'dark';
  langCode: 'zh-CN' | 'en';
  onChange(
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>,
  ): void;
}

export interface ExcalidrawVendorHandle {
  update(document: ExcalidrawVendorDocument): void;
  /** Live editor scene, including transient selection state omitted from saved files. */
  getCurrentDocument(): ExcalidrawVendorDocument;
  exportPng(): Promise<Blob>;
  exportSvg(): Promise<Blob>;
  focus(): void;
  /** Root/API access used by the NewMax chrome adapter. */
  getRoot(): HTMLElement;
  getApi(): {
    getAppState(): Record<string, unknown>;
    setActiveTool(tool: { type: string; insertOnCanvasDirectly?: boolean; locked?: boolean }): void;
    updateScene(scene: { appState?: Record<string, unknown> }): void;
    onChange(callback: (_elements: readonly unknown[], appState: Record<string, unknown>) => void): () => void;
  } | null;
  onReady(callback: () => void): () => void;
  dispose(): void;
}

export interface ExcalidrawVendor {
  mountExcalidraw(element: HTMLElement, options: ExcalidrawVendorOptions): ExcalidrawVendorHandle;
}

declare global {
  interface Window {
    SyncThinkExcalidraw?: ExcalidrawVendor;
  }
}

let vendorPromise: Promise<ExcalidrawVendor> | undefined;

function ensureExcalidrawStylesheet(): void {
  if (document.querySelector('link[data-sync-think-excalidraw-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./excalidraw-vendor.css', window.location.href).href;
  link.dataset.syncThinkExcalidrawStyle = 'true';
  document.head.append(link);
}

export function loadExcalidrawVendor(): Promise<ExcalidrawVendor> {
  if (window.SyncThinkExcalidraw) return Promise.resolve(window.SyncThinkExcalidraw);
  if (vendorPromise) return vendorPromise;
  vendorPromise = new Promise<ExcalidrawVendor>((resolve, reject) => {
    // The vendor CSS is copied beside the lazy JS bundle by build-shell.mjs.
    // Load it before mounting the editor so the first painted frame uses the
    // same controls, typography, and canvas sizing as the upstream editor.
    ensureExcalidrawStylesheet();
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-sync-think-excalidraw]',
    );
    const script = existing ?? document.createElement('script');
    const cleanupListeners = () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanupListeners();
      if (window.SyncThinkExcalidraw) resolve(window.SyncThinkExcalidraw);
      else {
        script.remove();
        reject(new Error('Excalidraw vendor loaded without an export'));
      }
    };
    const onError = () => {
      cleanupListeners();
      script.remove();
      reject(new Error('Excalidraw vendor failed to load'));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = new URL('./excalidraw-vendor.js', window.location.href).href;
      script.async = true;
      script.dataset.syncThinkExcalidraw = 'true';
      document.head.append(script);
    }
  }).catch((error) => {
    vendorPromise = undefined;
    throw error;
  });
  return vendorPromise;
}
