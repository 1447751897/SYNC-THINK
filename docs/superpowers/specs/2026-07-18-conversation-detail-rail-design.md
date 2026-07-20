# Conversation Detail Rail Design

Date: 2026-07-18
Status: Approved by user
Reference: Figma Make `Talk` V8 and user-provided task-progress screenshot

## 1. Goal

Replace the current mixed task-detail implementation with three Figma-aligned, user-facing views:

1. `任务进度`: truthful Run summary and ordered execution steps;
2. `文件与产物`: a compact artifact directory with detail-on-demand;
3. `执行详情`: one log record per user-message turn, with a modal that groups the turn by Agent stage.

The rail must remain narrow and scannable. Raw events, Manifest evidence, versions, and long Agent
exchanges belong behind an explicit detail action rather than being rendered as an always-expanded
rail.

## 2. Locked Decisions

- One user message starts one conversation-log turn.
- Every event caused by that message remains in the same turn until the next user message begins.
- A group turn can contain multiple Agent stages. Every stage must identify its exact Agent,
  responsibility, model, state, and elapsed time when the Runtime recorded those values.
- Stage bodies are collapsed by default. Expanding one stage reveals its ordered events.
- The complete turn opens in a modal; the right rail only shows turn summaries.
- The right rail no longer contains an approval card, approval tab, or approval sub-navigation.
- Existing configuration confirmation and human-only safeguards remain Runtime behavior and may
  appear inline at the affected conversation action. They are not part of these three rail views.
- Existing real task, event, AgentVersion, Run graph, Manifest, artifact, and usage records remain
  the only data source. No mock progress, fake logs, or inferred token values are allowed.

## 3. Task Progress

`任务进度` follows the Figma hierarchy shown in the approved reference.

### 3.1 Run summary

The first block is a compact four-row definition list:

- `Run ID`: current or most recent Run id, shortened visually but available in full via title/copy;
- `状态`: running, completed, failed, paused, cancelled, or not started;
- `步骤进度`: completed steps / total steps;
- `已用时`: calculated from persisted start and terminal timestamps, or live while running.

When no Run exists, the block remains stable and shows `尚未开始`, `0 / 0`, and `--` rather than
disappearing.

### 3.2 Execution steps

Below the summary, render `执行步骤` as a numbered, border-separated list matching Figma density.
Each row shows:

- stable sequence number;
- complete/running/waiting/failed state icon;
- step title;
- exact Agent name on hover or in the expanded accessible label.

The list comes from the current persisted Run graph. For a simple one-Agent conversation without a
graph, derive one stage from the Run events so the view still communicates progress truthfully.

### 3.3 Participants

After the steps, show compact Agent rows using the Figma participant treatment. Each row contains
avatar, Agent name, responsibility or fixed role, model, and current step state. A direct
conversation normally has one row; a group turn can have several.

Task archive/restore and child-task creation remain available through their existing task/header
actions, but they are not mixed into the progress body. Approval content is not rendered here.

## 4. Files And Artifacts

`文件与产物` becomes a compact directory instead of rendering the complete version-management
surface directly inside the 260 px rail.

Each persisted artifact row shows:

- file-type icon derived from MIME type;
- artifact name;
- latest version and selected-version state;
- producing Agent/model when recorded;
- creation/update time and conflict/error state.

Selecting a row opens an artifact-detail modal. The modal reuses the existing real artifact
version behavior: version history, compare, select, merge, and conflict resolution. This preserves
the existing capability while keeping the rail visually aligned with Figma.

The page does not scan arbitrary workspace files. It lists persisted task artifacts only. The
empty state states that files produced by the task will appear here.

## 5. Conversation Execution Logs

### 5.1 Rail list

`执行详情` shows one row per user-message turn, newest first. A row contains:

- turn number and user-message summary;
- started time and total elapsed time;
- terminal state;
- participating Agent count;
- model-call count;
- artifact/error indicators when present.

The rail never renders raw event payloads or a second Trace/Graph/Approval tab bar.

### 5.2 Turn modal

Clicking a row opens a modal with:

1. turn header: user request, state, start/end time, total duration, Run ids;
2. final assistant response summary when one exists;
3. an ordered Agent-stage timeline;
4. totals for model calls, tools, tokens, artifacts, and errors when recorded.

The modal uses a constrained desktop size (`min(880px, 92vw)` and at most `86vh`) with a fixed
header and scrollable body. It closes by close button, backdrop, or Escape, restores focus to the
origin row, and traps focus while open.

### 5.3 Agent stages

Each stage header shows:

