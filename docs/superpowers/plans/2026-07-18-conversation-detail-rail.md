# Conversation Detail Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the task right rail with Figma-aligned progress, artifact directory, and per-user-turn execution logs whose modal attributes every stage to the exact Agent.

**Architecture:** Add a pure renderer projector that converts the active thread's durable events into conversation turns and Agent stages. Add focused Desktop renderer components for the three rail views and dialogs, then adapt the existing `index.tsx` data and callbacks without changing Runtime or storage contracts.

**Tech Stack:** React 18, TypeScript, Electron renderer, Vitest/jsdom, lucide-react, existing Runtime event/Run graph/artifact contracts.

---

### Task 1: Project durable events into conversation turns

**Files:**
- Create: `apps/desktop/src/renderer/conversation-log-projection.ts`
- Create: `apps/desktop/tests/conversation-log-projection.test.ts`

- [x] **Step 1: Write failing projector tests**

Cover one user turn, two isolated turns, multi-Agent Step attribution, Runtime-only events,
fallback/usage/artifact/failure data, and unrelated thread exclusion. The public contract is:

```ts
export interface ConversationLogTurn {
  id: string;
  index: number;
  userMessage: string;
  state: 'running' | 'completed' | 'failed' | 'paused' | 'cancelled' | 'unknown';
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  runIds: string[];
  modelCallCount: number;
  tokensIn?: number;
  tokensOut?: number;
  artifactCount: number;
  errorCount: number;
  finalResponse?: string;
  stages: ConversationLogStage[];
}

export function projectConversationLogs(input: {
  events: readonly Event[];
  threadId: string;
  taskId?: string;
  agents: ReadonlyMap<string, ConversationLogAgentIdentity>;
}): ConversationLogTurn[];
```

- [x] **Step 2: Run the test and confirm RED**

Run:

```powershell
pnpm.cmd --filter @sync-think/desktop test -- conversation-log-projection.test.ts
```

Expected: FAIL because the module and projector do not exist.

- [x] **Step 3: Implement the minimal pure projector**

Use `mergeEventHistory`, filter the exact thread/task, start a turn at each user
`message.appended`, and group stages by `stepId` then `runId + agentVersionId`. Preserve event
order and expose only scrubbed known fields in event details.

- [x] **Step 4: Run projector tests and confirm GREEN**

Run the same focused command. Expected: all projector tests pass.

### Task 2: Build the Figma task-progress view

**Files:**
- Create: `apps/desktop/src/renderer/conversation-detail-rail.tsx`
- Create: `apps/desktop/tests/conversation-detail-rail.test.tsx`

- [x] **Step 1: Write a failing progress render test**

Render `ConversationTaskProgress` with a Run summary, six steps, and two participants. Assert:

```ts
expect(screen.getByText('Run ID')).toBeTruthy();
expect(screen.getByText('3 / 6')).toBeTruthy();
expect(screen.getByText('执行步骤')).toBeTruthy();
expect(screen.getByText('Architect')).toBeTruthy();
expect(screen.queryByText('审批')).toBeNull();
```

- [x] **Step 2: Run the component test and confirm RED**

Expected: FAIL because `ConversationTaskProgress` does not exist.

- [x] **Step 3: Implement Run summary, steps, and participants**

Use a stable four-row definition list, numbered flat steps, status icons, and compact Agent rows.
Render `尚未开始`, `0 / 0`, and `--` for absent Run data. Do not render archive, child-task, or
approval controls in the progress body.

- [x] **Step 4: Run the component test and confirm GREEN**

Expected: progress view passes and contains no approval UI.

### Task 3: Build compact artifact directory and detail dialog

**Files:**
- Modify: `apps/desktop/src/renderer/conversation-detail-rail.tsx`
- Modify: `apps/desktop/tests/conversation-detail-rail.test.tsx`

- [x] **Step 1: Write failing artifact interaction tests**

Assert each row exposes artifact name, latest version, MIME-derived icon label, timestamp, and an
open callback. Assert the dialog has `role="dialog"`, closes on Escape, and renders the supplied
existing `ArtifactVersionsPanel` content.

- [x] **Step 2: Run the focused test and confirm RED**

Expected: FAIL because `TaskArtifactDirectory` and `TaskArtifactDialog` do not exist.

- [x] **Step 3: Implement directory and accessible dialog**

Keep the 260 px rail as a flat list. The dialog accepts the selected artifact detail as `children`
so `index.tsx` can reuse the existing compare/select/merge/conflict callbacks unchanged.

- [x] **Step 4: Run the focused test and confirm GREEN**

