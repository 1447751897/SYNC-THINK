# Conversation Streaming, Identity, And Font Design

Date: 2026-07-18
Status: Approved by user
References: user screenshots for bordered chat turns, thinking state, and rich task directory

## 1. Goal

Make the Talk conversation understandable at a glance: messages read as bounded chat turns, an
Agent becomes visible before its first token, streaming text appears immediately, the conversation
directory and message timeline use one stable Agent identity, and users can adjust application text
size from Settings.

## 2. Locked Decisions

- Both user and Agent turns use quiet bordered surfaces in light mode and token-equivalent surfaces
  in dark mode.
- Agent identity remains above the Agent message body. The body is a separate bordered bubble aligned
  to the identity gutter.
- `run.started` with no delta renders a compact `<Agent> 正在思考...` state.
- The first and every following `message.delta` immediately replaces/updates the thinking state. The
  UI must never wait for `message.appended` or `run.completed` before showing text.
- Existing Markdown, model, time, truthful token metadata, Agent activation, and streaming cursor stay.
- The conversation directory shows title, latest summary, time, real Agent/group identity, project,
  and real task state with the density of the approved screenshot.
- Direct-task avatars, the task header, and message fallback identity use the latest exact
  `AgentVersion` recorded for that task. The current Compose selection is used only before a task has
  recorded an AgentVersion.
- Group tasks keep a group identity; they do not impersonate one member.
- Settings -> Appearance contains a 13-18 px font slider, default 14 px. It changes major application
  text and conversation reading sizes while icon/button/layout dimensions remain stable.
- The font preference is Renderer-local and restart-safe. It does not require a Runtime schema.

## 3. Message States

```text
run.started, no text       Agent header + compact thinking pill
first message.delta        Agent header + bordered body containing first text chunk
later message.delta        append to the same body immediately
terminal event             remove cursor; keep the completed bordered body
```

The existing durable event projector remains the source of truth. This slice changes rendering and
adds explicit thinking markup; it does not buffer Provider output.

## 4. Stable Task Identity

A pure projection maps each task to its latest recorded primary `agentVersionId` by ordered durable
events. Primary keys include `agentVersionId` and `leadAgentVersionId`; reviewer/delegate-only keys do
not replace the primary conversation identity. Renderer composition resolves that immutable version
to name, icon, color, and managed avatar URL.

For the active direct task, this projected identity is used by:

1. the conversation-directory row;
2. the task header;
3. assistant messages that lack an exact historical `agentVersionId`.

Messages with their own exact AgentVersion continue to use that historical identity.

## 5. Execution Steps

`任务进度 -> 执行步骤` remains truthful:

- collaboration/orchestration tasks read persisted `RunGraphResponse.steps` in plan order;
- direct conversations without a graph use only stages proven by durable Run/Step events;
- the UI does not invent planner/executor/reviewer steps from prompt text.

## 6. Font Preference

Add `FontSizePreference` validation and persistence beside the existing theme/layout preferences.
The root receives `--st-user-font-scale` and `--st-user-font-size`. Existing typography tokens and
the high-value Talk/message selectors consume those variables. Range input keyboard behavior and its
numeric value remain native and accessible.

## 7. Testing

- MessageBubble component tests cover empty-stream thinking and immediate text-stream body.
- Agent projection tests cover event order, primary identity, and task isolation.
- Talk workspace tests cover avatar/image rendering and rich metadata.
- UI preference tests cover default, bounds, persistence, and invalid values.
- Settings tests/contracts cover the font slider and root application.
- Run existing Desktop/UI Kit/full repository test, typecheck, and build gates.
- Rebuild and restart Desktop after verification for user inspection.

## 8. Visual Boundary

The supplied screenshots define hierarchy and density, not copied fake data. Runtime state, Agent
identity, models, summaries, times, and steps remain real. Final visual acceptance belongs to the user
after the required Desktop restart.
