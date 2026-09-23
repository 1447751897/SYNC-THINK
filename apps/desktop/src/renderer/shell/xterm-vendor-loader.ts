import { createVendorScriptLoader, ensureVendorStylesheet } from './vendor-script-loader.js';

export interface XtermInstance {
  options?: { theme?: Record<string, string> };
  open(element: HTMLElement): void;
  write(text: string): void;
  writeln?(text: string): void;
  clear(): void;
  reset(): void;
  dispose(): void;
  focus(): void;
  resize(columns: number, rows: number): void;
  loadAddon?(addon: unknown): void;
  attachCustomKeyEventHandler?(handler: (event: KeyboardEvent) => boolean): void;
  onData?(listener: (data: string) => void): { dispose(): void };
}

export interface XtermConstructor {
  new (options?: Record<string, unknown>): XtermInstance;
}

export interface FitAddonInstance {
  fit(): void;
  proposeDimensions(): { cols: number; rows: number } | undefined;
}

export interface XtermVendor {
  Terminal: XtermConstructor;
  FitAddon?: new () => FitAddonInstance;
  WebLinksAddon?: new () => unknown;
}

declare global {
  interface Window {
    SyncThinkXterm?: XtermVendor;
  }
}

function ensureStylesheet(): void {
  ensureVendorStylesheet({
    selector: 'link[data-sync-think-xterm]',
    source: './xterm-vendor.css',
    markerAttribute: 'data-sync-think-xterm',
  });
}

const loadVendorScript = createVendorScriptLoader<XtermVendor>({
  scriptSelector: 'script[data-sync-think-xterm]',
  scriptSource: './xterm-vendor.js',
  markerAttribute: 'data-sync-think-xterm',
  readVendor: () => window.SyncThinkXterm,
  missingExportMessage: 'Terminal vendor loaded without an export',
  loadErrorMessage: 'Terminal vendor failed to load',
});

export function loadXtermVendor(): Promise<XtermVendor> {
  ensureStylesheet();
  return loadVendorScript();
}