Expected: artifact list and dialog tests pass.

### Task 4: Build turn log list and Agent-stage modal

**Files:**
- Modify: `apps/desktop/src/renderer/conversation-detail-rail.tsx`
- Modify: `apps/desktop/tests/conversation-detail-rail.test.tsx`

- [x] **Step 1: Write failing turn/stage interaction tests**

Assert one rail row per `ConversationLogTurn`; opening a row shows the user request, totals, and
collapsed stages. Expanding `Architect` must reveal only Architect events, while `Reviewer` stays
collapsed. Assert Agent name, responsibility, model, status, duration, Escape close, and focus
restore.

- [x] **Step 2: Run the focused test and confirm RED**

Expected: FAIL because `ConversationLogList` and `ConversationLogDialog` do not exist.

- [x] **Step 3: Implement list, modal, and collapsible stages**

Render newest turns first in the rail. Keep modal stage order chronological. Use a dedicated
`SYNC-THINK Runtime` stage for unattributed events, wrap log text, truncate only identifiers, and
never display arbitrary raw payload values.

- [x] **Step 4: Run the focused test and confirm GREEN**

Expected: all turn/modal/stage tests pass.

### Task 5: Adapt the real Desktop task rail

**Files:**
- Modify: `apps/desktop/src/renderer/index.tsx`
- Modify: `apps/desktop/src/renderer/talk-workspace.tsx`
- Modify: `apps/desktop/tests/beginner-desktop-shell.test.ts`
- Modify: `apps/desktop/tests/talk-workspace.test.tsx`

- [x] **Step 1: Add failing integration contracts**

Assert the three Talk tabs still map to progress/artifacts/execution, but the right rail no longer
renders nested Trace/Graph/Approval tabs or `ApprovalCenterPanel`. Assert it renders
`ConversationTaskProgress`, `TaskArtifactDirectory`, and `ConversationLogList`, and mounts both
dialogs from real selected state.

- [x] **Step 2: Run focused Desktop tests and confirm RED**

Run:

```powershell
pnpm.cmd --filter @sync-think/desktop test -- conversation-detail-rail.test.tsx talk-workspace.test.tsx beginner-desktop-shell.test.ts
```

Expected: integration assertions fail against the old mixed rail.

- [x] **Step 3: Wire real Run, event, Agent, and artifact data**

Create `conversationLogs` with `projectConversationLogs`. Project the latest Run/graph into progress
props. Map `artifactItems` into compact rows. Keep existing artifact operations inside the artifact
dialog. Map old `graph`/`approvals` navigation requests to progress or execution, retain header
pause/terminate, and remove only the obsolete nested rail presentation.

- [x] **Step 4: Run focused Desktop tests and confirm GREEN**

Expected: all focused tests pass.

### Task 6: Match Figma density and responsive behavior

**Files:**
- Modify: `apps/desktop/src/renderer/renderer.css`
- Modify: `apps/desktop/tests/beginner-desktop-shell.test.ts`

- [x] **Step 1: Add failing CSS contracts**

Assert the progress summary, flat step rows, artifact rows, turn rows, modal sizing, stage accordion,
dark theme, focus-visible, and reduced-motion selectors exist. Assert the old nested right-rail tab
presentation is not used by the task rail.

- [x] **Step 2: Run the shell contract and confirm RED**

Expected: FAIL on missing dedicated selectors.

- [x] **Step 3: Add dedicated styles**

Use existing theme tokens, teal/green/red/neutral status accents, one bordered Run summary, flat
lists, `min(880px, 92vw)` modal width, `86vh` max height, and responsive width reduction below
1000 px. Preserve the 260/36 px detail rail geometry.

- [x] **Step 4: Run focused tests and confirm GREEN**

Expected: all renderer and CSS contracts pass.

### Task 7: Verify and document

**Files:**
- Modify: `docs/development/03-feature-changelog.md`
- Modify: `docs/development/10-current-status.md`
- Modify: `docs/development/12-test-log.md`
- Modify: `docs/handoff/05-handoff-guide.md`
- Modify: `docs/superpowers/plans/2026-07-18-conversation-detail-rail.md`

- [x] Run Desktop focused and full tests; confirm zero failures.
- [x] Run UI Kit full tests; confirm existing artifact/version behavior did not regress.
- [x] Run repository test, typecheck, and build serially with zero failures.
- [x] Run `git diff --check`.
- [x] Rebuild Desktop main/preload/renderer for user inspection.
- [x] Record that visual inspection belongs to the user unless they explicitly request agent-side QA.
