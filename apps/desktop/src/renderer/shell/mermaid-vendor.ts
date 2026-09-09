// Lazy-loaded mermaid vendor bundle (built separately so the main shell bundle
// stays lean). Loaded on demand by mermaid-vendor-loader when a ```mermaid block
// is rendered. Exposes a minimal, stable surface on globalThis.
//
// The ELK layout engine is registered here, exactly like NewMax does
// (`mermaid.registerLayoutLoaders(elkLayouts)`), because NewMax's theme config
// selects `layout: 'elk'` with orthogonal edge routing.
import mermaid from 'mermaid';
import elkLayouts from '@mermaid-js/layout-elk';

mermaid.registerLayoutLoaders(elkLayouts);

(globalThis as typeof globalThis & { SyncThinkMermaid?: unknown }).SyncThinkMermaid = {
  initialize: mermaid.initialize.bind(mermaid),
  render: mermaid.render.bind(mermaid),
  parse: mermaid.parse.bind(mermaid),
};
