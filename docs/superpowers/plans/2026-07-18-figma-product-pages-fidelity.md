# Figma Product Pages Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the reported task/conversation bugs and make Projects, Friends, Groups,
Automation, Providers, and Skill & MCP reproduce the approved Figma Talk product hierarchy while
preserving all real Runtime behavior.

**Architecture:** Fix task activity semantics at the storage source, then render each product page
directly in the Talk stage instead of passing non-task resources through legacy `AppShell`. Reuse
the existing real task canvas and resource callbacks, and reshape Agent creation/profile editing
inside `AgentWorkspace` rather than introducing duplicate data stores.

**Tech Stack:** React 18, TypeScript, Electron, Vitest/jsdom, SQLite, existing UI Kit and Lucide.

---

### Task 1: Stable Task Ordering And Visible Empty CTA

**Files:**

- Modify: `packages/storage/src/workspace-store.ts`
- Modify: `packages/storage/src/workspace-store.test.ts`
- Modify: `apps/desktop/src/renderer/renderer.css`
- Modify: `apps/desktop/tests/beginner-desktop-shell.test.ts`

- [x] Add a storage regression test that records a task's `updatedAt`, calls `openTask` with a later
      timestamp, and expects only `lastOpenedAt` to change.
- [x] Run `pnpm --filter @sync-think/storage exec vitest run src/workspace-store.test.ts` and confirm
      the new assertion fails because `openTask` currently writes both columns.
- [x] Change the SQL to `UPDATE task SET last_opened_at = ? WHERE id = ?`; retain existing missing
      task handling and response shape.
- [x] Add a Desktop CSS contract requiring
      `.st-talk-conversation-workspace .st-beginner-empty > button` to use
      `background: var(--st-color-primary)` and `color: var(--st-color-on-primary, #fff)`.
- [x] Run the two focused test files and confirm GREEN.

### Task 2: Direct Full-Height Talk Section Surfaces

**Files:**

- Modify: `apps/desktop/src/renderer/index.tsx`
- Modify: `apps/desktop/src/renderer/talk-workspace.tsx`
- Modify: `apps/desktop/src/renderer/renderer.css`
- Modify: `apps/desktop/tests/beginner-desktop-shell.test.ts`
- Modify: `apps/desktop/tests/talk-workspace.test.tsx`

- [x] Add source/render tests proving only the `tasks` section instantiates
      `TalkConversationTaskWorkspace`, while friends/providers/groups/automation/skills/settings are
      children of a full-height `st-talk-section-surface`.
- [x] Confirm RED against the current `taskMode={productSection === 'tasks'}` fallback path.
- [x] Split the index render branch: tasks render the task workspace, projects render the project
      workspace, and all resource sections render directly in `st-talk-section-surface`.
- [x] Give the surface and its immediate resource child definite `width/height: 100%`,
      `min-width/min-height: 0`, and owned overflow. Remove non-task AppShell override rules that no
      longer have a caller.
- [x] Re-run Desktop shell and Talk tests.

### Task 3: Figma Conversation Reading Width

**Files:**

- Modify: `apps/desktop/src/renderer/renderer.css`
- Modify: `apps/desktop/tests/beginner-desktop-shell.test.ts`
- Test: `packages/ui-kit/tests/MessageBubble.test.tsx`

- [x] Add CSS assertions that the Talk thread is full width, assistant turns allow up to `1040px`,
      and user turns remain constrained and right aligned.
- [x] Confirm RED against the current `960px` thread and `760px` assistant limits.
- [x] Set the Talk thread to `width: 100%; max-width: none`; use a readable inner gutter and
      `max-width: min(100%, 1040px)` for assistant turns. Keep Composer geometry and message metadata
      unchanged.
- [x] Run the Desktop contract and MessageBubble suites.

### Task 4: Figma Agent Profile And Inline Creation

**Files:**

- Modify: `packages/ui-kit/src/components/AgentWorkspace.tsx`
- Modify: `packages/ui-kit/src/styles/components.css`
- Modify: `packages/ui-kit/tests/AgentWorkspace.test.tsx`
- Modify: `apps/desktop/src/renderer/index.tsx`
- Modify: `apps/desktop/src/renderer/m2-workspace.ts`
- Modify: `apps/desktop/tests/m2-workspace.test.ts`

- [x] Update tests so clicking `新建` reveals a labelled inline creation form and does not call
      `window.prompt`; submitting name, role, description, prompt, and concurrency invokes
      `onCreateAgent(input)`.
- [x] Add tests proving Agent profile tabs are `资料/任务/能力与指令/运行时/Skills/工具/更多`, the
      header exposes edit/start-task/join-group commands, and no Agent approval field or label is
      rendered.
