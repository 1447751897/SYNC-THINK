# Mention Routing, Task Progress, And Execution Log Design

Date: 2026-07-19
Status: Approved by user

## 1. Goal

Make automated collaboration read like a real group conversation while keeping execution fully
automatic. Every routed turn exposes its target with an `@` mention, task progress describes the
work assigned for the current user turn, and low-level activity remains in the execution log.

## 2. Mention Contract

- A user message records and displays its effective target. Direct conversations display the
  selected Agent; group messages without an explicit member mention display the group target and
  still route to the lead.
- An explicit `@member` routes to that exact group member.
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
- When the user leaves a placeholder with task version `0`, no sent messages, no child tasks, and
  no non-empty Composer draft or attachments, Runtime discards it instead of archiving it.
- A non-empty unsent draft keeps the placeholder and continues to follow that task, preserving the
  approved draft-continuity contract.
- Runtime performs the final guarded check so a stale Desktop cannot delete a task that acquired
  messages or child work concurrently.

## 7. Right Rail Information Hierarchy

- Normal progress shows user-facing properties, current-turn work, participants, and child work.
- Internal group config versions, raw `HEAD`, raw tool allowlists, and Agent capability ceilings do
  not appear in the default task surface.
- Environment and access use plain product labels and remain available as compact advanced facts.
- Detailed tools, tokens, commands, and evidence remain available from `执行详情`.

## 8. Acceptance Criteria

1. Automatic delegation and handoff messages display exact `@` targets and exact Agent identity.
2. Continuing a child task uses its assigned Agent without requiring another mention.
3. A full-access ordinary conversation Run can execute allowed workspace tools without requiring
   an orchestration Run Graph.
4. `agent/list`, `handoff/record`, shell commands, and other tool calls do not appear in current-turn
   progress.
5. Parent task rows collapse and expand without reordering; child tasks can return to the parent.
6. Leaving a truly blank placeholder removes it, while a non-empty draft preserves it.
7. Execution log rows can be filtered and expanded without exposing secrets or blocking the chat.
