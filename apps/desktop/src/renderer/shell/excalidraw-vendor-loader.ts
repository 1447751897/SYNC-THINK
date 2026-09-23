import { createVendorScriptLoader, ensureVendorStylesheet } from './vendor-script-loader.js';

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

function ensureExcalidrawStylesheet(): void {
  ensureVendorStylesheet({
    selector: 'link[data-sync-think-excalidraw-style]',
    source: './excalidraw-vendor.css',
    markerAttribute: 'data-sync-think-excalidraw-style',
  });
}

const loadVendorScript = createVendorScriptLoader<ExcalidrawVendor>({
  scriptSelector: 'script[data-sync-think-excalidraw]',
  scriptSource: './excalidraw-vendor.js',
  markerAttribute: 'data-sync-think-excalidraw',
  readVendor: () => window.SyncThinkExcalidraw,
  missingExportMessage: 'Excalidraw vendor loaded without an export',
  loadErrorMessage: 'Excalidraw vendor failed to load',
  beforeStart: ensureExcalidrawStylesheet,
});

export function loadExcalidrawVendor(): Promise<ExcalidrawVendor> {
  return loadVendorScript();
}
