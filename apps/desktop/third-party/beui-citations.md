# Be UI Citations adaptation

Upstream: https://beui.dev/components/agents/citations
Source: https://beui.dev/r/citations.json
License: MIT, Copyright (c) 2026 Saurabh Chauhan. See beui-code-block.LICENSE; the notice ships in citations.css.

The React 18 adaptation uses the upstream numbered inline citation, favicon stack, compact numbered rows and in-flow disclosure patterns. Existing theme tokens, file icons, website icons and desktop navigation are reused. CSS transitions respect reduced motion.

- Numeric Markdown links (including resolved reference links) identify explicit citations. Each reply has its own stable target ids and canonical source mapping. Selecting a number expands, focuses and highlights the matching row without changing the document hash.
- Ordinary links and successfully read files are grouped as reference material. Written files and failed reads are not promoted to citation evidence. Opaque vendor citation markers without a resolved source are never assigned fabricated URLs or numbers.
- Web anchors are preserved. Workspace files use the same validated resolver for inline links and source rows, including line and column positions. No file is read to build a preview.
- Source numbers are derived from the persisted answer in order of appearance, so history and live completion use the same mapping. Sources become interactive after the answer settles; the streaming Markdown tree remains mounted.
- All collected sources remain available in a bounded scrolling list; there is no silent twelve-source cutoff.
