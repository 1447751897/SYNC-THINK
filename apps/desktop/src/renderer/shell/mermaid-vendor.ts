// Lazy-loaded mermaid vendor bundle (built separately so the main shell bundle
// stays lean). Loaded on demand by mermaid-vendor-loader when a ```mermaid block
// is rendered. Exposes a minimal, stable surface on globalThis.
import mermaid from 'mermaid';

(globalThis as typeof globalThis & { SyncThinkMermaid?: unknown }).SyncThinkMermaid = {
  initialize: mermaid.initialize.bind(mermaid),
  render: mermaid.render.bind(mermaid),
};
