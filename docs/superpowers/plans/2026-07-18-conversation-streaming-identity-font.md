# Conversation Streaming, Identity, And Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver bordered streaming chat turns, a truthful thinking state, stable task/message Agent identity, a richer conversation directory, and a persistent application font-size control.

**Architecture:** Preserve the existing durable event and Runtime contracts. Extend the pure Agent profile projection for task identity, add font persistence to Renderer preferences, then feed those results into existing Talk and MessageBubble components with focused CSS tokens.

**Tech Stack:** React 18, TypeScript, Electron Renderer, Vitest/jsdom, Testing Library, lucide-react, existing SYNC-THINK event projections.

---

### Task 1: Add streaming thinking and bordered message contracts

**Files:**

- Modify: `packages/ui-kit/tests/MessageBubble.test.tsx`
- Modify: `packages/ui-kit/src/components/MessageBubble.tsx`
- Modify: `packages/ui-kit/src/styles/components.css`

- [x] Add a failing test that renders an empty streaming assistant turn and expects
      `data-testid="message-thinking"` with `<Agent> 正在思考...`.
- [x] Add a failing test that rerenders the same streaming turn with text and expects the thinking
      state to disappear while the text and stream cursor remain.
- [x] Run `pnpm.cmd --filter @sync-think/ui-kit exec vitest run tests/MessageBubble.test.tsx` and
      confirm RED on the missing thinking state.
- [x] Render the compact thinking pill only when `streaming && !String(children).trim()`.
- [x] Change final message CSS so user and assistant bodies use bordered surfaces, while Agent
      identity remains outside the assistant body and Markdown keeps wrapping.
- [x] Re-run the focused test and confirm GREEN.

### Task 2: Project one primary Agent identity per task

**Files:**

- Modify: `apps/desktop/src/renderer/agent-profile-projection.ts`
- Modify: `apps/desktop/tests/agent-profile-projection.test.ts`
- Modify: `apps/desktop/src/renderer/index.tsx`

- [x] Add failing tests for `projectTaskPrimaryAgentVersions(events)`: later sequence wins, another
      task cannot leak, and `reviewerAgentVersionId` alone cannot replace the primary Agent.
- [x] Run `pnpm.cmd --filter @sync-think/desktop exec vitest run tests/agent-profile-projection.test.ts`
      and confirm RED because the projector is absent.
- [x] Implement the pure ordered map from `event.taskId`/`payload.taskId` to primary
      `agentVersionId`/`leadAgentVersionId`.
- [x] Resolve task identities from immutable AgentVersion records and managed avatar URLs in
      `index.tsx`; use the active task identity for the header and fallback messages.
- [x] Re-run projection and conversation identity tests and confirm GREEN.

### Task 3: Match the rich conversation directory

**Files:**

- Modify: `apps/desktop/src/renderer/talk-workspace.tsx`
- Modify: `apps/desktop/src/renderer/renderer.css`
- Modify: `apps/desktop/tests/talk-workspace.test.tsx`

- [x] Add failing render assertions for a task row avatar image/color, summary, participant,
      workspace, time, and state.
- [x] Extend `TalkConversationTaskItem` with optional `participantIcon`, `participantColor`, and
      `participantAvatarUrl` fields and render them without changing group semantics.
- [x] Add compact row styling: stable avatar track, two-line summary, metadata footer, right-aligned
      state, and active left accent. Keep child/archive actions keyboard reachable.
- [x] Re-run `talk-workspace.test.tsx` and the Desktop shell contract.

### Task 4: Add persistent application font sizing

**Files:**

- Modify: `apps/desktop/src/renderer/ui-preferences.ts`
- Modify: `apps/desktop/tests/ui-preferences.test.ts`
- Modify: `apps/desktop/src/renderer/talk-workspace.tsx`
- Modify: `apps/desktop/src/renderer/index.tsx`
- Modify: `apps/desktop/src/renderer/renderer.css`
- Modify: `apps/desktop/tests/talk-workspace.test.tsx`

- [x] Add failing preference tests for default 14, persistence, and rejection/clamping of values
      outside 13-18.
- [x] Implement `readFontSizePreference`, `writeFontSizePreference`, and `applyFontSizePreference`
      with root CSS variables.
- [x] Add an Appearance range input (`min=13`, `max=18`, `step=1`) with current pixel value and an
      `onFontSizeChange` callback.
- [x] Wire state initialization, root application, and localStorage persistence in `index.tsx`.
- [x] Consume the scale in root typography tokens plus message, directory, settings, and Composer
      text selectors without scaling fixed layout geometry.
- [x] Run focused preference, settings, Talk, and MessageBubble tests.

### Task 5: Verify, document, rebuild, and restart

**Files:**

- Modify: `docs/development/03-feature-changelog.md`
- Modify: `docs/development/10-current-status.md`
- Modify: `docs/development/12-test-log.md`
- Modify: `docs/handoff/05-handoff-guide.md`
- Modify: `docs/superpowers/plans/2026-07-18-conversation-streaming-identity-font.md`

- [x] Run focused Desktop and UI Kit tests with zero failures.
- [x] Run Desktop and UI Kit full tests.
- [x] Run `turbo run test`, `turbo run typecheck`, and `turbo run build` serially with `--force`.
- [x] Run `git diff --check`.
- [x] Record exact verification results and mark this plan complete.
- [x] Restart only the SYNC-THINK Desktop process tree, preserve the online Runtime and real data,
      and verify that the new Electron window is responsive.

The current worktree contains unrelated uncommitted work. Do not commit, push, merge, reset, or clean
unless the user explicitly requests it.
