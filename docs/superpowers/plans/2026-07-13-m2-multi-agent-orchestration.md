# M2 Multi-Agent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete M2 vertical slice: persisted participation modes, editable immutable plan revisions, durable DAG execution, scoped approvals and allowlists, bounded reviewer rework, immutable artifact versions, full Desktop observability, and the specified exit demo.

**Architecture:** SQLite remains the source of truth. `packages/core` owns pure policy, DAG, diff, and state-transition logic; `packages/storage` owns immutable entities and transactions; `packages/protocol` owns typed commands; `apps/runtime` owns orchestration and event emission; `packages/ui-kit` owns reusable views; `apps/desktop` owns the Electron bridge and product composition. Existing single-Agent conversation behavior stays unchanged when a Task remains in `conversation` mode.

**Tech Stack:** TypeScript, Vitest, better-sqlite3 + Drizzle, named-pipe Runtime protocol, React 18, Electron 33, existing SYNC-THINK UI Kit.

**Repository rule:** This workspace intentionally has no Git repository. Do not initialize Git and do not add commit steps.

---

## Invariants

1. A historical Run references exact PlanRevision and AgentVersion IDs. Missing exact IDs are errors, never a fallback to latest.
2. Editing a plan or Agent creates a new immutable version.
3. DAG Step IDs stay stable across retry and restart.
4. Concurrent writers never overwrite an ArtifactVersion. Merge is an explicit Step; conflicts pause the Run.
5. The most restrictive scoped policy wins. Human-only actions always require a real human.
6. Automatic mode skips only approvals allowed by resolved server-side policy.
7. Reviewer rejection creates review evidence and a new artifact version. Rework stops at the configured limit.
8. Every state change emits an append-only event and can be reconstructed after Runtime restart.

## Task 1: Strict AgentVersion History and Exact Pinning

**Files:**
- Modify: `packages/storage/src/agent-store.ts`
- Modify: `packages/storage/src/agent-store.test.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/tests/agent-commands.test.ts`
- Modify: `packages/protocol/src/commands.ts`

- [x] **Step 1: Write RED tests for exact version lookup and immutable history**

```ts
it('does not substitute latest when an exact AgentVersion id is missing', async () => {
  await expect(store.getRequiredAgentVersion('missing-version' as AgentVersionId))
    .rejects.toThrow('AgentVersion not found');
});

it('pins the approved step to the exact AgentVersion id', async () => {
  const v1 = await store.getAgent();
  const v2 = await store.updateDefinition({ agentId: v1.agentId, name: 'Planner v2' });
  expect(v2.id).not.toBe(v1.id);
  expect((await store.getRequiredAgentVersion(v1.id)).name).toBe(v1.name);
});
```

- [x] **Step 2: Run RED**

Run: `pnpm --filter @sync-think/storage test -- agent-store.test.ts`

Expected: FAIL because `getRequiredAgentVersion`, complete definition updates, and version listing do not exist.

- [x] **Step 3: Implement strict APIs**

```ts
getRequiredAgentVersion(id: AgentVersionId): Promise<AgentVersion>;
listAgentVersions(agentId: AgentId): Promise<AgentVersion[]>;
createAgent(input: CreateAgentInput): Promise<AgentVersion>;
updateDefinition(input: UpdateAgentDefinitionInput): Promise<AgentVersion>;
```

`getRequiredAgentVersion` must query by exact ID and throw when absent. `updateDefinition` must insert a new row with `version = max + 1` and never update an existing row.

- [x] **Step 4: Replace Runtime's missing-version fallback**

All Run/Step paths receiving an `agentVersionId` call the exact resolver. Only requests that omit the ID may use the current Agent version.

- [x] **Step 5: Run GREEN and package regression**

Run: `pnpm --filter @sync-think/storage test`

Run: `pnpm --filter @sync-think/runtime test -- agent-commands.test.ts`

Expected: all tests pass and v1 remains readable after v2 is created.

