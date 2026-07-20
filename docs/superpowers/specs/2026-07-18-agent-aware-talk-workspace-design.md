# Agent-Aware Talk Workspace Design

Date: 2026-07-18
Status: Approved by user
Reference: Figma Make `Talk`, Version 8 (`QyggGZpyYh16GN0HnaaSH6`)

## 1. Goal

Rebuild the SYNC-THINK desktop experience around a familiar conversation product while keeping
the existing local-first Runtime, provider routing, task execution, approvals, artifacts, and
context evidence real.

The redesign is not a mock replacement. Figma defines the visual and interaction reference;
Runtime state and persisted domain records remain the source of truth.

An Agent answering inside SYNC-THINK must be able to state, without relying on user wording, that
it is running in SYNC-THINK and identify its current project, task, conversation, group, role, and
permission scope when those values exist.

## 2. Relationship To Earlier Specifications

This specification preserves these locked contracts:

- project -> task -> thread/run/artifact hierarchy;
- a project may bind zero or one local folder;
- complete task conversation is the primary work surface;
- Compose keeps project, Agent, provider credential group, and model routing behavior;
- task/run details remain in a collapsible right rail;
- one fixed Agent role per Agent definition;
- exactly one lead Agent in a group;
- explicit subtask packets and handoffs for group collaboration;
- no silent model substitution and no hidden cross-task context.

It supersedes the left-rail presentation in the 2026-07-16 beginner workspace specification:

- product navigation becomes a dedicated global rail;
- each product section may add one contextual list rail;
- `审批` is removed from global navigation;
- approvals appear only where the affected task/action is visible;
- `好友` is the user-facing Agent library and `群聊` is the persistent multi-Agent library.

The task workspace still has a left task/conversation list, complete center conversation, and
collapsible right task detail. The additional global rail does not replace the locked task region.

## 3. Desktop Information Architecture

Global navigation uses persistent icon plus text labels:

1. `对话任务`
2. `项目`
3. `好友`
4. `群聊`
5. `自动化`
6. `模型源`
7. `Skill & MCP`
8. `设置`

The global rail is visually quiet, approximately 200 px expanded and 52 px collapsed. It owns the
SYNC-THINK identity, theme action, Runtime indicator, and collapse action.

Section layouts:

- `对话任务`: conversation list / conversation / task detail.
- `项目`: project list / project conversations or files / conversation / task detail.
- `好友`: Agent list / Agent profile or editor.
- `群聊`: group list / group profile or group conversation / group status.
- `自动化`: automation list / automation detail or editor.
- `模型源`: provider list / provider, credential-group, and model detail.
- `Skill & MCP`: existing real Skill and MCP management surface.

At narrow widths, contextual rails and right detail collapse before the global rail loses labels.

## 4. Friend And Agent Contract

`好友` is a presentation of persisted Agent definitions, not a separate copy of Agent data.

The list shows:

- avatar;
- name and short role/description;
- `在线`, `忙碌中`, or `离线`;
- current task count when non-zero.

The profile shows and can edit:

- user-uploaded avatar or deterministic abstract fallback;
- name, description, and one fixed role/prompt;
- provider -> credential group -> model cascade;
- maximum concurrent task count;
- allowed Skills and MCP servers;
- group memberships and recent tasks.

Editing creates a new Agent version where version history is required. Historical runs retain the
exact Agent version and model binding they used.

## 5. Group Contract

A group is a persisted collaboration definition with:

- name, description, avatar, and fixed/temporary type;
- exactly one lead Agent;
- one or more members;
- a group-specific responsibility for every member;
- collaboration mode, permission mode, and concurrency limit;
- created/updated timestamps.

Group conversation uses the same message presentation and one-response-per-turn behavior as direct
Agent conversation. A message without an explicit mention routes to the lead Agent. An `@member`
mention routes that turn to the exact persisted member AgentVersion and does not change the global
Agent selection.

Normal group turns do not automatically create collaboration plans, delegation decisions, or
lifecycle cards. The lead Agent may explicitly decompose work through persisted subtask/delegation
tools. Those operational events remain auditable in task execution details, but the conversation
only renders user and Agent messages. Unbounded Agent-to-Agent chatter is not allowed.

Before a persistent group exists, the active Agent may propose other Agents automatically. After a
group exists, membership changes are configuration operations and require user confirmation.

## 6. Automation Contract

An automation is either scheduled or webhook-triggered. Every trigger creates a new task and never
reuses another task's conversation context.

An automation binds to:

- a project;
- one Agent or one group;
- an initial instruction;
- a permission mode;
- concurrency, retry, and timezone settings;
- a schedule or webhook trigger.

The automation page shows truthful Runtime availability, last/next execution, and task history.

## 7. Platform Identity And Context Contract

Every model call receives an application-owned environment envelope before user content:

```text
platform.name = SYNC-THINK
platform.kind = local-first Agent desktop workspace
surface = conversation | project | group | automation | external
project = id + name + optional bound-folder capability (path only when authorized)
task = id + title + goal + status + acceptance conditions
conversation = thread id + ordered canonical message history
agent = exact Agent version + fixed instructions + model binding
group = group id + lead + member responsibilities (when applicable)
permission = effective mode + human-only boundaries
```

