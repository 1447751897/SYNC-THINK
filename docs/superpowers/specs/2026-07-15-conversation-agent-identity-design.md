# SYNC-THINK Conversation Agent Identity Design

> Status: approved by the user on 2026-07-15
> Reference: Multica comment/activity identity pattern
> Scope: desktop task header and conversation stream; Composer remains unchanged

## 1. Goal

Make the current task context understandable without internal terminology and make every assistant turn visibly belong to an Agent. Preserve the current Codex-style document reading flow instead of returning to large assistant message cards.

## 2. Context strip

The three scaffold entries above the conversation represent the current workspace, task, and conversation version. While they are scaffold entries, they must use the plain labels `工作区`, `任务`, and `对话`.

They must not be labelled `决策`, `记忆`, or `上下文` merely to fit the durable Continuum taxonomy. Those semantic labels remain valid only for real Continuum evidence written later.

## 3. Milestone validation surface

The `M1 验证` workbench was a development and exit-evidence surface. M1 and M2 are complete, so it is hidden from the normal product composition.

Its projectors, tests, and documentary evidence remain in the repository. Hiding it must not delete historical evidence or alter milestone results.

## 4. Agent identity in conversation

Assistant turns use a Multica-inspired teammate identity header:

- a stable round avatar sits in the left gutter;
- the exact Agent name appears above the response;
- the avatar uses the Agent version's configured icon and color, with a deterministic fallback;
- an in-flight turn has a small non-text streaming indicator;
- activating the avatar or name opens the matching Agent in the Agent drawer;
- the assistant body remains an unframed Markdown reading flow;
- user turns remain compact right-aligned bubbles.

Model IDs, credential IDs, Run IDs, Step IDs, and other execution metadata remain in Trace and Manifest. They do not return to the conversation header.

## 5. Identity resolution

1. `run.started.agentVersionId` is projected onto the assistant message.
2. The renderer resolves that immutable version from the loaded Agent version catalog.
3. Older events without `agentVersionId` fall back to the currently bound Agent.
4. If no Agent catalog is available, the message still renders a generic `Agent` avatar rather than an empty gutter.

Historical messages must keep the identity of the Agent version that produced them when that version is available.

## 6. Accessibility and layout

- Avatar/name activation is a real button with an Agent-specific accessible name.
- Identity is expressed by icon, name, and accessible text; color is never the sole indicator.
- The avatar track has a stable width and must not resize while streaming.
- Long Agent names truncate without overlapping the message body.
- At narrow widths the avatar becomes smaller, but remains visible.
- Reduced-motion mode disables decorative streaming animation.

## 7. Acceptance criteria

1. The top three scaffold chips read `工作区`, `任务`, and `对话`.
2. The `M1 验证` disclosure is absent from the normal visible workspace.
3. Every assistant message shows a round avatar and Agent name; user messages do not.
4. Exact `agentVersionId` survives streaming, completion, fallback, and restart projection.
5. Activating an assistant identity opens the corresponding Agent drawer.
6. Assistant Markdown, user bubbles, Composer, Trace, and Manifest retain their existing behavior.
7. Focused tests, full Desktop/UI Kit tests, typecheck, build, and Electron visual QA pass.