## Task 2: Persisted Participation Mode and Scoped Policy Resolution

**Files:**
- Create: `packages/core/src/participation-policy.ts`
- Create: `packages/core/src/participation-policy.test.ts`
- Create: `packages/core/src/scoped-policy.ts`
- Create: `packages/core/src/scoped-policy.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/storage/src/schema/task.ts`
- Modify: `packages/storage/src/workspace-store.ts`
- Modify: `packages/storage/src/workspace-store.test.ts`
- Create: `packages/storage/src/schema/policy.ts`
- Modify: `packages/storage/src/schema/index.ts`
- Create: `packages/storage/src/policy-store.ts`
- Create: `packages/storage/src/policy-store.test.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/src/scripts/migrate.ts`
- Modify: `packages/storage/src/migrate.test.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `apps/runtime/src/command-validation.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Create: `apps/runtime/tests/mode-policy-commands.test.ts`

- [x] **Step 1: Write RED pure policy tests**

```ts
expect(canTransitionMode('conversation', 'collaboration')).toBe(true);
expect(canTransitionMode('collaboration', 'automatic', { approvedPlan: false })).toBe(false);
expect(canTransitionMode('automatic', 'conversation')).toBe(true);

expect(resolveScopedPolicy([
  { scope: 'workspace', approvalMode: 'full' },
  { scope: 'agent', approvalMode: 'request' },
])).toMatchObject({ approvalMode: 'request' });

expect(resolveActionDecision({ action: 'payment-or-purchase', approvalMode: 'full' }))
  .toMatchObject({ decision: 'human-required' });
```

- [x] **Step 2: Run RED**

Run: `pnpm --filter @sync-think/core test -- participation-policy.test.ts scoped-policy.test.ts`

Expected: FAIL because the policy modules do not exist.

- [x] **Step 3: Implement pure transition and restrictive merge rules**

Use the restriction order `request > delegate > custom > full` for approval requirement, then apply matching per-action rules. Human-only membership overrides every rule.

- [x] **Step 4: Persist Task mode and versioned Policy rows**

Add `participation_mode TEXT NOT NULL DEFAULT 'conversation'` to Task migration. Policy rows contain `scope_type`, `scope_id`, `approval_mode`, `rules_json`, `version`, and timestamps. Updates insert a new version.

- [x] **Step 5: Add typed commands and Runtime handlers**

```ts
type CommandType =
  | 'task.setParticipationMode'
  | 'policy.list'
  | 'policy.save';

interface SetParticipationModePayload {
  taskId: TaskId;
  mode: ParticipationMode;
  expectedTaskVersion: number;
}
```

The Runtime validates the transition, uses optimistic Task versioning, persists it, and emits `task.participation-mode.changed`.

- [x] **Step 6: Run GREEN**

Run: `pnpm --filter @sync-think/core test`

Run: `pnpm --filter @sync-think/storage test -- workspace-store.test.ts policy-store.test.ts`

Run: `pnpm --filter @sync-think/runtime test -- mode-policy-commands.test.ts`

Expected: mode survives a new store instance; automatic mode is rejected without an approved plan; all human-only actions resolve to human approval.

## Task 3: Immutable Plan Revisions and Approval Transaction

**Files:**
- Create: `packages/shared/src/types/plan.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/core/src/plan-revision.ts`
- Create: `packages/core/src/plan-revision.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/storage/src/schema/orchestration.ts`
- Modify: `packages/storage/src/schema/index.ts`
- Create: `packages/storage/src/orchestration-store.ts`
- Create: `packages/storage/src/orchestration-store.test.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/src/scripts/migrate.ts`
- Modify: `packages/storage/src/migrate.test.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/version.ts`
- Modify: `apps/runtime/src/command-validation.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Create: `apps/runtime/tests/plan-commands.test.ts`

- [x] **Step 1: Define the desired Plan API in RED tests**

```ts
const draft = await store.createPlanDraft({ taskId, title: 'Ship M2', steps });
const edited = await store.revisePlan({ planId: draft.planId, expectedRevision: 1, steps: editedSteps });
expect(edited.revision).toBe(2);
expect(await store.getPlanRevision(draft.planId, 1)).toEqual(draft);