- [x] Confirm the new tests fail against the prompt-based callback and unbounded definition form.
- [x] Introduce `AgentCreateInput` and change `AgentWorkspaceProps.onCreateAgent` to accept it. Add
      local creation/editing state that preserves drafts on failure and selects the created Agent on
      success.
- [x] Recompose the profile: Figma identity header, flat fact grid, description, groups and recent
      tasks; render fixed prompt/input/output/memory/capability sections in `能力与指令`, with grouped
      edit controls only when editing.
- [x] Remove approval controls and approval/version labels from Agent UI. Keep the required domain
      field internal and normalize new/saved Agent definitions to `full`; do not change task action
      confirmations or group/automation permission settings.
- [x] Replace `createAgent()` prompts in Desktop with the typed input callback, retaining the current
      Runtime call, error state, reload, and selection logic.
- [x] Run AgentWorkspace, m2-workspace, and Desktop wiring tests.

### Task 5: Figma Projects With Live Conversation

**Files:**

- Modify: `apps/desktop/src/renderer/talk-workspace.tsx`
- Modify: `apps/desktop/src/renderer/index.tsx`
- Modify: `apps/desktop/src/renderer/renderer.css`
- Modify: `apps/desktop/tests/talk-workspace.test.tsx`
- Modify: `apps/desktop/tests/beginner-desktop-shell.test.ts`

- [x] Add a render test for four visible regions: project directory, selected-project task
      directory, live conversation canvas, and task detail; opening a task must not navigate away
      from Projects.
- [x] Confirm RED against the current project task summary panel.
- [x] Extend `TalkProjectsWorkspace` with a typed render slot for the selected project's task
      workspace. Selecting a project chooses its first non-archived task through the existing
      `openTask` callback but keeps `productSection='projects'`.
- [x] Reuse `TalkConversationTaskWorkspace` with project-filtered task rows and all current active
      conversation/Composer/detail callbacks. Add a project directory variant for Figma labels and
      hide the redundant global task create action only where the project header already owns it.
- [x] Update CSS to grid the 230 px project rail beside the nested task/conversation/detail surface;
      preserve the existing project settings tab.
- [x] Run Talk and Desktop shell tests.

### Task 6: Groups, Automation, Providers, And Skill & MCP Fidelity

**Files:**

- Modify: `apps/desktop/src/renderer/talk-workspace.tsx`
- Modify: `apps/desktop/src/renderer/renderer.css`
- Modify: `apps/desktop/tests/talk-workspace.test.tsx`
- Test: `packages/ui-kit/tests/ProvidersPanel.test.tsx`

- [x] Add render contracts that each page has one contextual directory, one resource detail region,
      a visible create command, and a full-height root.
- [x] Confirm failures where a page still relies on inherited AppShell height or disconnected empty
      space.
- [x] Normalize Groups and Automation headers, rows, selected accents, detail tabs/facts, and form
      placement to the approved Figma density while preserving every callback.
- [x] Keep ProvidersPanel's real CC Switch/provider/model controls, but make its Talk root match the
      same directory/detail tracks and full-height overflow ownership.
- [x] Keep Skill and MCP import/register behavior, but align segmented tabs, rows, detail facts, and
      empty states with the same shell.
- [x] Run Talk and ProvidersPanel suites.

### Task 7: Verify, Document, Rebuild, And Restart

**Files:**

- Modify: `docs/development/03-feature-changelog.md`
- Modify: `docs/development/10-current-status.md`
- Modify: `docs/development/12-test-log.md`
- Modify: `docs/handoff/05-handoff-guide.md`
- Modify: this plan

- [x] Run focused tests for storage, Desktop Talk/shell/projection, AgentWorkspace, ProvidersPanel,
      and MessageBubble.
- [x] Run Desktop and UI Kit full tests.
- [x] Run `turbo run test --concurrency=1 --force`,
      `turbo run typecheck --concurrency=1 --force`, and
      `turbo run build --concurrency=1 --force`.
- [x] Run Prettier check on touched files and `git diff --check`.
- [x] Record exact results and the intentional visual boundary: supplied Figma screenshots are the
      accepted concept, while the user performs final desktop visual acceptance.
- [x] Enumerate the current Electron tree, stop only Desktop, preserve Runtime PIDs, launch the
      rebuilt app, and verify `SYNC-THINK`, `Responding=True`, and zero-byte stderr.

The current worktree contains extensive unrelated uncommitted changes. Do not commit, push, merge,
reset, clean, or revert them.
