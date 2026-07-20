# Figma Product Pages Fidelity Design

Date: 2026-07-18
Status: Approved by user through supplied Figma reference screenshots
Extends: `2026-07-18-agent-aware-talk-workspace-design.md`

## 1. Goal

Bring the conversation, Projects, Friends, Groups, Automation, Providers, and Skill & MCP pages onto
the same Figma Talk product skeleton without replacing any persisted Runtime behavior. The supplied
Figma screenshots are the visual hierarchy reference; current screenshots define the concrete
regressions to remove.

## 2. Shared Page Skeleton

The global SYNC-THINK navigation and 52 px top bar remain fixed. Every non-task section renders
directly inside the remaining stage and must fill its full width and height. Non-task sections must
not be wrapped in the legacy `AppShell`.

Resource pages use this structure:

```text
global navigation | contextual directory | resource header / tabs / detail
```

The contextual directory is 240-260 px, uses flat rows, a selected left accent, search/filter
controls, and one visible create command. Detail content scrolls inside its own region instead of
ending early and exposing an unrelated blank background.

## 3. Conversation Corrections

- Opening a task updates `lastOpenedAt` only. It must not update the task content `updatedAt`, so a
  click cannot move the row to the top.
- Conversation ordering uses real content/activity time and a deterministic tie-breaker. Selection
  does not participate in ordering.
- The empty conversation CTA uses the product primary color and an explicit on-primary text token;
  Talk's inherited button color must not make the label invisible.
- The conversation reading column uses the full available center canvas. Assistant messages may
  occupy up to roughly 1040 px, while user turns remain right-aligned and narrower.
- Existing streaming, identities, models, logs, artifacts, task controls, and Composer callbacks
  remain unchanged.

## 4. Projects

Projects reproduce the Figma hierarchy:

```text
project list | selected project's task list | live conversation | task detail
```

The selected project header shows its name, optional bound folder, tabs, bind/change workspace, and
new task command. The project task list contains only that project's non-archived tasks. Opening a
project task keeps the user on Projects and renders the same real conversation, Composer, progress,
artifacts, and execution logs used by Conversation Tasks. Project settings remain a local tab.

## 5. Friends / Agents

Friends remains a projection of persisted Agents.

- Directory: status counts, search, avatar, name, role/description, online/busy/offline, and active
  task count.
- Profile header: large identity, description, start-task command, join-group navigation, and edit.
- Tabs: `资料`, `任务`, `能力与指令`, `运行时`, `Skills`, `工具`, `更多`.
- `资料`: provider, credential group, default model, maximum concurrency, status, current tasks,
  group memberships, and recent tasks.
- `能力与指令`: fixed prompt, input contract, output contract, memory scope, and concise capability
  summaries. Editing uses grouped fields rather than one unbounded raw form.
- `运行时`: preserves the existing credential group -> provider -> model and fallback editor.
- `Skills` and `工具`: preserve real Skill and MCP binding and management.
- `更多`: version history and advanced immutable evidence only.

Agent creation is an inline detail form, not `window.prompt`. It collects name, role, description,
fixed prompt, and maximum concurrency, then calls the existing Runtime `agent.create` path and opens
the created Agent.

Agent-level approval controls are removed from the UI. New and edited Agents use the internal
non-blocking default; task operation confirmations and group/automation permission settings remain
separate product concepts.

## 6. Groups, Automation, Providers, Skill & MCP

These pages use the same full-height directory/detail shell and their existing real operations:

- Groups: list, group profile, members and responsibilities, exactly one lead, collaboration mode,
  concurrency, create/edit, and create task.
- Automation: list, schedule/webhook detail, target, execution history, create/edit, enable/disable,
  run, and delete.
- Providers: surface tabs, provider list, credential groups, models, edit, discovery, capability
  probing, and CC Switch import.
- Skill & MCP: segmented Skill/MCP library, list, detail, import/register, and truthful metadata.

No page may render as a short legacy panel above a large unrelated blank region.

## 7. Error And Empty States

Empty states state what is missing and expose one real command. Errors remain in the owning detail
region. Create/edit forms keep user input on Runtime failure. Disabled controls remain labelled and
must not become blank rectangles in either theme.

## 8. Testing And Acceptance

- TDD coverage proves opening a task does not mutate `updatedAt` or reorder the directory.
- Render tests prove the empty CTA label is visible by contract and each resource page owns a
  full-height Talk surface.
- Agent tests prove New opens the inline form, submitting calls Runtime creation, and Agent approval
  controls are absent.
- Project tests prove the four-region hierarchy and live task workspace wiring.
- Existing package tests, full repository tests, typecheck, build, Prettier, and diff checks pass.
- Rebuild and restart only Desktop Electron; preserve both Runtime processes and persisted data.
- The user performs final visual acceptance after restart.