This requirement is limited to the SYNC-THINK platform. It does not imply observing the current
Windows foreground application, selected text, or unrelated applications.

Context compilation order is:

1. platform identity and effective permission boundary;
2. exact Agent instructions and allowed tools;
3. current task goal/status/acceptance criteria;
4. ordered messages from the current thread;
5. current group definition and relevant subtask/handoff packet;
6. explicit parent-task references;
7. approved project/task memory and on-demand file excerpts;
8. the latest user message.

The latest user message, platform identity, Agent instructions, and active task identity are
protected. Conversation history is selected newest-first within the remaining token budget while
preserving chronological order in the provider request. Excluded history is recorded in the
Context Manifest. Sibling tasks and unrelated groups are never scanned implicitly.

Provider requests must use the compiled message history. A Context Manifest that lists history
without actually sending it to the provider is invalid.

## 8. Application Command Gateway

The Runtime command protocol is the only application command source of truth.

```text
Desktop UI --\
CLI ---------+--> Runtime Command Gateway --> validation --> authorization --> domain services
MCP server --/                                      |                         --> event/SQLite
Agent tools ----------------------------------------/
```

The CLI is a thin adapter, not the application core. Internal Agent tools, the external MCP server,
and the `sync-think` CLI call the same commands and receive the same validation, authorization,
event persistence, and error semantics.

Initial application tools include:

- list/get/create/update Agent;
- list/get/create/update group;
- add/remove group member and change responsibility;
- create/open/list project and task;
- delegate a subtask and record a handoff;
- inspect effective context and permission;
- list providers, credential groups, and models without exposing secret material.

The external surface is intended for Codex, Claude Code, and other MCP/CLI clients.

## 9. Confirmation And Permission Rules

Read-only and reversible task operations may execute directly when allowed by the effective policy.

Configuration operations first return a preview/draft. In `请求批准`, `替我审批`, and `自定义`
they require the effective policy's approval; `完全访问` consumes the preview token and executes
without a user prompt:

- create/update/delete Agent;
- create/update/delete persistent group;
- change group membership, lead, responsibility, model, or permission mode;
- change provider credentials or local folder binding;
- create/update/delete automation.

Group task execution defaults to `完全访问`, as previously approved. When full access is the final
effective policy, configuration confirmation and the seven sensitive action categories execute
without a prompt and remain audited. The existing permission modes remain `请求批准`, `替我审批`,
`完全访问`, and `自定义`.

Every command records caller surface (`desktop`, `agent`, `mcp`, or `cli`), effective scope,
confirmation evidence when required, and resulting event ids. Secrets never enter command output,
model context, logs, or diagnostics.

## 10. Acceptance Criteria

1. Asking an Agent which platform it is running on returns SYNC-THINK from injected context, even
   when the user did not mention the product name.
2. A second message in one task is sent with the real preceding user and assistant messages in
   chronological order.
3. No message from a sibling task or unrelated group appears in the provider request.
4. A group survives Runtime/Desktop restart with exactly one lead and all member responsibilities.
5. The lead can create explicit subtasks, members receive isolated packets, and the final response
   is summarized by the lead.
6. Internal Agent tools and external MCP/CLI clients produce the same Runtime command result for
   the same authorized input.
7. Configuration commands return a preview until confirmed; ordinary permitted task operations
   can execute directly.
8. The desktop navigation and core pages match the Figma V8 hierarchy in complete light and dark
   themes at 1280x720 and 1440x900 without clipping or overlapping.
9. Existing Compose routing, provider import/edit, folder binding, task creation, model streaming,
   approvals, artifacts, trace/manifest, and theme behavior do not regress.
10. Focused tests, full package tests, typecheck, build, Electron interaction checks, and visual QA
    pass before handoff.

## 11. Conversation Task Fidelity Lock

The user approved a structural replacement of the existing task surface on 2026-07-18. The
`ConversationTask` screen must reproduce the Figma Make Talk workspace itself, excluding Figma's
editor chrome. It must not be implemented as a visual skin over the legacy `AppShell` task layout.

At the 1708 x 911 reference viewport, the locked regions are:

- 200 px global product navigation;
- 240 px conversation directory;
- a fluid conversation column;
- 260 px task detail rail;
- a 52 px application top bar;
- a 114 px composer region at the bottom of the conversation column.

The conversation directory is a flat cross-project task list with `All`, `Direct`, `Group`, filter,
and create actions. Rows show title, latest activity, participant or group, project, time, and task
status. Project grouping remains available on the dedicated Projects page and must not reappear as
a folder tree in this directory.

The conversation header shows the active Agent or group, the exact model used for the active run,
the project, and task controls. Messages show truthful Agent identity, model, time, token metadata
when recorded, tool-call rows, planning notices, streaming state, and user messages. The detail rail
uses the Figma tabs `Task progress`, `Files and artifacts`, and `Execution details`; approvals,
subtasks, parent navigation, artifacts, traces, and run controls remain reachable through these
regions or their local overflow actions.

This replacement is presentation-only. Existing Runtime and SQLite behavior for task loading,
creation, selection, message sending, streaming, Agent/model selection, collaboration upgrades,
approvals, child tasks, artifacts, pause, terminate, archive, and trace inspection must remain wired
to the same real callbacks. No demo record may replace persisted state. Missing optional data uses a
truthful empty state in the matching Figma region.
