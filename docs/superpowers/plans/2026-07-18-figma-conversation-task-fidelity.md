# Figma Conversation Task Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy task `AppShell` presentation with the approved Figma Talk conversation workspace while preserving every existing Runtime-backed task capability.

**Architecture:** Add a focused renderer component that owns only the five-region task layout and accepts existing task UI as typed slots plus real task directory data. Keep state, IPC calls, persistence, message execution, approvals, artifacts, and orchestration in `index.tsx`; adapt those existing handlers into the new component rather than duplicating domain logic.

**Tech Stack:** React 18, TypeScript, Vitest/jsdom, lucide-react, Electron renderer CSS, pnpm/Turbo.

---

### Task 1: Lock the task workspace contract

**Files:**
- Modify: `apps/desktop/tests/talk-workspace.test.tsx`
- Modify: `apps/desktop/tests/beginner-desktop-shell.test.ts`

- [x] Add a failing render test for `TalkConversationTaskWorkspace` that asserts the directory filters, create action, active task metadata, conversation log, composer, and three detail tabs exist.
- [x] Add a failing source contract asserting the task branch uses `TalkConversationTaskWorkspace` and no longer uses `AppShell` for task presentation.
- [x] Run `pnpm --filter @sync-think/desktop test -- talk-workspace.test.tsx beginner-desktop-shell.test.ts` and confirm failure because the new component and branch do not exist.

### Task 2: Build the dedicated five-region component

**Files:**
- Modify: `apps/desktop/src/renderer/talk-workspace.tsx`
- Test: `apps/desktop/tests/talk-workspace.test.tsx`

- [x] Define typed task-directory records with task, workspace, participant, activity, status, and collaboration fields.
- [x] Implement `TalkConversationTaskWorkspace` with a 240 px flat directory, filters, create callback, active-task selection, fluid conversation, composer, and 260 px detail rail.
- [x] Preserve `Ctrl+\\` detail collapse and expose controlled collapse callbacks.
- [x] Run the focused renderer test and confirm it passes.

### Task 3: Adapt existing real task behavior

**Files:**
- Modify: `apps/desktop/src/renderer/index.tsx`
- Modify: `apps/desktop/tests/beginner-desktop-shell.test.ts`

- [x] Project existing workspace/task records into the flat directory without changing Runtime calls.
- [x] Route selection to the existing `openTask`, creation to the existing project task flow, and filters to local presentation state.
- [x] Reuse the existing complete conversation, Composer, and right-rail content as slots so sending, streaming, Agent/model changes, approvals, child tasks, artifacts, archive, pause, terminate, and trace inspection retain their existing callbacks.
- [x] Replace the task `AppShell` branch with `TalkConversationTaskWorkspace`; leave all non-task sections on their dedicated Talk surfaces.
- [x] Run both focused contract tests and confirm they pass.

### Task 4: Match the approved Figma geometry and density

**Files:**
- Modify: `apps/desktop/src/renderer/renderer.css`
- Test: `apps/desktop/tests/beginner-desktop-shell.test.ts`

- [x] Add contract assertions for the locked 200/240/fluid/260 columns, 52 px top bar, and 114 px composer.
- [x] Add the dedicated task workspace styles, message metadata treatment, flat directory rows, header actions, detail tabs, light/dark parity, and reduced-motion behavior.
- [x] Remove task-specific CSS dependence on the old `AppShell` grid while retaining unrelated AppShell styles for other code paths.
- [x] Run the focused tests and confirm they pass.

### Task 5: Verify without launching the UI

**Files:**
- Modify only if verification exposes a defect.

- [x] Run `pnpm --filter @sync-think/desktop test` and confirm zero failures.
- [x] Run `pnpm --filter @sync-think/desktop typecheck` and confirm zero TypeScript errors.
- [x] Run `pnpm --filter @sync-think/desktop build` and confirm a successful renderer, preload, and main build.
- [x] Review `git diff` to verify no Runtime contract or unrelated user change was reverted.

Visual browser/Electron inspection is intentionally omitted for this execution because the user
will rebuild and inspect the page locally.

### Verification Record

- Focused Desktop contracts: **23/23 PASS**.
- Desktop: **59 files / 386 tests PASS**.
- UI Kit: **21 files / 233 tests PASS**.
- Repository test graph: **21/21 tasks PASS**, serial, forced, **0 cache**.
- Repository typecheck graph: **21/21 tasks PASS**, forced, **0 cache**.
- Repository build graph: **12/12 tasks PASS**, forced, **0 cache**; Desktop main, preload, and renderer assets generated.
- `git diff --check`: PASS.