const approved = await store.approvePlan({ planId: draft.planId, revision: 2 });
expect(approved.run.planRevisionId).toBe(edited.id);
expect(approved.steps.map((step) => step.agentVersionId)).toEqual(pinnedVersionIds);
const nextDraft = await store.revisePlan({ planId: draft.planId, expectedRevision: 2, steps });
expect(nextDraft.revision).toBe(3);
expect((await store.getRun(approved.run.id)).planRevisionId).toBe(edited.id);
```

- [x] **Step 2: Run RED**

Run: `pnpm --filter @sync-think/storage test -- orchestration-store.test.ts`

Expected: FAIL because plan/run/step tables and store do not exist.

- [x] **Step 3: Implement normalized immutable entities**

```ts
interface PlanRevision {
  id: PlanRevisionId;
  planId: PlanId;
  revision: number;
  title: string;
  steps: PlanStepDraft[];
  diffFromPrevious: PlanDiff;
  state: 'draft' | 'approved' | 'superseded';
}
```

Tables: `plan`, `plan_revision`, `run`, `step`, and `step_dependency`. Approval is one SQLite transaction that marks the selected revision approved and inserts Run, Step, dependency, exact AgentVersion, and model override snapshots. Later edits create a new draft revision; they never mutate the approved revision or repin its historical Run.

- [x] **Step 4: Implement protocol commands**

```ts
'plan.createDraft' | 'plan.revise' | 'plan.listRevisions' | 'plan.approve' | 'run.getGraph'
```

Every mutation includes the expected revision/version. Runtime emits `plan.drafted`, `plan.revised`, `plan.approved`, `run.queued`, and one `step.created` event per Step.

- [x] **Step 5: Run GREEN and migration regression**

Run: `pnpm --filter @sync-think/storage test`

Run: `pnpm --filter @sync-think/runtime test -- plan-commands.test.ts`

Expected: old revision remains unchanged, stale edit is rejected, and approved Run pins exact PlanRevision and AgentVersion IDs.

## Task 4: Immutable Artifact Versions, Comparison, and Merge Conflicts

**Files:**
- Create: `packages/shared/src/types/artifact.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/core/src/artifact-merge.ts`
- Create: `packages/core/src/artifact-merge.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/storage/src/artifact-store.ts`
- Create: `packages/storage/src/artifact-store.test.ts`
- Modify: `packages/storage/src/schema/orchestration.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/protocol/src/commands.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Create: `apps/runtime/tests/artifact-commands.test.ts`

- [x] **Step 1: Write RED immutable-version tests**

```ts
const v1 = await store.createVersion({ artifactId, sourceStepId, content: 'base' });
const v2 = await store.createVersion({ artifactId, sourceStepId, parentVersionIds: [v1.id], content: 'left' });
expect(v2.version).toBe(2);
expect((await store.getVersion(v1.id)).content).toBe('base');

expect(mergeTextSnapshots({ base: 'x', left: 'left', right: 'right' }))
  .toMatchObject({ status: 'conflict' });
```

- [x] **Step 2: Run RED**

Run: `pnpm --filter @sync-think/core test -- artifact-merge.test.ts`

Run: `pnpm --filter @sync-think/storage test -- artifact-store.test.ts`

Expected: FAIL because artifact version APIs do not exist.

- [x] **Step 3: Implement Artifact and ArtifactVersion tables**

Store immutable content or local content reference, hash, MIME type, source Step, status, version number, parent version IDs, metadata, and createdAt. No update method may mutate content.

- [x] **Step 4: Implement compare/select/merge commands**

