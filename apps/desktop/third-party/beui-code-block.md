# Be UI Code Block adaptation

Upstream: https://beui.dev/components/agents/code-block
Source: https://github.com/starc007/ui-components/blob/main/components/agents/code-block.tsx
License: MIT, Copyright (c) 2026 Saurabh Chauhan. See `beui-code-block.LICENSE`.

This is a local React 18 adaptation, not a runtime fetch from the registry. It uses the already installed `motion/mini`, loaded on interaction, for reduced-motion-aware press feedback. The MIT notice is also embedded in `code-block.css` so it ships with the compiled renderer stylesheet.

- `CodeBlock.tsx`: code replies and expanded tool output, filename/language, streaming/readiness state, copy, wrap, collapse and explicit resume-following control.
- `CodeBlockSource.tsx`: shared line rendering for code replies and `CodePreview` file previews.
- `InlineProcessFlow.tsx`: expanded command input uses the same block. Compact process/command rows are unchanged by this adaptation.
- `code-block.css`: scoped neutral Be UI surfaces and light/dark treatments. Existing syntax colors and tool detail glass surfaces are retained.

The application keeps its existing highlight.js language coverage, full-source clipboard input, 2,000-line chat preview cap, deferred large-tool-result loading, and per-block reading position. Full-file previews remain uncapped. The code display's “就绪” label describes display readiness, not the success of a tool execution.

Manual acceptance in the desktop development build:

1. Ask for a fenced TypeScript sample of about 40 lines and a JSON sample. Verify syntax, line numbers, wrap toggle, expand/collapse and copying without line numbers.
2. During a streamed code reply, scroll upward. New tokens should preserve the reading position. “跟随最新内容” resumes following; completion shows “就绪”.
3. Ask the agent to run `Get-Date -Format "yyyy-MM-dd"`. Expand the actual command row: command input is highlighted; cwd and other metadata remain; output reflects the tool result. Collapse it again to verify the compact row.
4. Open an HTML file: “高亮预览” shows colored source, “源码” edits it, and “网页渲染” runs the webpage preview. Switching modes preserves unsaved edits.
5. Check light/dark themes and a narrow file pane. With OS reduced motion enabled, press/rotation effects are suppressed.
