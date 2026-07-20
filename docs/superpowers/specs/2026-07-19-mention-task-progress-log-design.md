# Mention Routing, Task Progress, And Execution Log Design

Date: 2026-07-19
Status: Approved by user

## 1. Goal

Make automated collaboration read like a real group conversation while keeping execution fully
automatic. Explicit mentions and group targets remain visible, while an implicit direct-chat target
does not add a redundant `@`. Task progress describes the work assigned for the current user turn,
and low-level activity remains in the execution log.

## 2. Mention Contract

- A user message records its effective target. Direct conversations hide the implicit selected
  Agent; an explicit `@Agent` remains visible. Group messages without an explicit member mention
  display the group target and still route to the lead.
- An explicit `@member` routes to that exact group member.
- An explicit `@Agent` is a one-turn route only. It does not permanently replace the task's primary
  Agent and does not turn a direct conversation into a group conversation.
- Lead delegation is presented as a lead Agent message mentioning the assigned member.
- Member handoff and completion are presented as member Agent messages mentioning the lead.
- Mentions are routing and attribution, not a requirement for the user to supervise each step.
  Runtime-created delegation, execution, handoff, acceptance, and final summary continue
  automatically.
- A child task keeps its assigned Agent for later messages. It must not fall back to the default
  Conversation Agent when the user continues the child conversation without another mention.

## 3. Current-Turn Progress

- `执行步骤` is renamed and treated as `本轮任务`.
- It contains only persisted plan nodes, delegated child goals, review work, and final delivery
  work for the current user turn.
- Application tools, MCP calls, context inspection, model fallback, shell commands, file reads,
  and Git commands never become progress steps.
- A direct turn without an explicit plan has one truthful high-level work item rather than an
  invented list of technical actions.

## 4. Execution Log

- The rail remains one compact row per user turn.
- Opening a turn uses a Multica-inspired work-record dialog: concise metadata chips, an Agent-stage
  strip, chronological flat event rows, type filters, and expandable evidence.
- Agent/model/context events, tools, commands, files, Git, browser actions, fallback, usage,
  artifacts, and errors belong here.
- Raw secrets and unbounded payloads remain excluded.

## 5. Parent And Child Tasks

- Parent rows expose a disclosure control and child count. Children are hidden or shown in place;
  selecting a task never changes persisted order.
- The parent progress view has one collapsible child-work section with status and assignee.
- A child task has a visible `返回父任务` action. Parent and child navigation is always two-way.

## 6. Empty Task Lifecycle

- Creating a conversation may still create a Runtime placeholder immediately.
- When the user leaves a placeholder with no sent messages, child tasks, plan, Run, artifact,
  approval request, non-empty Composer draft, or attachments, Runtime discards it instead of
  archiving it. Title and task version alone do not make a placeholder meaningful.
- A non-empty unsent draft keeps the placeholder and continues to follow that task, preserving the
  approved draft-continuity contract.
- Runtime performs the final guarded check so a stale Desktop cannot delete a task that acquired
  messages or child work concurrently.
- Switching the primary Agent or team creates a new blank task with the selected owner. It never
  copies the old task title or goal; the prior task remains when it contains work.

## 7. Right Rail Information Hierarchy

- Normal progress shows user-facing properties, current-turn work, participants, and child work.
- Internal group config versions, raw `HEAD`, raw tool allowlists, and Agent capability ceilings do
  not appear in the default task surface.
- Environment and access use plain product labels and remain available as compact advanced facts.
- Internal tool identifiers such as `read_file`, `list_files`, `git_status`, and `git_diff` are
  mapped to user-facing capability categories and do not appear in the normal permission UI.
- Detailed tools, tokens, commands, and evidence remain available from `执行详情`.

## 8. Permission Contract

- The four product modes keep their fixed labels: 请求批准、替我审批、完全访问、自定义.
- 完全访问 executes every currently available action without approval, including sensitive
  actions and configuration confirmations, while preserving audit events.
- 请求批准 automatically permits read-only inspection. Protected conversation tools pause the
  exact tool call, create one approval request, and resume that same call after a decision.
- Task policy overrides broader Agent and Workspace defaults. Capability ceilings still filter
  which tools are available.

## 9. Acceptance Criteria

1. Direct messages hide implicit `@Agent`; explicit mentions, group targets, automatic delegation,
   and handoff messages display the exact target and Agent identity.
2. Continuing a child task uses its assigned Agent without requiring another mention.
3. A full-access ordinary conversation Run can execute allowed workspace tools without requiring
   an orchestration Run Graph.
4. `agent/list`, `handoff/record`, shell commands, and other tool calls do not appear in current-turn
   progress.
5. Parent task rows collapse and expand without reordering; child tasks can return to the parent.
6. Leaving a truly blank placeholder removes it regardless of inherited title/version, while a
   non-empty draft or any persisted work preserves it.
7. Execution log rows can be filtered and expanded without exposing secrets or blocking the chat.
8. Switching Agent/team creates a blank new task and never copies the old title or goal.
9. 完全访问 never enqueues approval for a currently available action; 请求批准 still resumes one
   exact protected tool call after approval.