```ts
'artifact.list' | 'artifact.getVersion' | 'artifact.compare' |
'artifact.selectVersion' | 'artifact.merge'
```

A clean merge creates a new version. A conflict creates a conflict record and emits `artifact.merge-conflicted`; the owning Run becomes paused.

- [x] **Step 5: Run GREEN**

Run: `pnpm --filter @sync-think/core test`

Run: `pnpm --filter @sync-think/storage test -- artifact-store.test.ts`

Run: `pnpm --filter @sync-think/runtime test -- artifact-commands.test.ts`

Expected: prior versions remain unchanged, compare returns a stable diff, and conflicts pause instead of last-write-wins.

## Task 5: Durable DAG Scheduler, Parallel Snapshots, Pause/Resume/Cancel/Recovery

**Files:**
- Create: `packages/core/src/dag.ts`
- Create: `packages/core/src/dag.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/runtime/src/orchestration/scheduler.ts`
- Create: `apps/runtime/src/orchestration/scheduler.test.ts`
- Create: `apps/runtime/src/orchestration/step-executor.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/src/persistence.ts`
- Modify: `packages/protocol/src/commands.ts`
- Create: `apps/runtime/tests/orchestration-recovery.test.ts`

- [x] **Step 1: Write RED DAG tests**

```ts
expect(validateDag([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }])).toEqual({ ok: true });
expect(validateDag([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }])).toMatchObject({ ok: false, reason: 'cycle' });
expect(getReadyStepIds(graph, { a: 'completed', b: 'pending', c: 'pending' })).toEqual(['b', 'c']);
```

- [x] **Step 2: Run RED**

Run: `pnpm --filter @sync-think/core test -- dag.test.ts`

Expected: FAIL because DAG validation and ready-set functions do not exist.

- [x] **Step 3: Implement pure DAG validation and stable ready ordering**

Reject missing dependencies, duplicate IDs, self-edges, and cycles. Ready Steps are sorted by persisted plan order, not random IDs.

- [x] **Step 4: Write scheduler RED tests**

```ts
it('runs independent ready steps in parallel against isolated artifact snapshots', async () => {
  const result = await scheduler.tick(runId);
  expect(result.startedStepIds).toEqual(['design', 'image']);
  expect(executor.snapshotsFor('design')).not.toBe(executor.snapshotsFor('image'));
});

it('restores paused and running steps without changing stable ids', async () => {
  const before = await store.getGraph(runId);
  const restored = await createSchedulerWithSameDatabase().recover(runId);
  expect(restored.steps.map((s) => s.id)).toEqual(before.steps.map((s) => s.id));
});
```

- [x] **Step 5: Run scheduler RED**

Run: `pnpm --filter @sync-think/runtime test -- scheduler.test.ts orchestration-recovery.test.ts`

Expected: FAIL because scheduler and orchestration recovery do not exist.

- [x] **Step 6: Implement durable state transitions**

`tick` loads the persisted graph, starts all ready Steps with isolated snapshots, emits `step.started`, persists completion/failure atomically with events, and then computes the next ready set. `pause` stops scheduling new Steps; `resume` requeues resumable Steps; `cancel` aborts active executors and marks unfinished Steps cancelled.

- [x] **Step 7: Add commands and recovery**

Implement `run.pause`, `run.resume`, `run.cancel`, and `run.getGraph` for orchestration Runs without changing existing conversation cancellation. On Runtime startup, recover queued/running/reviewing/revising/paused Runs from SQLite.

- [x] **Step 8: Run GREEN**

Run: `pnpm --filter @sync-think/runtime test -- scheduler.test.ts orchestration-recovery.test.ts`

Expected: parallel Steps start together, dependency Steps wait, IDs survive restart, pause/resume works, and cancel has one terminal event.

## Task 6: Scheduler Approval Gates and Multi-Scope Skill/MCP Authorization

