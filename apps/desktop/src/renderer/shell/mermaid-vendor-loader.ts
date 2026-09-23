import { createVendorScriptLoader } from './vendor-script-loader.js';

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

const loadVendorScript = createVendorScriptLoader<MermaidVendor>({
  scriptSelector: 'script[data-sync-think-mermaid]',
  scriptSource: './mermaid-vendor.js',
  markerAttribute: 'data-sync-think-mermaid',
  readVendor: () => window.SyncThinkMermaid,
  missingExportMessage: 'Mermaid vendor loaded without an export',
  loadErrorMessage: 'Mermaid vendor failed to load',
});

export function loadMermaidVendor(): Promise<MermaidVendor> {
  return loadVendorScript();
}
