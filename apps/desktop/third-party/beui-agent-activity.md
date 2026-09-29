# Be UI Agent Activity

Source: https://beui.dev/components/agents/agent-activity
Registry: https://beui.dev/r/agent-activity.json
Reviewed: 2026-09-27
License: MIT, copyright (c) 2026 Saurabh Chauhan. Full notice: [beui-code-block.LICENSE](./beui-code-block.LICENSE).

## Local adaptation

The working/completed activity viewport, compact disclosure, bounded height, edge fade and reduced-motion behavior are adapted into the existing production process flow. Existing theme tokens and real tool/detail components are retained; this is not a new scripted timeline.

- `src/renderer/shell/AgentActivity.tsx`: run state presentation and readable live viewport.
- `src/renderer/shell/InlineProcessFlow.tsx`: preserves chronological process rows, tool grouping, command/result details, file diffs, delegated agent cards, lazy history and per-run disclosure preferences.
- `src/renderer/shell/ChatView.tsx`: supplies runtime terminal state and durable paginated totals. Shared MessageBubble serves ordinary and agent conversations; delegated tasks stay at their original timeline position.
- `src/renderer/shell/ToolResult.tsx`: an unfinished tool pauses its indicator while approval is pending or the run is paused/stopped. Missing terminal output is not relabeled as success.

Unlike upstream's working/complete-only states and translated clipped content, this version distinguishes approval, failed, stopped, paused and historical records, uses an accessible scroll region, pauses following when reading earlier output, and offers a return-to-latest action. Manually opened details and an active reading position survive completion. Successful unread runs fold only according to the existing user preference and only after a real final answer exists.

Tool totals come from durable run pages when present; otherwise they count observed tool-call identities. They are counts of calls, not an invented percentage or a fixed number of phases. No backend schema changes, packages, model calls, or command execution are introduced by this UI component.

## Verification

Automated regressions live in AgentActivity.test.tsx plus existing InlineProcessFlow, ExecutionProcessBlock, StreamingResponse and delegated-agent tests. Electron UI checks mount production MessageBubble with controlled runtime-shaped records; they do not make model requests or edit project files.

Manual: ask a conversation to inspect files, change a disposable test file, run its tests and summarize. Expand a command and diff; scroll up during a longer command and return to latest. Complete the task, reopen the record, and switch away/back to verify history. Use the existing ask permission mode to verify waiting-for-approval and resumption. Use Stop during a disposable task to verify a stopped run retains its received output.