**Files:**
- Create: `packages/core/src/capability-authorization.ts`
- Create: `packages/core/src/capability-authorization.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/storage/src/authorization-store.ts`
- Create: `packages/storage/src/authorization-store.test.ts`
- Modify: `packages/storage/src/schema/policy.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `apps/runtime/src/runtime.ts`
- Modify: `apps/runtime/src/orchestration/scheduler.ts`
- Modify: `apps/runtime/src/command-validation.ts`
- Modify: `apps/runtime/tests/approval-commands.test.ts`
- Modify: `apps/runtime/tests/mcp-commands.test.ts`

- [x] **Step 1: Write RED authorization tests**

```ts
expect(resolveCapabilityAccess({
  agentVersionId, serverId, toolName: 'read_file',
  grants: [{ scope: 'project', serverId, tools: ['read_file'] }],
})).toEqual({ allowed: true });

expect(resolveCapabilityAccess({
  agentVersionId: otherAgentVersionId, serverId, toolName: 'read_file', grants,
})).toEqual({ allowed: false, reason: 'agent-not-authorized' });
```

- [x] **Step 2: Run RED**

Run: `pnpm --filter @sync-think/core test -- capability-authorization.test.ts`

Expected: FAIL because per-tool scoped authorization does not exist.

- [x] **Step 3: Implement versioned authorization grants**

Grant keys include scope (`user|workspace|project|task|run`), scope ID, exact AgentVersion ID, SkillVersion or MCP server, optional tool names, and version. Revocation creates a new version and immediately affects new calls.

- [x] **Step 4: Move trust decisions server-side**

Ignore client-provided `insideExplicitPolicy` and `delegateAvailable` as authority. Runtime derives them from persisted policy, actor identity, Step, and action digest. Every tool call carries exact `runId`, `stepId`, and `agentVersionId`.

- [x] **Step 5: Connect approval states to scheduler**

Protected Step actions transition to `awaitingApproval`; approval resumes the same stable Step. Delegate decisions are allowed only for non-human-only actions and are evented with the delegate AgentVersion ID.

- [x] **Step 6: Run GREEN**

Run: `pnpm --filter @sync-think/core test`

Run: `pnpm --filter @sync-think/storage test -- authorization-store.test.ts approval-store.test.ts`

Run: `pnpm --filter @sync-think/runtime test -- approval-commands.test.ts mcp-commands.test.ts`

Expected: unauthorized Agent/tool pairs are rejected, human-only cannot be delegated/full-approved, and approved Steps resume exactly once.

## Task 7: Reviewer Agent, Evidence, and Bounded Rework

**Files:**
- Create: `packages/shared/src/types/review.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/core/src/rework-policy.ts`
- Create: `packages/core/src/rework-policy.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/storage/src/schema/orchestration.ts`
- Modify: `packages/storage/src/orchestration-store.ts`
- Modify: `apps/runtime/src/orchestration/scheduler.ts`
- Create: `apps/runtime/tests/reviewer-rework.test.ts`

- [x] **Step 1: Write RED rework policy tests**

```ts
expect(nextReviewAction({ verdict: 'reject', iteration: 0, maxIterations: 1, onLimitReached: 'pause' }))
  .toEqual({ action: 'rework', nextIteration: 1 });
expect(nextReviewAction({ verdict: 'reject', iteration: 1, maxIterations: 1, onLimitReached: 'pause' }))
  .toEqual({ action: 'pause', reason: 'rework-limit-reached' });
