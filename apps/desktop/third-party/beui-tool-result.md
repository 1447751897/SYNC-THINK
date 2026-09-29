# Be UI Tool Result adaptation

Upstream: https://beui.dev/components/agents/tool-result
Source: https://beui.dev/r/tool-result/raw
License: MIT, Copyright (c) 2026 Saurabh Chauhan. See beui-code-block.LICENSE (same upstream project). The license ships in tool-result.css.

This React 18 adaptation uses the upstream terminal/request result pattern, status vocabulary and bounded output surface. InlineProcessFlow owns the existing single disclosure. ToolResult owns the status, output and supported result actions. CodeBlock supplies highlighting, copy, wrapping and manual scroll following; DeferredToolContent supplies real versioned content reads.

- Collapsed calls and process summaries stay plain. Expanded details share one rounded frosted surface.
- Running calls expand when actual log output arrives; completed calls fold unless manually opened/read. Failed calls stay expanded unless manually folded.
- Reading or copying output pins the existing disclosure; manually scrolling up pauses following. File edits retain diff-only presentation.
- Terminal inputs retain the actual command without shell executable/cwd/process metadata.
- Runtime log tails are bounded to 32 KiB / 400 lines per run/tool. Truncation is labelled, and copy only claims the current snippet. Final output replaces the transient tail.
- Live fields are excluded from persisted timeline updates. Kernels without live output show a waiting state until a real final result arrives.
- Retry is shown only when a caller supplies a supported execution callback; no blanket command replay is added.
