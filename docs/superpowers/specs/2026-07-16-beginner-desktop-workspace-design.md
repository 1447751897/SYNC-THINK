# SYNC-THINK Beginner Desktop Workspace Design

> Status: approved by the user on 2026-07-16
> Reference: Multica desktop information hierarchy
> Scope: desktop shell, task header, context rail expression, right task rail
>
> 2026-07-16 conversation-first refinement: the user explicitly replaced manual task naming,
> persistent folder subtitles, and manual participation-mode switching with the behavior in
> sections 3-5 below.

## 1. Goal

Make the normal desktop workspace understandable to a first-time, non-technical user without removing the product's local-first, multi-model, multi-Agent capabilities.

Within ten seconds, the user should be able to answer:

1. Which task is open?
2. Which Agent is responsible?
3. Which model will run?
4. What should I do next?
5. Where will progress and results appear?

## 2. Relationship To Existing Decisions

This specification preserves the approved three-region workspace:

- left: local folders and nested tasks;
- center: complete scrollable conversation and unchanged Compose behavior;
- right: collapsible task/run information;
- top of center: the context-continuity structural slot.

It supersedes only the normal-product presentation of these regions:

- icon-only product navigation is replaced by icon plus persistent text;
- scaffold Continuum chips are replaced by a plain task breadcrumb and one actionable next-step row;
- technical Run details are no longer the default right-rail surface;
- Trace, Manifest, execution graph, approvals, and artifact version tools remain available on demand.

No provider, credential, Agent, model-routing, task, event, or execution contract changes are part of this work.

## 3. Left Navigation

The left rail has three stable layers:

1. SYNC-THINK product identity.
2. Product navigation with visible labels: `任务`, `智能体`, `模型源`, `审批`.
3. The selected section's content. For `任务`, this is the existing project and nested task tree.

Projects do not render their bound folder as a persistent subtitle. Focusing or hovering a bound
project reveals the canonical folder path in a tooltip. Folder binding remains a project property,
not a second visible hierarchy level.

`记忆` remains available as a secondary tool below the task tree. Runtime connection state remains visible but visually quiet.

Selecting `任务` closes any open tool drawer. Selecting another section opens the existing single-layer drawer and keeps its data and actions unchanged.

## 4. Task Header And Next Step

The task header shows only user-facing task facts:

- workspace/task breadcrumb;
- task title and status;
- display/theme controls.

Agent, model, and project context live in the Composer toolbar, where they are actionable. The
project control shows the active project and can switch to the last active task in another project.
This avoids duplicating non-actionable Agent/model facts in the header.

The context-continuity slot remains structurally present but uses one plain `下一步` row. Its copy is derived from actual state:

- no task: select or create a task;
- Runtime offline: reconnect;
- Agent/model not ready: configure the Agent runtime;
- streaming: wait while the Agent works;
- ready with no conversation: describe the work in Compose;
- ready with history: continue the task or inspect results.

Internal vocabulary such as Manifest, event IDs, task versions, and context-transfer taxonomy must not appear in this normal header.

## 5. Conversation

The approved conversation identity design remains authoritative:

- assistant messages use a stable circular Agent avatar, exact Agent name, and open Markdown reading flow;
- user messages remain compact and right aligned;
- activating the Agent identity opens that Agent;
- Composer functionality and model-routing behavior remain unchanged.

The Composer placeholder may name the selected Agent so the recipient is explicit.

Creating a task is immediate and does not ask for a title or goal. The task uses an internal
placeholder until the first user message is durably appended, then derives a concise title from
that request. The full first request becomes the initial task goal.

Participation remains one conversation surface. The product does not show a manual
`对话 / 协作 / 自动` switch in the task header. An explicit multi-Agent request, or a sufficiently
complex end-to-end request, upgrades the task to collaboration and creates an editable plan using
configured Agent versions. The plan still requires the existing approval gate before execution.
Simple conversation remains one-Agent chat.

## 6. Right Rail

The default right-rail title is `任务进度` and its default view is a beginner overview:

- current state summary;
- three plain progress steps;
- one explicit next action;
- responsible Agent and model;
- pending approval summary when applicable;
- recent artifacts or an honest empty state.

An `执行详情` action opens the existing advanced tabs: `轨迹`, `执行图`, `审批`, and `产物`. Advanced views preserve all current behavior. Returning to `任务进度` requires one clear back action.

Automatic navigation to an approval, graph, or artifact may open that exact advanced view because the user's action already establishes intent.

## 7. Visual System

- Keep the existing light/dark token system and graphite/green-gray product identity.
- Use true surfaces, 1px borders, 4-8px radii, and restrained elevation.
- Keep left and right rails quieter than the conversation.
- Avoid nested cards, oversized pills, decorative gradients, giant type, and technical dashboard density.
- Navigation and progress labels remain readable at 1366x768 and Windows high-DPI scaling.
- Icon-only utility controls retain tooltips and accessible labels.

## 8. Acceptance Criteria

1. The left product navigation uses visible Chinese labels and identifies the selected section.
2. The task tree remains the only flexible scrolling region in the left rail.
3. The task header is limited to project/task identity, status, and display controls; Agent, model,
   and project switching are available in Compose without exposing IDs.
4. One actionable `下一步` row replaces scaffold Continuum chips in the normal workspace.
5. The right rail opens on `任务进度`, not Trace or Manifest.
6. Trace, Manifest, graph, approvals, and artifact version tools remain reachable under `执行详情`.
7. Empty, offline, unconfigured, ready, streaming, and result states use truthful copy derived by a pure tested projector.
8. Conversation identity, Compose, task switching, provider/Agent drawers, model routing, trace collapse, themes, and keyboard behavior do not regress.
9. Focused tests, full Desktop/UI Kit tests, typecheck, build, and Electron visual QA pass.
10. Bound folder paths appear only in an accessible hover/focus tooltip in the project tree.
11. New tasks require no naming dialog and receive a durable title from the first user message.
12. Multi-Agent intent upgrades within the same conversation and produces an editable,
    approval-gated plan without manual mode switching.