```

- [x] **Step 2: Run RED**

Run: `pnpm --filter @sync-think/core test -- rework-policy.test.ts`

Expected: FAIL because rework policy does not exist.

- [x] **Step 3: Persist AcceptanceGate and ReviewEvidence**

Evidence records acceptance criterion IDs, verdict, explanation, reviewer AgentVersion, reviewed ArtifactVersion IDs, iteration, and timestamp.

- [x] **Step 4: Integrate reviewing and revising states**

On reject below the limit, create a new rework Step with review evidence in its Context Packet and require a new ArtifactVersion. On reject at the limit, emit `review.limit-reached` and pause/reassign/abort according to the gate. A completion gate can complete only after an accept verdict.

- [x] **Step 5: Run GREEN**

Run: `pnpm --filter @sync-think/runtime test -- reviewer-rework.test.ts`

Expected: first rejection causes exactly one rework, second rejection at max=1 pauses, prior artifact versions remain, and full evidence is in the event log.

## Task 8: Desktop Plan, Execution Graph, Approval, Artifact, and Agent Views

**Files:**
- Create: `packages/ui-kit/src/components/PlanRevisionPanel.tsx`
- Create: `packages/ui-kit/tests/PlanRevisionPanel.test.tsx`
- Create: `packages/ui-kit/src/components/ExecutionGraphPanel.tsx`
- Create: `packages/ui-kit/tests/ExecutionGraphPanel.test.tsx`
- Create: `packages/ui-kit/src/components/ArtifactVersionsPanel.tsx`
- Create: `packages/ui-kit/tests/ArtifactVersionsPanel.test.tsx`
- Modify: `packages/ui-kit/src/components/ApprovalCenterPanel.tsx`
- Modify: `packages/ui-kit/src/components/AgentWorkspace.tsx`
- Modify: `packages/ui-kit/src/index.ts`
- Modify: `packages/ui-kit/src/styles/components.css`
- Create: `apps/desktop/src/orchestration-payloads.ts`
- Create: `apps/desktop/tests/orchestration-payloads.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/global.d.ts`
- Modify: `apps/desktop/src/renderer/m0-projection.ts`
- Modify: `apps/desktop/src/renderer/index.tsx`
- Create: `apps/desktop/tests/m2-workspace.test.ts`

- [x] **Step 1: Write RED component tests**

```tsx
render(<PlanRevisionPanel revision={draft} revisions={[v1, draft]} onRevise={revise} onApprove={approve} />);
fireEvent.change(screen.getByLabelText('计划标题'), { target: { value: 'M2 revised' } });
fireEvent.click(screen.getByRole('button', { name: '保存新版本' }));
expect(revise).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }));

render(<ExecutionGraphPanel graph={parallelGraph} onPause={pause} onResume={resume} onCancel={cancel} />);
expect(screen.getByTestId('step-design').getAttribute('data-state')).toBe('running');
expect(screen.getByTestId('step-image').getAttribute('data-state')).toBe('running');