- Agent avatar and exact AgentVersion name;
- group responsibility or fixed Agent role;
- provider model used for that stage;
- completed/running/failed/waiting state;
- stage duration.

Stages are collapsed by default. Expanding a stage shows its chronological event log:

- context/Manifest preparation;
- model start, fallback, usage, completion, pause, cancellation, or failure;
- tool and MCP requests/results;
- subtask delegation and handoff;
- artifact creation and review results;
- Runtime recovery events.

Event rows show user-facing summaries first. Technical ids and recorded evidence appear in a
secondary definition list. Secret values and raw credential handles are never displayed.

Runtime-only events that cannot be attributed to an Agent appear in a separate `SYNC-THINK
Runtime` stage rather than being assigned to the wrong Agent.

## 6. Projection And Data Flow

Add a pure renderer projector for conversation logs. It accepts the active task/thread event
history plus AgentVersion and group-responsibility lookup data, and returns UI-only turn/stage
records.

Projection rules:

1. merge and order events using the existing durable sequence rules;
2. filter to the active thread/task before grouping;
3. start a turn at each user `message.appended` event;
4. attach subsequent events until the next user message;
5. group Agent stages by Step when `stepId` exists, otherwise by Run plus exact
   `agentVersionId`;
6. keep fallback/retry events in the stage that caused them;
7. derive state and duration only from persisted timestamps and terminal events;
8. sum usage only from recorded `provider.usage` events;
9. retain unattributed events in the Runtime stage.

No storage schema or Runtime command is required for this slice. If an event lacks enough data,
the UI displays `未记录` rather than inventing a value.

## 7. Component Boundaries

- `ConversationTaskProgress`: Run summary, steps, and participants.
- `TaskArtifactDirectory`: compact artifact list and empty/error states.
- `ConversationLogList`: turn-level summaries in the rail.
- `ConversationLogDialog`: complete turn and Agent-stage timeline.
- `ConversationLogStage`: collapsible stage event list.
- `projectConversationLogs`: pure event-to-turn projector.

The existing task workspace continues to own tab selection and supplies these views as the right
rail content. Existing pause/terminate controls remain in the task header. Existing
`ArtifactVersionsPanel` is reused inside the artifact modal rather than duplicated.

## 8. Responsive And Visual Rules

- Preserve the current 260 px expanded detail rail and 36 px collapsed rail.
- Use Figma's flat rows, hairline dividers, compact 10-12 px metadata, teal running state, green
  complete state, red failure state, and neutral waiting state.
- Do not add nested cards. The Run summary may use one bordered block; lists remain unframed.
- Modal content must not overflow horizontally at 1280x720 or 1440x900.
- Long Agent/model names truncate with a title, while log messages wrap.
- Respect light/dark tokens and `prefers-reduced-motion`.

## 9. Error And Empty States

- No active task: `选择一个对话任务后查看进度`.
- No Run: stable not-started summary and no fabricated steps.
- No artifacts: `任务生成的文件与产物会出现在这里`.
- No conversation logs: `发送第一条消息后，这里会记录本轮执行详情`.
- Partial event history: show available stages and mark absent fields as `未记录`.
- Failed turn: keep successful earlier stages visible and identify the exact failed Agent stage.

## 10. Test Strategy

Follow TDD with these RED-to-GREEN slices:

1. projector groups one user message and its Run events into one turn;
2. two user messages never share events;
3. multi-Agent steps produce ordered, correctly attributed stages;
4. Runtime-only, fallback, retry, usage, artifact, and failure events remain truthful;
5. unrelated task/thread events are excluded;
6. progress renders Figma summary/steps without approval UI;
7. execution rail renders one row per turn and opens/closes the modal accessibly;
8. stage expansion reveals only that Agent's events;
9. artifact directory opens the existing version panel in a modal;
10. Desktop full tests, UI Kit tests, typecheck, build, and diff check pass.

## 11. Acceptance Criteria

1. `任务进度` matches the Figma hierarchy and contains no approval card or approval tab.
2. Run id, status, step count, duration, steps, Agents, and models come from real records.
3. `文件与产物` is a compact list; selecting an artifact preserves all existing version actions.
4. `执行详情` contains exactly one summary row per user-message turn.
5. A group turn modal clearly identifies which stage and log belongs to which Agent.
6. Long turns remain usable because stage bodies are collapsed by default.
7. No sibling task events, secret values, or invented usage data appear.
8. Existing conversation sending, model routing, pause/terminate, artifacts, theme, and rail
   collapse behavior do not regress.
