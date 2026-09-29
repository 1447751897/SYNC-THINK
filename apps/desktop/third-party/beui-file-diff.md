# Be UI File Diff adaptation

Upstream: https://beui.dev/components/agents/file-diff
Source: https://github.com/starc007/ui-components/blob/main/components/agents/file-diff.tsx
License: MIT, Copyright (c) 2026 Saurabh Chauhan. See `beui-code-block.LICENSE` (same upstream project and license).

This is a local React 18 adaptation using existing SYNC-THINK diff calculation, snapshot storage and deferred diff readers. It does not fetch UI from the registry at runtime. The license is embedded in `file-diff.css` and ships in the compiled renderer stylesheet.

Entry points:

- Chat file-change cards: plain compact file rows, independent expand/collapse, additions/deletions, old/new line numbers, syntax highlighting and source/patch copy.
- Expanded tool calls: show only stored changes with the exact matching tool-call ID, alongside the existing raw arguments and result. Delegated agents do not inherit a parent's file snapshots.
- Review panel: shared surface and toolbar, retaining word-level highlighting, whitespace and line-number options.

Compatibility decisions:

- Changes come from actual before/after snapshots or stored unified patches. Creation/deletion may use a known empty side. Missing snapshots get a content-preview notice rather than an invented diff.
- Streaming follows actual content updates. Manual upward scrolling pauses following; the explicit follow button resumes it. Completion does not force-collapse the user's view.
- Expanded chat blocks remain mounted when folded to preserve their reading position.
- Large deferred diffs keep validated paging, line expansion and version checks. Partial/truncated views do not offer a misleading full-patch export.
- Patch copy preserves source content and missing-final-newline markers. Copying modified content remains a separate action. Newline-only changes are identified separately.
- Styling is scoped to the diff surfaces. Compact execution summaries stay plain. Light/dark themes and reduced-motion preferences are supported.

Manual acceptance in the desktop development build:

1. In a scratch workspace, ask the agent to create a small TypeScript file. In a second message, ask it to change an existing line and add another line.
2. Expand the actual edit tool call: verify filename, red/green changes, old/new line numbers and the recorded arguments/result.
3. Expand two files in the chat file-change card. Scroll one, collapse and reopen it: its position should persist. Clicking the filename should open the file without toggling the diff.
4. Copy the diff and paste into a text editor; it should be a unified patch without rendered line numbers. Copy modified content should paste only the new source. Test long lines with wrapping off/on.
5. Open review via “查看变动”; toggle word-level highlighting, line numbers and whitespace display. Check both light and dark themes.
6. Open a large deferred diff and scroll to load another page. Missing snapshots should show the recorded-content notice, and partial views should not expose full-patch copy.

Verification uses real renderer components in an isolated Electron profile with fixed snapshots; it does not execute a live model request.