render(<ArtifactVersionsPanel artifact={artifact} comparison={comparison} />);
expect(screen.getAllByTestId(/artifact-version-/)).toHaveLength(2);
```

- [x] **Step 2: Run RED**

Run: `pnpm --filter @sync-think/ui-kit test -- PlanRevisionPanel.test.tsx ExecutionGraphPanel.test.tsx ArtifactVersionsPanel.test.tsx`

Expected: FAIL because M2 components do not exist.

- [x] **Step 3: Implement compact work-focused views**

Plan editing stays in the conversation flow. The right rail uses tabs for Trace, execution graph, approvals, and artifacts. Graph nodes show Agent, state, dependencies, model, retries, review iteration, and current artifact version without decorative cards inside cards.

- [x] **Step 4: Productize Approval Center and Agent editor**

Remove demo enqueue/probe controls from product mode. Add scoped policy editor, decision note, actor, Run/Step deep link, and immutable decision history. Agent workspace lists all Agents, complete definition fields, exact version history/diff, and create-new-version save behavior.

- [x] **Step 5: Add bridge payload validation and IPC**

Expose only typed orchestration methods: mode set, plan create/revise/list/approve, graph read, run pause/resume/cancel, policy save/list, artifact list/compare/select/merge, Agent list/create/versions. No secret value enters Renderer payloads.

- [x] **Step 6: Enable real ModeSwitch**

Bind the switch to the opened Task mode, remove `collaborationDisabled` / `automaticDisabled`, and pass the mode to Compose. Automatic selection is rejected with actionable UI if no approved plan/policy exists.

- [x] **Step 7: Correct trace semantics**

Only `review.*` events map to review. Ordinary `run.completed` remains a Run event. Add graph, artifact, approval, review, and recovery event summaries with stable selection.

- [x] **Step 8: Run GREEN**

Run: `pnpm --filter @sync-think/ui-kit test`

Run: `pnpm --filter @sync-think/desktop test -- orchestration-payloads.test.ts m2-workspace.test.ts`

Expected: modes switch, plan revisions edit/approve, graph controls operate, review/artifact state renders, and keyboard/focus tests pass.

## Task 9: M2 Exit Demo, Recovery, Security, and Visual QA

**Files:**
- Create: `apps/runtime/tests/m2-exit-demo.test.ts`
- Create: `scripts/selftest-m2.mjs`
- Modify: `package.json`
- Modify: `docs/development/12-test-log.md`
- Modify: `docs/development/10-current-status.md`
- Modify: `docs/development/03-feature-changelog.md`
- Modify: `docs/development/11-implementation-plan.md`

- [x] **Step 1: Write the RED exit-demo integration test**

The fixture must execute this exact sequence:

```text
collaboration mode
-> plan draft v1
-> edit to v2
-> approve v2 with exact AgentVersion pins
-> design and image-stub Steps start in parallel isolated snapshots
-> reviewer rejects candidate v1
-> executor creates artifact v2 in one rework
-> reviewer rejects again at maxIterations=1
-> Run pauses with review.limit-reached
-> artifact v1 and v2 remain comparable
-> restart Runtime
-> graph, pause state, evidence, revisions, pins and audit trace restore exactly once
```

- [x] **Step 2: Run RED**

Run: `pnpm --filter @sync-think/runtime test -- m2-exit-demo.test.ts`

Expected: FAIL until Tasks 1-8 are connected end to end.

- [x] **Step 3: Add the deterministic selftest script**

`pnpm selftest:m2` runs focused core/storage/runtime/ui-kit/desktop tests and asserts the exit event sequence, immutable version counts, no duplicate terminal events, and no secret-like text in exportable evidence.

- [x] **Step 4: Run package and root verification**

Run: `pnpm test`

Run: `pnpm typecheck`

Run: `pnpm build`

Run: `pnpm selftest:m1-soft:quick`

Run: `pnpm selftest:m2`

Expected: all commands exit 0 with no new warnings or unhandled errors.

- [x] **Step 5: Run Electron visual and interaction QA**

Verify at approximately 1426x893 and 1266x761, light and dark themes:

```text
no overlap or clipped labels
plan editor and revision history usable
parallel graph nodes stable in size
pause/resume/cancel controls keyboard reachable
approval and artifact drawers scroll independently
review-limit pause clearly visible
trace collapse does not pause execution
Runtime restart restores the same graph
```

- [x] **Step 6: Update evidence documents without overstating M1**

Mark M2 complete only after the exit demo and Electron QA pass. The user changed the M1 dogfood closure gate to one real-use date on 2026-07-15; the existing 2026-07-12 record satisfies it at 1/1. Automated runs and scaffolds still do not count as real dogfood.

---

## Self-Review

- Spec coverage: participation modes, Plan revisions, DAG/parallel/recovery, reviewer/rework, Skill/MCP authorization, approval modes/human-only, artifacts/merge conflicts, AgentVersion history/pinning, Desktop graph/approval/artifact UI, and exit demo all map to Tasks 1-9.
- No placeholder implementation steps remain. Every behavior has an explicit RED assertion, minimal target contract, and GREEN command.
- Type consistency: PlanRevision and AgentVersion pins are created in Task 3, ArtifactVersion in Task 4, scheduler in Task 5, authorization in Task 6, review evidence in Task 7, and consumed by Desktop in Task 8.
