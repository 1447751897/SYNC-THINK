# Collaboration Implementation Status

This note records the implemented child-Agent boundary for the model conversation track.

## Runtime

- A delegated task runs in an independent child Run with its own Run id, Agent binding, depth, and quota accounting.
- The child Run is parent-scoped in the transient stream. Its text never becomes the parent assistant answer.
- Child tool progress is projected through `delegatedAgent` frames and reconnect snapshots owned by the parent Run.
- Child assistant messages are excluded from normal durable message persistence and event backfill. The parent `agent_delegate` result remains the durable user-facing record.
- Cancelling the parent aborts the child provider loop and removes the child in-memory state.
- Dynamic child delegation defaults to disabled and is enabled explicitly through the collaboration setting.
- Each child receives an independent total token budget. The effective budget is forwarded as `maxOutputTokens`, accumulated from provider usage events, and returns a structured budget-exceeded result.
- Each child accepts an optional `timeoutSeconds` limit (default 300 seconds, capped at 3600). Timeout is projected as `timed_out` while the parent continues its turn.
- A child can be cancelled directly through `run.cancel`; the parent receives a cancelled delegation result and continues its own response.

## 工具边界

- 委派子 Run 的工具边界由 `apps/runtime/src/collaboration-policy.ts` 的 `isDelegatedReadOnlyTool` 单点判定，Runtime 的工具派发、MCP 目录裁剪和平台工具闸门共用同一判断。
- 内置只读白名单：`read_file`、`list_files`、`search_files`、`git_status`、`git_diff`、`web_search`、`web_fetch`。
- MCP 工具只有元数据显式声明 `readOnly: true` 时才对子 Run 可见；缺失元数据视为不可用，工具名不参与安全分类。
- 模型绕过工具目录直接调用受限工具（含 MCP 工具）时，子 Run 收到 `Delegated child Agents are limited to read-only tools.`，父 Run 继续自己的回答。

## Desktop

- The parent assistant process area renders the reused existing Agent identity, status, active tool, arguments, and bounded tool output.
- The card updates while the child is running and keeps the existing 20-line expandable output convention.
- Running child cards expose controls for stopping the current child or all currently running children.
- Durable fallback event consumption filters known delegated child Run ids so a reconnect cannot replace the parent draft with child text.
- `DelegatedAgentTasks` is exported from `ChatView.tsx` so the card has a direct render-test entry point; component behaviour is unchanged. The new render test covers identity and the Agent Library id, the five status labels, the 20-row tool-log fold, per-child and stop-all actions, parallel-group headers, and card rebuilds from a durable `agent_delegate` result.

## Verification

- Runtime collaboration and transient-stream coverage includes existing-Agent assignment, unavailable-Agent rejection, provider failure, budget exhaustion, timeout, direct child cancellation, parent cancellation, reconnect snapshots, and the read-only tool boundary.
- `message-store-backfill` coverage: 7 tests passed; a delegated child `run.completed` never materializes as a second assistant message.
- Desktop transient-stream, chat-stream, settings and delegated-card render coverage: 114 tests passed combined
  (`chat-transient-stream` 29 + `chat-stream` 14 + `SettingsPage` 59 + `ChatView.delegated-agents` 12);
  protocol build plus protocol/runtime/desktop typechecks passed.
