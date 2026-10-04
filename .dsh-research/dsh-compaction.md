# DSH Context Compaction / Compression — Implementation Report

**Topic:** how DeepSeek Harness (DSH) implements **context compaction / compression** (not provider prompt caching).

**Snapshot under study (read-only), version `0.2.0-rc.2`:**

`C:\Users\zhuzhenyu\.codex\visualizations\2026\09\29\01a0eba8-16ae-7d11-9995-6e7f3aeaceb1\deepseek-research\deepseek-harness`

All `path:line` citations below are **relative to that snapshot root**. Where the snapshot lacks a file the docs cite (it contains `docs/` and `.agents/notes/` in full, but only `packages/subagent/*` and `packages/experimental/*` source trees — no `packages/compaction/**`, no `.agents/notes/implemented/architecture/**`, no `docs/reference/**`), that is stated explicitly and the claim is marked *inferable only* or listed under "unknowns".

Provenance caveat: the shell is broken in this environment (every spawn fails with `0xC0000142`) and `web_fetch` is blocked, so **nothing was executed and no page was fetched**. Every statement is derived from files read in the snapshot.

---

## (a) Summary

DSH compaction is a **surface-replacement** design layered on an append-only, event-sourced session log. The model-visible history is not the log; it is a derived *surface* — an ordered projection of message-producing events, each of which declares via `surfaceOp` how it joined that projection (`'append'`, or `{ op: 'replace', startSeq, endSeq }`). Compaction therefore never rewrites history: it appends a **single `user/message`** whose `content` is the (backend-framed) summary and whose `surfaceOp: { op: 'replace', startSeq, endSeq }` shadows an inclusive range of existing surface nodes, while the summary's raw content, its inputs, its shadowed seq set, its estimated token count, and the summarize model call's envelope are recorded on three **log-only** events `compaction/start` / `compaction/summary` / `compaction/end` that deliberately cannot join the surface (`SurfaceEventType` is a closed set of message-producing types and is *not* extended). The `compaction/start … compaction/end` pair is the single durable lock, appended *around* the whole operation (summarize first would leave the expensive interval invisible), which converts a crash mid-summarization into a detectable orphaned lock and lets `session/end-seed` distinguish a live lock from stale prior-lifecycle evidence. The concrete policy lives in the `dsh-compaction-basic` backend: pressure is checked at `agent/pre-step` against a threshold derived from route capacity (`thresholdRatio` 0.8, `headroomTokens` 65536), a turn-agnostic retention walk keeps a recent tail as a fraction of capacity (`retainRatio` 0.16) or an absolute `retainTokens` budget, and tool-call/result pairing balance — not turn boundaries — is the only structural guard on the cut. Before range selection it invokes the optional model-free `ctx.toolResultPruner`, which deterministically rewrites over-budget current `tool/result` nodes with head/middle/tail code-point slicing, each replacement preceded by a `compaction/prune` shadow-price event, and which can advance the surface generation **without any summary at all**. Provider-confirmed overflow takes a separate `agent/request-error` path with its own cap (`maxOverflowRetries` 1) and bypasses threshold/retention policy for one maximal balanced head reduction. Manual (`compactNow`, the `/compact` command) and explicit-region (`compactRegion(start, end, …)`) entry points share the same durable transaction but differ in lock owner (`turn: number | null`), stability rule (whole surface vs. selected span), and flush obligation. Summarization is one routed call through `ctx.llm.stream()` with `GenerateOptions.purpose = 'compaction'` (DeepSeek adapter → header `x-deepseek-harness-compact: 1`); token accounting is delegated wholesale to the singleton `ctx.tokenMeter`, which owns the per-session replay fold and positional per-node pricing.

---

## (b) Mechanism-by-mechanism

### 1. The surface-replacement model: session log vs. model-visible surface

**The log is not the context; the surface is.** `docs/architecture.md:123`:

> "The session log is the source of the context the model sees. `deriveMessages()` projects model history from it."

`docs/subsystems/session.md:637-643` (JSDoc on `deriveMessages`):

> "Derive the LLM message history by walking the ordered sequences of message-producing events maintained by `surfaceOp` markers. The surface is the single source of derived history: every message-producing append records its `surfaceOp`, so a raw event with no marker (a chunk, a turn boundary) is correctly absent, and a compaction `replace` deletes the shadowed nodes from the derivation."

**`SurfaceEventType` is a closed set**, so no compaction-specific event can carry surface metadata. `docs/subsystems/session.md:300-315`:

```ts
type SurfaceEventType =
  | 'system/message'
  | 'developer/message'
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'
```

`docs/subsystems/session.md:294`:

> "Every surface event requires `surfaceOp`; known log-only events forbid both surface metadata fields."

The rationale is stated in `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:13`:

> "Second, `SurfaceEventType` is closed to the message-producing event types (`user/message`, `assistant/message`, `tool/result`); only those may carry `surfaceOp`. A bespoke `compaction/*` event therefore **cannot** itself appear on the surface — the compiler and Session's always-on append/seed boundary reject `surfaceOp` on it."

**`surfaceOp: { op: 'replace', startSeq, endSeq }`.** `docs/subsystems/session.md:320-336` (the drift-checked `type-equiv`):

```ts
/**
 * - `'append'`: added to the tail — normal path for user/assistant/tool
 *   messages.
 * - `{ op: 'replace', startSeq, endSeq }`: replaces surface nodes from `startSeq`
 *   (inclusive) through `endSeq` (inclusive) with this node. Both must exist as
 *   surface nodes in the current surface. `startSeq === endSeq` replaces a single
 *   node. The node's {@link SessionEvent.sourceEventSeqs} must include every
 *   shadowed surface node. Used by compaction; any surface-replacing producer
 *   may use it.
 */
type SurfaceOp =
  | 'append'
  | { op: 'replace'; startSeq: SessionSeq; endSeq: SessionSeq }
```

`docs/subsystems/session.md:338` supplies the non-numeric-order rule:

> "`replace` contains exactly `op`, `startSeq`, and `endSeq`, with no aliases or extra keys. It shadows the inclusive span between those current surface event sequences and inserts the new event in their place; equal endpoints replace one entry. Endpoints must precede the replacing event, but their relative order is surface order, not numeric sequence order."

The same wording appears in the generated persistence catalog, `docs/persistence-catalog.md:102-117`, which also marks the completeness obligation:

> "`'append'`: added to the tail — normal path for user/assistant/tool messages. … The node's {@link SessionEvent.sourceEventSeqs} must include every shadowed surface node. Used by compaction; any surface-replacing producer may use it."

**Why a `user/message` checkpoint instead of rewriting history.** Three doc-stated reasons compound:

1. *The compiler forbids anything else.* `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:74`:
   > "Because `SurfaceEventType` is closed, the summary cannot ride on a `compaction/*` event. The backend instead appends a **single `user/message`** with `source: COMPACT_CHECKPOINT_SOURCE` and `surfaceOp: { op: 'replace', startSeq, endSeq }` whose `content` is the (framed) summary and whose `sourceEventSeqs` covers the shadowed entries *and* the bookkeeping events."

2. *It is semantically honest.* Same note, `:86`:
   > "`deriveMessages()` then yields `[summary_as_user_message, ...retained_entries]`. Reusing `user/message` is honest rather than a workaround: a summary genuinely *is* user-role context."

3. *It keeps the log append-only and replayable.* `docs/subsystems/compaction.md:11`:
   > "`SurfaceEventType` is deliberately NOT extended (only message-producing events reach the model), so the summary itself rides on a separate `user/message` with `surfaceOp: { op: 'replace', startSeq, endSeq }` — the only surface mutation performed by summary compaction."

Append-only matters because the human-facing transcript reads the *other* projection: `docs/subsystems/session.md:358`:

> "A human-facing transcript is the other projection and reads the log's append-origin events instead, because the surface deliberately shadows the ranges a replacement summarizes (`isAppendSurfaceEvent` in [dsh-session](...))."

**Canonical checkpoint identity.** The replacement's `source` is created by `compactCheckpointSource(compactionId, sourceCommandId?)`; the durable shape is `CompactionCheckpointSource` (`docs/persistence-catalog.md:3095-3105`): `kind: "compact-checkpoint"` (required), `compactionId: string` (required), `sourceCommandId` (optional). `docs/subsystems/compaction.md:84`:

> "Every backend creates its replacement `user/message` source with `compactCheckpointSource(compactionId, sourceCommandId?)`; client and wire consumers import that constructor, `CompactionCheckpointSource`, and `isCompactCheckpointSource()` from the cordis-free `@deepseek-ai/dsh-compaction/checkpoint` subpath, while the package root re-exports them for host consumers. The required transaction identity correlates the replacement checkpoint, while the predicate keeps recognition independent of any one backend."

**`shadowedRange` / `shadowedSeqs` / `shadowedTokenCount`.** `docs/subsystems/compaction.md:46-72`:

```ts
interface CompactionResult {
  compactionId: CompactionId
  sourceCommandId?: CommandId
  startSeq: SessionSeq
  summarySeq: SessionSeq
  endSeq: SessionSeq
  summary: ContentBlock[]
  /**
   * The surface-boundary pair that was shadowed: the seqs of the first
   * (`start`) and last (`end`) surface nodes of the replaced range. A
   * surface-POSITION span, not a numeric seq interval — after a prior replace
   * lands a fresh high-seq summary node at an older range's position, `start`
   * can be GREATER than `end`. {@link CompactionResult.shadowedSeqs} is the
   * authoritative set of shadowed nodes, in surface order.
   */
  shadowedRange: { start: SessionSeq; end: SessionSeq }
  /** The seqs of all shadowed surface nodes, in surface order. */
  shadowedSeqs: SessionSeq[]
  /** Estimated token count of the shadowed content. */
  shadowedTokenCount: number
}
```

The three fields are *closed over* by a projection-replay type too: `docs/subsystems/session.md:421-431` defines `SurfaceFoldReplacement` with `seq`, declared `start`/`end`, and `shadowedSeqs` = "Actual surface entries removed by the operation, in surface order", and `docs/subsystems/session.md:418` explains why generation counters exist:

> "Its `replaceGeneration` increments for each committed replacement so incremental consumers can distinguish pure tail growth from a rewrite."

`SessionSurface` (`docs/subsystems/session.md:404-413`) exposes `nodes` (current surface seqs in model-visible order), `replaceGeneration` ("Monotonic count of committed positional replacements"), and `contentGeneration` ("Monotonic count of committed replacements and plugin-owned message changes").

**Head-anchoring and the positional-vs-numeric subtlety.** `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:64-66`:

> "Auto-compaction always starts at the surface head, merging the prior checkpoint with newly compacted history so only one automatic checkpoint remains. `shadowedRange` is therefore positional rather than a numeric sequence interval: a newer summary sequence may occupy an older surface position. `shadowedSeqs` records the authoritative surface order. Manual mid-range compaction may leave multiple checkpoints."

A second system-prompt nuance: node 0 is protected, later system nodes are not — `docs/subsystems/session.md:298`:

> "the surface fold rejects any other replacement covering a `system/message` at node 0, while a later system node is ordinary history that a compaction replacement may shadow."

The wire representation mirrors this. `docs/deepseek-llm-api-wire-extensions.md:133`:

> "Surface events require `surfaceOp`; replacement ranges use numeric `startSeq` and `endSeq`, and system, user, and tool events may also carry numeric `sourceEventSeqs`. … Known log-only events omit surface metadata; restored unknown ignorable records preserve opaque metadata without treating it as a surface operation."

**Consumers can query shadowed vs. current.** The `session_query` tool schema (`docs/tool-catalog.md:1853-1863`) exposes a `surfaces` filter whose enum is `["current", "shadowed", "log-only"]`.

---

### 2. The `compaction-basic` backend policy

#### 2.1 Config surface

Generated catalog section `docs/config-catalog.md:674-721` (header: source `packages/compaction/compaction-basic/src/types.ts:40`; `inject: llm · tokenMeter · sessions`):

```ts
/** Basic compaction configuration with an optional exact-target policy table. */
export interface BasicCompactionConfig extends CompactionPolicyConfig {
  /** Exact provider/model overrides; duplicate targets fail plugin load. */
  modelPolicies?: ModelCompactPolicyConfig[]
  /** Enable automatic step-boundary pressure and overflow-recovery listeners. Defaults to `true`. */
  auto?: boolean
}

/** Policy fields shared by the default policy and exact model overrides. */
export interface CompactionPolicyConfig {
  /** Window fraction for pressure; capped at context window minus reserved output and `headroomTokens`. Defaults to `0.8`. */
  thresholdRatio?: number
  /** Additional pressure headroom beyond the routed output reservation. Non-negative integer; defaults to `65536`. */
  headroomTokens?: number
  /** Recent context retained as a fraction of context window minus reserved output tokens. Defaults to `0.16`. */
  retainRatio?: number
  /** Absolute recent-context budget; mutually exclusive with `retainRatio`. */
  retainTokens?: number
  /** Summary provider; set together with `summarizationModel`, or inherit the conversation target. */
  summarizationProvider?: string
  /** Summary model; set together with `summarizationProvider`, or inherit the conversation target. */
  summarizationModel?: string
  /** Provider generation cap for summarization. Defaults to the resolved `headroomTokens`; an explicit cap must be positive. */
  maxTokens?: number
  /** Extra attempts after the first compaction when pressure remains above threshold. Defaults to `1`. */
  compactionRetries?: number
  /** Maximum retries after canonical context overflow; `0` disables recovery. Defaults to `1`. */
  maxOverflowRetries?: number
}

/** Exact provider/model override merged over the default compaction policy. */
export interface ModelCompactPolicyConfig extends CompactionPolicyConfig {
  /** Registered provider route to match. */
  provider: string
  /** Exact routed model id to match within `model`. */
  model: string
}
```

**Target policy table precedence** (from the seam note rather than the catalog). `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:70`:

> "`resolveConfig` supplies usable defaults: threshold ratio `0.8`, retained-tail ratio `0.16`, empty summarization provider/model overrides, `maxTokens: 8192`, `compactionRetries: 1`, `maxOverflowRetries: 1`, and `auto: true`. Optional exact provider/model policies partially override the top-level defaults; pressure scales ratios against capacity from the route-owning LLM adapter, while `retainTokens` can replace ratio retention. Retention must remain below the resulting threshold."

> ⚠️ **Observed inconsistency in this snapshot (not invented, flagged):** the note says the default `maxTokens` is `8192`, while the generated catalog JSDoc says "Defaults to the resolved `headroomTokens`" and `headroomTokens` itself "defaults to `65536`". Both statements are quoted here verbatim; the snapshot does not reconcile them, and `packages/compaction/compaction-basic/src/types.ts` (the cited source of truth, `:40`) is **not present**.

#### 2.2 Trigger points

**Pressure — `agent/pre-step`.** `docs/subsystems/compaction.md:101`:

> "Pressure compaction runs at the `agent/pre-step` waterfall before request derivation."

`.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:38-40`:

> "Successful-call pressure runs at the next `agent/pre-step`, after the preceding response, tool results, buffered context, and steering are durable and before the next request is derived. `dsh-compaction-basic` measures the canonical logged request through `ctx.tokenMeter`, so the next request sees any replacement without a speculative envelope override. Once pressure qualifies, optional `ctx.toolResultPruner` rewriting runs before summary selection; compaction-basic remeasures the durable surface and skips summarization if pruning restores safe pressure."

The listener registration is confirmed by `docs/event-producer-consumer.md:20` (`agent/pre-step` waterfall listeners include `compaction-basic`) and `docs/subsystems/core.md:337` ("`agent/pre-step` is the only waterfall listener chain before request derivation").

`compactIfNeeded`'s contract, `docs/subsystems/compaction.md:150-162`:

```ts
/**
 * Consider automatic compaction for one explicit trigger. Pressure policy
 * uses the latest durable routed request, while context-overflow policy may
 * force a useful balanced reduction even below the normal threshold. Return
 * `null` when no safe range can be compacted. A single oversized retained
 * unit or request envelope cannot be repaired through surface compaction.
 */
abstract compactIfNeeded( agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal, ): Promise<CompactionResult | null>
```

with `docs/subsystems/compaction.md:79-82`:

```ts
/** Why automatic policy is asking a backend to consider compaction. */
type CompactionTrigger = 'pressure' | 'context-overflow'
```

`docs/subsystems/compaction.md:77` adds: "Automatic callers state why policy is running; implementations may treat confirmed overflow more aggressively than ordinary pressure."

**Overflow — `agent/request-error`.** `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:42`:

> "Canonical provider context overflow takes a separate path. The failed step closes and `agent/request-error` receives the original request error. Compact-basic owns its per-agent overflow count, prunes before forcing one useful balanced reduction, and returns `{ kind: 'retry' }` only if `session.surface.replaceGeneration` increases, including pruning-only progress when no summary range exists. The loop then closes the failed turn, opens a new numbered retry turn, and reconstructs its request from the durable log. No replacement, a recovery failure before any replacement, cancellation, an exhausted cap, or an unrelated error preserves the original provider failure. If pruning already advanced the generation before later summary work fails, recovery retries from that durable pruned surface unless cancellation or disposal wins."

The event order is given as a diagram at the same note, `:49-51`:

```
provider overflow → step/end
await waterfall agent/request-error  ⟵ forced compaction between attempts
retry → next numbered step/start      ⟵ derives from the replacement surface
```

`docs/event-producer-consumer.md:22` confirms `compaction-basic` (plus `compaction-image-offload` and `llm-retry`) listen on `agent/request-error`. The canonical code this routes on is `CONTEXT_WINDOW_EXCEEDED`, per `docs/subsystems/llm-streaming.md:303`:

> "**Context overflow has one canonical code.** Both DeepSeek adapters classify explicit provider detail through `isContextWindowExceededError()` and surface `CONTEXT_WINDOW_EXCEEDED`, whether the failure arrives as a thrown HTTP `LlmError` or an in-band finish error. Consumers route on the code, never provider text."

The core contract the listener plugs into, `docs/subsystems/core.md:330-335`:

> "`agent/request-error` runs after a failed model step closes and before its turn closes. Listeners can repair durable state or await policy work while the failed turn's signal is still live. A handling listener returns `{ kind: 'retry' }` without calling `next()`; the default `undefined` leaves the failure terminal."
> ```ts
> type RequestErrorAction = { kind: 'retry' } | undefined
> ```

Payloads (`docs/subsystems/core.md:938`, `:997`): `agent/pre-step` gets `{ agent, messages, turn, step, signal }`; `agent/request-error` gets `{ agent, turn, step, provider, failure, retryPolicy, signal }`.

#### 2.3 Retry semantics and convergence

`.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:70` (second half):

> "Convergence remains dynamic because provider output caps can be spent on hidden or surfaced reasoning tokens and summary size is unpredictable. If pressure remains over threshold, `compactIfNeeded()` re-compacts the head checkpoint up to the configured retry count, but each committed summary must be smaller than what it shadows. Overflow needs no capacity metadata and bypasses threshold and retained-tail policy for one maximal balanced head reduction, leaving the newest indivisible unit."

`docs/agent-lifecycle.md:85` states the retry gate in terms of the surface generation:

> "Recovery runs within the open step and retries only when pruning or summarization advances the surface replacement generation; otherwise the original request error remains authoritative. Each retry prepares its call and reconciles the retained rendered assembly before request derivation, without repeating assembly, pre-step, or user admission."

`docs/subsystems/compaction.md:101` adds the pruning-only nuance and cancellation precedence:

> "Failed-request recovery runs through `agent/request-error` after the failed step closes and returns a retry action only when the surface replacement generation advances, even if later summary work throws after pruning; cancellation still wins."

Caps: `compactionRetries` "Extra attempts after the first compaction when pressure remains above threshold. Defaults to `1`."; `maxOverflowRetries` "Maximum retries after canonical context overflow; `0` disables recovery. Defaults to `1`."

#### 2.4 What happens when summarization fails or does not shrink context

- **Failure before any replacement → surface unchanged, original error preserved.** `.agents/notes/.../2026-06-18-compaction-capability-seam.md:42`: "No replacement, a recovery failure before any replacement, cancellation, an exhausted cap, or an unrelated error preserves the original provider failure."
- **Failure after a successful prune → retry from the pruned surface** (same line: "If pruning already advanced the generation before later summary work fails, recovery retries from that durable pruned surface unless cancellation or disposal wins").
- **Recoverable failure keeps one `compaction/end { error }` attempt.** Same note, `:105`: "once start lands, the backend makes exactly one `compaction/end { error }` attempt. Summary or stability failure leaves the conversation surface unchanged while preserving the failed attempt in the log. If the close append fails, the unmatched start remains intentionally blocking." `:107`: "There is no separate `compaction/error` event."
- **No-shrink summary is rejected by policy, not by a rewrite.** The only stated rule is "each committed summary must be smaller than what it shadows" (`:70`). There is no documented rollback of a committed replacement — the mechanism by which a too-large summary is detected/refused pre-commit is **not specified** in this snapshot.
- **No safe range → `null`, no writes.** `docs/subsystems/compaction.md:154-155`: "Return `null` when no safe range can be compacted. A single oversized retained unit or request envelope cannot be repaired through surface compaction." `:60` (note): "When the only compactable content left is an un-splittable open tail step (its tool-calls have no results yet), compaction declines (`null`) and retries once that step closes."

#### 2.5 Retention: turn-agnostic, balance-guarded

`.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:56-62` is the load-bearing passage:

> "Auto-compaction checks after **every successful** step, not once per turn. This is load-bearing for runaway-turn survival: a tool-heavy ReAct turn appends an `assistant/message` + a `tool/result` per step, so the surface grows within a turn. The next pre-step check can compact early closed tool pairs before continuation opens another step, and provider-confirmed overflow remains the backstop when a request crosses the limit first."
>
> "`compactIfNeeded` retains the smallest tail of whole surface units whose estimated size reaches the resolved retained-token budget and compacts older nodes. A unit is a complete closed step or one no-step message. If the token cutoff lands inside a step, retention expands until the cut is tool-pairing balanced. Balance is checked on surface order, not log sequence, because replacement summaries have new sequence numbers at old surface positions. `dsh-compaction` exports the before/after edge helpers; their per-session cache folds only appended surface-tail nodes while `replaceGeneration` is unchanged, does no event reads for log-only growth, and rebuilds current membership and balances after replacement. `compactRegion` rejects boundaries that split a tool call from its result. The in-flight turn receives no special retention."
>
> "**Some single-unit overflow remains out of scope.** Summary range selection cannot split an indivisible unit. The optional pruner can repair a closed tool pair when removable text-bearing tool-result content is the bulk and the pruned remainder fits. Envelope-only pressure, an oversized indivisible non-tool node such as a pasted `user/message`, and a tool unit whose non-prunable remainder is still oversized remain outside compaction; bounding those units is a separate concern."

`docs/subsystems/compaction.md:103` documents the exported guards:

> "The Service Definition exports `toolPairingBalancedBefore(session, seq)` and `toolPairingBalancedAfter(session, seq)` for the tool-call/result pairing checks before and after a seq. Both validate current surface membership and reject missing seqs and orphan results; the [package contract](.../README.md#tool-pairing-boundaries) defines their cache behavior." — *the linked README is not in this snapshot.*

`docs/subsystems/compaction.md:101` adds: "Region boundaries preserve tool-call/result pairing but not whole turns, allowing early closed steps of one oversized turn to compact."

---

### 3. Tool-result pruning (`dsh-compaction-tool-result-pruner`)

**Status and role.** It is a *model-free companion*, not a second compaction implementation. `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:23`:

> "**Model-free companion** — `@deepseek-ai/dsh-compaction-tool-result-pruner`: a concrete optional service that rewrites oversized current `tool/result` nodes before the backend selects a summary range. It is not a second compaction implementation and does not implement `CompactionEngine`."

`docs/capability-seams.md:594` (service table, `ctx.toolResultPruner`, classed `core`, consumer `compaction-basic`):

> "Rewrites oversized current tool results through replayable single-node surface replacements before summary compaction."

**Config** (`docs/config-catalog.md:723-742`, source `packages/compaction/compaction-tool-result-pruner/src/types.ts:5`, `inject: tokenMeter`):

```ts
/** Character-budget policy for deterministic tool-result pruning. */
export interface ToolResultPruneConfig {
  /** Prune when total text exceeds this many Unicode code points. Defaults to `8192`. */
  thresholdChars?: number
  /** Maximum leading Unicode code points retained. Defaults to `4096`. */
  headChars?: number
  /** Maximum trailing Unicode code points retained. Defaults to `1024`. */
  tailChars?: number
}
```

Note the arithmetic: `headChars` + `tailChars` = 4096 + 1024 = 5120, i.e. when a result exceeds `thresholdChars` = 8192 the *middle* is what is dropped. **No documentation in this snapshot states the ellipsis/marker text** inserted between head and tail, or whether the omitted length is reported (see §(d)).

**Head/middle/tail and code-point slicing.** `docs/subsystems/compaction.md:216`: "Deterministic head/middle/tail pruning for current tool-result surface nodes." The service contract, `docs/subsystems/compaction.md:219-247`:

```ts
/**
 * Measure text content in Unicode code points; non-text blocks cost zero.
 */
measureContent(blocks: readonly ContentBlock[]): number

/**
 * Replace an over-budget text middle while retaining rich-block order.
 * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
 * boundary cannot split a surrogate pair. Grapheme clusters may still split.
 * @returns pruned content, or `null` when the text is within budget.
 */
pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null

/**
 * Prune every over-budget tool result from one stable current-surface snapshot.
 * Each replacement preserves the complete event data except for `content`,
 * cites the shadowed node so replay can recover the replacement input, and is
 * immediately preceded by a `compaction/prune` shadow-price event pricing the
 * shadowed node through the injected token meter, so pure consumers can
 * subtract it without per-node state.
 * @throws when the session rejects a replacement; replacements committed
 * earlier in the pass remain durable.
 */
pruneSession(session: Session): PruneResult
```

**Outcome accounting** (`docs/subsystems/compaction.md:109-133`): `PrunedEntry` = `{ originalSeq, replacementSeq, callId, charsBefore, charsAfter }` where the char fields are "Original/Replacement text size in Unicode code points"; `PruneResult` = `{ pruned: readonly PrunedEntry[], charsRemoved }` with `charsRemoved` the "Total Unicode code points removed across replacements."

**`compaction/prune` — the pricing event.** `docs/persistence-catalog.md:376-400`:

```ts
/**
 * Shadow price of one model-free prune replacement — log-only, no
 * surfaceOp. The shared shadow-price protocol: a surface `replace` event
 * is priced by the metering event immediately before it (`compaction/summary`
 * for a summarizing compaction, this event for a prune), which states the
 * heuristic token price of the exact replaced range so a pure consumer
 * can subtract it without retaining per-node prices. The replacement MUST
 * be appended synchronously right after this event.
 */
'compaction/prune': {
  shadowedRange: { start: SessionSeq; end: SessionSeq }
  shadowedSeqs: SessionSeq[]
  shadowedTokenCount: number
}
```

The price used is the *route-independent heuristic*: `docs/subsystems/token-meter.md:45-50` defines `TokenSurfaceNode.heuristicTokens` as "Fixed-heuristic tokens for the same message, independent of any route. The shadow-price protocol prices replacements with this value so the O(1) projection fold stays in agreement with its own appends."

**Why it runs before summary selection, and why it can advance the surface alone.** `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:40`:

> "Once pressure qualifies, optional `ctx.toolResultPruner` rewriting runs before summary selection; compaction-basic remeasures the durable surface and skips summarization if pruning restores safe pressure."

And `:42` for the overflow path: it "prunes before forcing one useful balanced reduction, and returns `{ kind: 'retry' }` only if `session.surface.replaceGeneration` increases, **including pruning-only progress when no summary range exists**."

So a prune-only pass is a *complete, sufficient* compaction outcome: it commits surface replacements (each its own single-node `replace`), advances `replaceGeneration`, and the `agent/request-error` handler legitimately returns `retry` with no summary at all. `docs/subsystems/compaction.md:101` states the same: compaction-basic "invokes optional `ctx.toolResultPruner` before range selection, remeasures through `ctx.tokenMeter`, and can advance the surface without a summary."

---

### 4. Image offload (`compaction-image-offload`)

**Declaration.** `docs/persistence-catalog.md:612-625`:

```ts
/**
 * Permanently omit selected input-image occurrences from subsequent model requests.
 * Targets name unique current user/message or tool/result nodes. Nonempty, strictly
 * increasing indexes count all images in depth-first order, including nested tool
 * results and already omitted images. Message nodes and identities remain unchanged.
 * @messageProjection
 */
'image/offload': { targets: ImageOffloadTarget[] }
```

Source cited: `packages/compaction/compaction-image-offload/src/projection.ts:25`.

**Target type.** `docs/subsystems/compaction.md:28-38`:

```ts
/** Exact input-image occurrences selected by one durable offload decision. */
interface ImageOffloadTarget {
  /** Current message-producing event containing these occurrences. */
  seq: SessionSeq
  /** Zero-based depth-first image indexes within the immutable message. */
  imageIndexes: number[]
}
```

Same shape in the persistence catalog, `docs/persistence-catalog.md:3620-3637` (`imageIndexes: number[]`, `seq: number`; sources `.../projection.ts:9`).

**No `surfaceOp`.** `docs/subsystems/compaction.md:28`:

> "`compaction-image-offload` owns the `image/offload` declaration and its pure message projection. Each target identifies a current input node and exact depth-first image occurrences. The event preserves node and message identities and carries no `surfaceOp`. The [package README](.../README.md) owns recovery policy, registration, and detached replay." — *that README is not in this snapshot.*

It participates in the plugin-owned message-projection machinery (`docs/subsystems/session.md:362-365`), which is how a log-only event changes existing message *content* without changing node membership or message identity:

> "Content-changing plugins mark their event declaration with `@messageProjection` and register a pure definition through `ctx.sessions.registerMessageProjection()`. Session validates the complete decision through that definition before commit, applies its immutable message updates, and advances `contentGeneration`. … The [image-offload plugin](compaction.md#image-offload) owns its image-specific event and interpretation."

**Trigger: route-side budget failure, then durable record.** `docs/subsystems/llm-streaming.md:245-251`:

```ts
/**
 * With code `IMAGE_OFFLOAD_REQUIRED`: how many more of the oldest retained
 * image occurrences the route needs offloaded before the same request fits
 * its exact byte accounting. `dsh-compaction-image-offload` records the
 * selected occurrences in an `image/offload` event and retries the step.
 */
readonly offloadImages?: number
```

`.agents/notes/implemented/feature/2026-08-20-unified-image-request-pipeline.md:29` gives the oldest-first policy and the placeholder projection:

> "Request-size offload follows the [durable image-offload decision](../architecture/2026-09-10-image-offload-events.md). Routes check retained occurrences against their request-version byte and image-count budgets and report `IMAGE_OFFLOAD_REQUIRED` with a removal count. The compaction plugin records exact oldest-first occurrences in `image/offload`; Session derivation applies the marks. Adapters prepare only retained attachments and render each marked occurrence as placeholder text with its identity and current execution-world access path, including nested tool-result images. Original message events retain the attachment references."

It listens on `agent/request-error` (`docs/event-producer-consumer.md:22`) and is the sole listener of `compaction/summary-error` (`:34`), so it is also the recovery hook for image-heavy summarize failures (see §6). Plugin row: `@deepseek-ai/dsh-compaction-image-offload` with `inject: agents · sessions` (`docs/config-catalog.md:4392`). It has **no generated config section**, i.e. no documented config keys.

**Pricing interplay.** `docs/subsystems/llm-streaming.md:257`:

> "The token meter resolves the routed model's pricing on every measurement so compaction pressure, retention, and range selection price image history as the routed request actually sends it; the DeepSeek adapter prices each retained occurrence at its per-model request target with the published vision accounting and each occurrence selected by a logged image-offload decision as its placeholder text, while provider usage remains the authoritative anchor for completed requests."

And `docs/architecture.md:113`: "Surface replacements and image-offload decisions after attachment start a new request series, including during the first resumed pre-step; unchanged resume continues the series."

---

### 5. Durable bookkeeping and locking

**Three log-only events.** `docs/subsystems/compaction.md:11`:

> "Compaction extends [`SessionEventMap`](session.md) with three event types via declaration merging. All three are **log-only** — they record the lock, summary, selected range, shadowed event seqs, token count, and model call without joining the surface."

Payloads (`docs/subsystems/compaction.md:13-17`, matching `docs/persistence-catalog.md:360-469`):

| Event | Payload | Role |
|---|---|---|
| `compaction/start` | `{ turn }` | "acquires the log-recorded lock; a number identifies the open automatic turn, while `null` identifies a standalone manual attempt" |
| `compaction/summary` | `{ summary, rawOutput?, llmStreamCall?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | the safe summary projection, optional raw provider output and usage, the `llmStreamCall: true` marker, the shadowed surface-boundary pair, shadowed seqs in surface order, the estimated token count, and the summarize call's envelope |
| `compaction/end` | `{ turn, error? }` | "releases the lock with the same numeric-or-null owner (`error` records an unsuccessful attempt)" |

The concrete merged payloads add the transaction identity in every case — `docs/persistence-catalog.md:412`:

```ts
'compaction/start': { compactionId: CompactionId; sourceCommandId?: CommandId; turn: number | null }
```

`:371`:

```ts
'compaction/end': { compactionId: CompactionId; sourceCommandId?: CommandId; turn: number | null; error?: string }
```

`:431-464` (abridged to the discriminants):

```ts
'compaction/summary': {
  compactionId: CompactionId
  sourceCommandId?: CommandId
  summary: ContentBlock[]
  shadowedRange: { start: SessionSeq; end: SessionSeq }
  shadowedSeqs: SessionSeq[]
  shadowedTokenCount: number
  provider: string
  model: string
  maxTokens?: number
  usage?: TokenUsage
} & (
  | { rawOutput: ContentBlock[]; llmStreamCall: true }
  | { rawOutput?: ContentBlock[]; llmStreamCall?: never }
)
```

with the contractual adjacency spelled out at `:422-429`:

> "Completed summary, its inputs, and its model call facts — log-only, no surfaceOp. The summary content is in `data.summary`; the actual surface replacement is performed by the immediately following `user/message` event that shadows the compacted range. That adjacency is contractual — the shadowed pricing fields are the replacement's shadow price, so a consumer may pair a replacement with the metering event directly before it."

`compaction/start`'s owner rule, `docs/persistence-catalog.md:407-411`:

> "Marks the start of a compaction — log-only, holds the lock until `compaction/end`. A numbered owner is strictly enclosed by that open turn; `null` identifies a standalone manual transaction between turns."

**The ordering, and why the lock brackets everything.** `docs/subsystems/compaction.md:19`:

> "The lock brackets the **whole** operation: `compaction/start` is appended first, then summarization, the `compaction/summary` record, and the `user/message` replacement all land, and only then `compaction/end`. Releasing the lock last turns a crash mid-operation into a detectable orphaned lock (a `compaction/start` with no matching `compaction/end`) rather than a `compaction/end` that falsely claims compaction finished."

`.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:76-84` gives the exact sequence:

```
compaction/start    → log-only. Acquires the lock.
[summarize older range via the backend]
compaction/summary  → log-only. Records the raw summary, local-call marker, range, shadowed seqs, and token count.
user/message     → canonical checkpoint source + surfaceOp { op:'replace', startSeq, endSeq }.
                   THE surface mutation (framed summary).
                   deriveMessages() renders it as a user-role message.
compaction/end      → log-only. Releases the lock (carries `error` on a recoverable failure).
```

**Markers are time points, not a container.** `docs/subsystems/compaction.md:21`:

> "The markers are lock time points, not an exclusive container. An unrelated idle injection can appear between a standalone manual start and end while summarization is pending. The manual path revalidates only its selected positional span, so that injected context survives after the replacement checkpoint. A live unmatched start blocks every entry point; an unmatched start before a newer `session/end-seed` is stale evidence from a prior lifecycle and is ignored."

Same point at `.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md:60-62` and `:94` ("`compaction/summary` names the selected range and shadowed seqs exactly; exclusivity would add no correctness and would reject valid injection").

**Crash-safe orphan classification via `session/end-seed`.** `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:101-105`:

> - "**Current lifecycle:** a dangling `compaction/start` after the newest `session/end-seed` is the live durable lock and reports busy."
> - "**Later lifecycle:** a newer constructor-written `session/end-seed` proves that the older unmatched start is stale, so resume, fork, and adoption do not remain wedged by a dead writer."
> - "**Recoverable failure:** once start lands, the backend makes exactly one `compaction/end { error }` attempt. … If the close append fails, the unmatched start remains intentionally blocking."

The core boundary's own JSDoc, `docs/persistence-catalog.md:804-809`:

> "An owner of a standalone open/close bracket (`compaction/start` … `compaction/end`) reads it because seed history and live work are otherwise byte-identical: an unmatched opening marker before this event belongs to an ended lifecycle, whatever ended it. NOT a liveness signal about other writers — a concurrently live session holds its own boundary elsewhere, so tolerating concurrent writers needs a signal beyond the log."

`docs/subsystems/session.md:743` adds that core stays compaction-agnostic:

> "Core writes the boundary and reads nothing from it — a bracket's vocabulary stays with its owning plugin, which is why crash repair closes turn/step/tool boundaries and never `compaction/*`."

**Client-side orphan handling.** `.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md:72`:

> "The client request projection closes an unmatched compaction request as interrupted at the `session/end-seed` time and clears its active index. A later `compaction/start` therefore creates an independent request instead of leaving or overwriting a permanently running orphan."

**One parameterized transaction, eight steps.** `.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md:37-48`:

> "`dsh-compaction-basic` has one region transaction parameterized by bracket owner (`number | null`), stability rule (whole surface or selected span), and an optional flush. It performs one ordering:
>
> 1. validate the selected positional range and inspect the durable tail;
> 2. reject a live unmatched compaction marker;
> 3. append `compaction/start` synchronously;
> 4. prepare and await summarization;
> 5. revalidate the required stability;
> 6. append `compaction/summary` and the replacement `user/message`;
> 7. make exactly one `compaction/end` attempt;
> 8. flush when the manual caller requested durability.
>
> Automatic and explicit-region work use the numeric owner recovered from the open turn and require whole-surface stability. Manual work reserves admission first, selects a useful range before the transaction, and writes nothing when selection returns `null`. Its bracket uses `turn: null`, requires only selected-span stability, and flushes every successfully closed attempt before releasing admission in `finally`."

And `:50`:

> "`compaction/start` is therefore the only compaction lock. There is no `WeakSet`, wrapper mutex, locked/unlocked method split, or redundant activity check around the transaction."

**Manual vs. explicit-region paths.**

`compactNow` — `docs/subsystems/compaction.md:164-184` (JSDoc, abridged in the middle):

```ts
/**
 * Explicitly compact useful history even below automatic pressure thresholds.
 * Implementations synchronously start an idle task before any asynchronous
 * work, select a useful range without writing on a no-op, then
 * append a standalone `compaction/start` before summarization. That durable
 * marker is the compaction lock until one `compaction/end` attempt. Later waking
 * prompts remain accepted in FIFO order and start only after the optional
 * durability checkpoint and idle-task settlement. Context injected while the
 * summary runs may sit between the marker pair; only the selected span must
 * remain stable.
 * @throws {@link ManualCompactionError} for expected busy, agent-cancellation,
 * changed-span, summarization/shrink, commit-stage, or persistence failures;
 * an aborted request preserves its exact abort reason. Failed attempts remain
 * visible in the log.
 */
abstract compactNow( agent: ManualCompactAgentContext, signal: AbortSignal, sourceCommandId?: CommandId, ): Promise<CompactionResult | null>
```

`docs/subsystems/compaction.md:84` adds: "`compactNow()` runs as agent maintenance between turns, returns `null` without writing when no useful range exists, records a standalone `turn: null` bracket before summarization, and flushes a closed attempt before later queued prompts may derive from the new surface."

Idle admission is *claimed synchronously* — `.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md:29`:

> "`Agent.runMaintenance(task)` starts only from the idle phase and claims that phase before invoking the task. A waking send starts the loop immediately when idle, so whichever operation claims the phase first owns the boundary."

The human entry point is `@deepseek-ai/dsh-command-compact` (plugin row `docs/config-catalog.md:4388`, `inject: commands · compaction`); `docs/subsystems/compaction.md:5` calls it the "human Consumer". `.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md:21`:

> "`@deepseek-ai/dsh-command-compact` registers one argument-free human command through `ctx.commands`. It calls the third abstract `CompactionEngine` operation, `compactNow(agent, signal)`, and maps the closed `ManualCompactionError` taxonomy (`busy | changed | summary | commit | persistence`) to direct UI results. `command/run` and `command/done` preserve the command lifecycle without entering model history or consuming a model-loop turn."

`compactRegion` — `docs/subsystems/compaction.md:186-205`:

```ts
/**
 * Forcibly compact a range of surface nodes into a single summary node.
 * `start` and `end` name an inclusive span by surface position, not numeric seq
 * order; replacements can make visible seqs non-monotonic. Both edges must be
 * balanced so assistant tool calls remain paired with their results. A model-
 * backed implementation forwards cancellation and rejects active, missing,
 * reversed, or unbalanced ranges. The target session is `agent.session`.
 * Its replacement user message must use {@link compactCheckpointSource} with
 * the transaction's `CompactionId`.
 * Use {@link toolPairingBalancedBefore} and {@link toolPairingBalancedAfter}
 * for the edge checks.
 * @param start - first surface seq, inclusive.
 * @param end - last surface seq, inclusive.
 * ...
 * @throws when compaction is active or the range is missing, reversed, or unbalanced.
 */
abstract compactRegion( start: SessionSeq, end: SessionSeq, agent: CompactionAgentContext, signal?: AbortSignal, ): Promise<CompactionResult>
```

**`ManualCompactionErrorCode` semantics.** `docs/subsystems/compaction.md:86-99`:

```ts
/** Expected failure classes for an explicit idle-session compaction request. */
type ManualCompactionErrorCode =
  | 'busy'
  | 'cancelled'
  | 'changed'
  | 'summary'
  | 'commit'
  | 'persistence'
```

> "`changed` and `summary` close and persist the failed attempt without a summary replacement; image omissions recorded during recovery remain effective. `commit` may follow partial mutation; `persistence` means the in-memory bracket closed but its flush failed. Cancellation remains separate and throws the exact abort reason after required cleanup."

The user-facing consequence is stated at `.agents/notes/implemented/feature/2026-07-30-queued-manual-compaction.md:64`:

> "Failed `changed` or `summary` attempts leave the conversation surface unchanged, but the log is not unchanged: it contains `compaction/start` and `compaction/end { error }`. User-facing text states that distinction."

and `:74`:

> "Once a transaction has appended its start, every later failure makes one closing attempt. A failed close leaves the unmatched start deliberately visible and blocking, and no flush is attempted. A closed manual attempt is flushed even when it reports an expected failure. Cancellation retains exact-reason precedence after required close and flush cleanup."

**Tool-call/result pairing balance.** `docs/subsystems/compaction.md:103` (quoted in §2.5) defines `toolPairingBalancedBefore` / `toolPairingBalancedAfter`. The seam note, `:124`, states their contract:

> "The cached surface-edge checks prevent `compactRegion` and `compactIfNeeded` from splitting a tool-call/result pair, validate current membership by seq, answer both edges from one per-cut balance sequence, and reject stale or missing seqs and orphan results."

And `docs/subsystems/compaction.md:101`: "Region boundaries preserve tool-call/result pairing but not whole turns, allowing early closed steps of one oversized turn to compact."

The full `#tool-pairing-boundaries` contract lives in `packages/compaction/compaction/README.md`, which **is not in this snapshot**.

**Session-side validation of the replacement.** `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:125`:

> "`dsh-session` validates positional replacement, complete cited source-event coverage, and content-only single-node `tool/result` rewrites through its one surface manager. Its invariant companion treats fresh appended tool results as executions that require an open step and pending call, while the compaction companion owns numeric-turn versus standalone-null bracket relations."

`docs/subsystems/session.md:601-603` lists what `Session.append` validates: "marker shape and eligibility, unique earlier source-event references, positional replacement validity, and complete shadowed-node coverage".

**Recovery waterfall signature.** `docs/subsystems/compaction.md:262-278`:

```ts
/**
 * Recover a failed summary request by synchronously recording a durable
 * change to its selected input. Return true only after making progress;
 * the provider re-derives and re-prices the selection before retrying.
 * Call next() when the failure cannot be recovered. Decisions survive a
 * later summary failure or cancellation.
 * @mode waterfall
 */
'compaction/summary-error'(payload: { session: Session; sourceEventSeqs: readonly SessionSeq[]; error: unknown; signal?: AbortSignal }, next: () => boolean): boolean
```

Declared at `packages/compaction/compaction/src/index.ts:106`, dispatched by `compaction-basic`, listened to by `compaction-image-offload` (`docs/event-producer-consumer.md:34`).

---

### 6. The summarize model call

**Routing and target resolution.** `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:36` is the single densest passage:

> "The default summarizer resolves its target from explicit config, the latest logged routed target, then agent options, and records the provider/model pair after any `llm/stream` routing. It replays the routed request's prefix and appends the compaction directive as a trailing user message so the provider's warm KV cache is reused — see the [`dsh-compaction-basic` README](.../README.md). The result carries `llmStreamCall: true` because it consumed exactly one call through this context's LLM service; a subclass sets that marker only under the same condition, since retained `rawOutput` alone does not identify the call path. The call sets the provider-neutral `GenerateOptions.purpose` to `compaction`; adapters may map that purpose to model-hidden transport metadata, and the DeepSeek adapter sends `x-deepseek-harness-compact: 1`."

*The cited `dsh-compaction-basic/README.md` is not in this snapshot*, so the "replay the prefix + append directive" mechanics and the directive wording are documented only by this summary.

**The purpose discriminant.** `docs/subsystems/llm-streaming.md:635-640`:

```ts
/**
 * Provider-neutral classification for an auxiliary model call. Adapters may
 * map the purpose to model-hidden transport metadata or purpose-specific
 * generation policy. Ordinary conversation requests leave it unset.
 */
purpose?: 'compaction' | 'session-title'
```

**The wire header.** `docs/deepseek-llm-api-wire-extensions.md:29`:

| Header | Presence | Value |
|---|---|---|
| `x-deepseek-harness-compact` | Model requests whose purpose is `compaction` | The literal string `1` |

`docs/deepseek-llm-api-wire-extensions.md:31` notes "Session-title requests have no additional purpose header". So the header is DeepSeek-adapter-specific; other adapters "may map that purpose to model-hidden transport metadata".

**Recording of provider/model/maxTokens/usage.** The provider and model are required fields on `compaction/summary` (`docs/persistence-catalog.md:438-450`):

> "`provider`: The provider route that wrote the summary. `model`: The model that wrote the summary — the summarize call's envelope, reported by the backend that made the call, logged so the one-shot request is reconstructable from log + code and 'which model wrote this summary' has a durable answer." `maxTokens`: "The generation cap the summarize call sent, when one applied." `usage`: "Provider-reported token usage for the summarization request, when emitted."

The `llmStreamCall` marker's exact contract (`docs/subsystems/compaction.md:16`):

> "an `llmStreamCall: true` marker when producing the result consumed exactly one call through this context's `ctx.llm.stream()` (which requires complete `rawOutput`), … unmarked `rawOutput` does not identify the call path"

Its purpose is reconstruction safety (`docs/persistence-catalog.md:455-456`): "Identifies exactly one call through this context's `ctx.llm.stream()`" versus "An unmarked summary does not identify a call through this context's LLM seam." The testing section of the seam note is explicit that this marker is load-bearing (`:134`):

> "The assembled context-overflow scenario derives the auxiliary call from `compaction/summary` only when `llmStreamCall: true` proves that the local LLM service consumed it."

**Signal forwarding is mandatory.** `docs/subsystems/compaction.md:84`: "Implementations must forward the supplied signal to summarization." Also in the `compactIfNeeded` JSDoc `:159`: "@param signal - cancellation signal; model-backed implementations must forward it."

**Cancellation precedence.** `docs/subsystems/compaction.md:101`: "…even if later summary work throws after pruning; cancellation still wins." And `:99`: "Cancellation remains separate and throws the exact abort reason after required cleanup."

**`compaction/summary-error` recovery waterfall.** Semantics from the JSDoc (`docs/subsystems/compaction.md:262-278`, quoted in §5): a listener must synchronously record a durable change to the selected input and return `true` **only after making progress**; the provider then *re-derives and re-prices the selection before retrying*; `next()` delegates; "Decisions survive a later summary failure or cancellation." The only known listener is `compaction-image-offload` (`docs/event-producer-consumer.md:34`), which matches `docs/subsystems/compaction.md:99`: "image omissions recorded during recovery remain effective." The number of times the waterfall may be re-entered is **not stated**.

**Framing is backend-private.** `.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md:88-90`:

> "**Checkpoint framing + incremental merge (backend-private)** — The basic backend wraps the summary as established checkpoint context and tags it for incremental merging on the next cycle. The raw summary remains on `compaction/summary`. Framing is backend policy; the seam promises that one replacement user message carries the possibly framed summary and uses the canonical checkpoint source."

`docs/subsystems/compaction.md:11` repeats: "the summary itself rides on a separate `user/message` … " and the note at `:90` says only that the *content* is "the (framed) summary". **No framing text is quoted anywhere in this snapshot.**

---

### 7. Token metering interplay (`ctx.tokenMeter`)

**Ownership split.** `docs/subsystems/compaction.md:84`:

> "The seam owns no pricing API: the singleton [`ctx.tokenMeter`](token-meter.md) directly owns estimation and replay, while `dsh-compaction-basic` owns retention, event sequencing, routed summarization calls, and their configuration."

`docs/capability-seams.md:593` classes it `core`, backed by `packages/llm/token-meter`, consumed by `compaction-basic`: "Owns isolated per-session replay folds; pressure consumers share immutable revisioned measurements." Its config surface is empty: `docs/config-catalog.md:3454-3456` — `export type TokenMeterConfig = Record<string, never>` with the comment "Token-meter plugin configuration; the fixed estimator has no settings."

**Measurement shape.** `docs/subsystems/token-meter.md:5`:

> "`@deepseek-ai/dsh-token-meter` exposes one detached replay snapshot for request pressure and positional surface pricing. `logRevision` is the number of durable events consumed for every field in the measurement."

The type (`docs/subsystems/token-meter.md:13-26`):

```ts
interface TokenMeasurement {
  readonly logRevision: SessionLogOffset
  readonly baseline: TokenMeasurementBaseline
  readonly surfaceDeltaTokens: number
  readonly totalTokens: number
  readonly surfaceTokens: number
  readonly nodes: readonly TokenSurfaceNode[]
}
```

`docs/subsystems/token-meter.md:29` explains the anchor:

> "`baseline.kind === 'usage'` means the latest successful provider call has the same canonical request envelope and its total is no lower than that call's full route-priced anchor. `estimated` means no reusable conservative usage anchor exists, so the service priced the complete envelope and surface itself. … `totalTokens` remains request-and-response pressure, while `surfaceTokens` is the surface-only route-priced total and equals the sum of the node prices."

**Per-node price used by compaction.** `docs/subsystems/token-meter.md:35-52`:

```ts
interface TokenSurfaceNode {
  readonly seq: SessionSeq
  /**
   * Request-pressure tokens for the exact message projected by this node under
   * the measured route: image occurrences carry the route's declared visual
   * price when the routed adapter declares one, and the fixed heuristic
   * otherwise. Trigger, retention, and range selection all read this price.
   */
  readonly tokens: number
  /**
   * Fixed-heuristic tokens for the same message, independent of any route.
   * The shadow-price protocol prices replacements with this value so the O(1)
   * projection fold stays in agreement with its own appends.
   */
  readonly heuristicTokens: number
}
```

That JSDoc line — "Trigger, retention, and **range selection** all read this price" — is the explicit statement that all three compaction decisions are priced from the *same* metered node prices. `docs/subsystems/token-meter.md:54` warns about ordering: "Surface order is authoritative; replacement nodes can have higher durable seqs than later positional nodes. The snapshot is immutable and does not grow when the underlying replay fold advances."

**The one service call.** `docs/subsystems/token-meter.md:71-92`:

```ts
/**
 * Measure current request pressure and surface through the durable tail.
 * ...
 * `requestHeader` replaces the latest logged envelope for pressure and node
 * pricing; the node set always describes the current session surface. Every
 * call clones those positional nodes, so measurement is O(surface).
 */
measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement

/**
 * Heuristically price one model-visible message (instance face of the pure
 * `estimateMessage` export from `estimate.ts`).
 */
estimateMessage(message: Message): number
```

**Named thresholds and percentages in the docs** (the complete set found):

| Name | Value | Source |
|---|---|---|
| `thresholdRatio` (pressure window fraction) | `0.8` | `docs/config-catalog.md:693-694`; note `:70` |
| `headroomTokens` (additional pressure headroom beyond routed output reservation) | `65536` | `docs/config-catalog.md:695-696` |
| `retainRatio` (recent context kept, as fraction of window minus reserved output) | `0.16` | `docs/config-catalog.md:697-698`; note `:70` |
| `retainTokens` (absolute recent-context budget) | mutually exclusive with `retainRatio`; no default stated | `docs/config-catalog.md:699-700` |
| `maxTokens` (summarization generation cap) | contradictory in snapshot: `8192` (note `:70`) vs. "resolved `headroomTokens`" (`docs/config-catalog.md:705-706`) | see §2.1 |
| `compactionRetries` | `1` | `docs/config-catalog.md:707-708` |
| `maxOverflowRetries` | `1` (`0` disables) | `docs/config-catalog.md:709-710` |
| `auto` | `true` | `docs/config-catalog.md:687-688` |
| `thresholdChars` (pruner) | `8192` code points | `docs/config-catalog.md:734-735` |
| `headChars` (pruner) | `4096` code points | `docs/config-catalog.md:736-737` |
| `tailChars` (pruner) | `1024` code points | `docs/config-catalog.md:738-739` |

Constraint stated in prose: "Retention must remain below the resulting threshold." (`.agents/notes/.../2026-06-18-compaction-capability-seam.md:70`). No other percentages or ratios are named anywhere in the snapshot's compaction material.

**No provider caching.** Nothing in the compaction material describes provider prompt caching as a compaction mechanism. The only cache-adjacent statement is a *side effect* of the summarize call's shape (`docs/.../2026-06-18-compaction-capability-seam.md:36`): the prefix replay "so the provider's warm KV cache is reused". Session-log exposure of summaries is noted at `docs/deepseek-llm-api-wire-extensions.md:160` ("`dsh_session_log` may expose … compaction summaries").

---

## (c) Concrete algorithm as far as the docs specify it

Numbered pseudo-algorithm assembled strictly from the cited statements. Steps marked ⚠ are documented as *policy* without a documented mechanism.

### C1. Automatic pressure check — `agent/pre-step`

1. On every **successful** step boundary, at the next `agent/pre-step` waterfall (before request derivation), compaction-basic receives `{ agent, messages, turn, step, signal }`. *(note `:38`, `:56`; core.md:314, :938)*
2. Measure the **canonical logged request** through `ctx.tokenMeter.measure(session)` — no speculative envelope override. *(note `:40`)*
3. Compare against the threshold: `thresholdRatio` × (context window − reserved output − `headroomTokens`), computed against the capacity declared by the route-owning LLM adapter. If the target has an exact `modelPolicies` entry, its fields partially override the top-level policy. *(config-catalog.md:693-696; note `:70`)*
4. If not over threshold → return `null`, no writes. *(compaction.md:154)*
5. If over threshold and `ctx.toolResultPruner` is available → run the prune pass (C3).
6. Re-measure the durable surface through `ctx.tokenMeter`. If pruning restored safe pressure, **skip summarization entirely** and stop — the prune alone is the compaction. *(note `:40`)*
7. Otherwise select the summary range (C2).
8. If no safe useful range exists → return `null`, no writes. *(compaction.md:154-155)*
9. Run the region transaction (C5) with numeric bracket owner = the open turn.
10. Re-measure; if pressure is still above threshold, repeat up to `compactionRetries` further times, re-compacting the head checkpoint, subject to "each committed summary must be smaller than what it shadows". ⚠ the detection/refusal mechanism for a non-shrinking summary is not specified. *(note `:70`)*

### C2. Range selection (retention walk)

1. Determine the retained-token budget: `retainTokens` if set, else `retainRatio` × (context window − reserved output tokens). *(config-catalog.md:697-700)*
2. Walk the surface **from the tail toward the head**, accumulating per-node prices from `TokenSurfaceNode.tokens` (route-priced). *(token-meter.md:38-44; note `:58`)*
3. Retain the **smallest tail of whole surface units** whose accumulated estimated size reaches the budget; everything older is the compaction candidate. A **unit** is a complete closed step, or one no-step message. *(note `:58`)*
4. If the token cutoff lands **inside** a step, expand retention until the cut is tool-pairing balanced (checked in **surface order**, not log-sequence order). *(note `:58`)*
5. Auto-compaction always **starts at the surface head**, merging the prior checkpoint so only one automatic checkpoint remains. *(note `:64-66`)*
6. Decline (`null`) if the only compactable content is an un-splittable open tail step (tool-calls with no results yet); retry once that step closes. *(note `:60`)*
7. Out of scope: envelope-only pressure, an oversized indivisible non-tool node (e.g. a pasted `user/message`), and a tool unit whose non-prunable remainder is still oversized. *(note `:62`)*

### C3. Tool-result pruning (before summary selection)

1. Snapshot the **current surface** (a stable snapshot; the pass works on one snapshot). *(compaction.md:236)*
2. For each current `tool/result` node: `measureContent(blocks)` = total Unicode code points across text blocks (non-text blocks cost zero). *(compaction.md:219-224)*
3. If total ≤ `thresholdChars` (8192) → leave it untouched. *(compaction.md:231-232; config-catalog.md:734)*
4. Otherwise `pruneContent(blocks)`: replace the **text middle** while retaining rich-block order, keeping at most `headChars` (4096) leading and `tailChars` (1024) trailing code points. Slicing is by **code point**, not UTF-16 code unit, so a surrogate pair is never split (grapheme clusters may still split). ⚠ the inserted omission marker/ellipsis text is not documented. *(compaction.md:227-233; config-catalog.md:736-739)*
5. Append the `compaction/prune` event (log-only, no `surfaceOp`) carrying `shadowedRange`, `shadowedSeqs`, and `shadowedTokenCount` — the **heuristic** price of the shadowed content, priced through the injected token meter. *(compaction.md:236-247; persistence-catalog.md:376-400; token-meter.md:45-50)*
6. **Synchronously, immediately after** the pricing event, append the replacement `tool/result` node with `surfaceOp: { op:'replace', startSeq, endSeq }` over that single node (`startSeq === endSeq`), preserving all event data except `content` and citing the shadowed node via `sourceEventSeqs`. *(compaction.md:236-247; persistence-catalog.md:386-388; session.md:326-331)*
7. Record a `PrunedEntry { originalSeq, replacementSeq, callId, charsBefore, charsAfter }`; accumulate `charsRemoved`. *(compaction.md:109-133)*
8. `replaceGeneration` advances. If a session rejects a replacement, the throw propagates but "replacements committed earlier in the pass remain durable". *(compaction.md:244-245; session.md:410)*

### C4. Provider-confirmed context overflow — `agent/request-error`

1. The failed model step closes; the durable attempt is committed as `assistant/attempt`. *(llm-streaming.md:300)*
2. `agent/request-error` fires with the original failure before the turn closes; compaction-basic acts when the canonical code is `CONTEXT_WINDOW_EXCEEDED`. *(core.md:330; llm-streaming.md:303; note `:42`)*
3. Increment the per-agent overflow count; if it exceeds `maxOverflowRetries` (default 1; `0` disables recovery) → give up, original error stands. ⚠ reset condition of the count is not specified. *(config-catalog.md:709-710; note `:42`)*
4. Run the prune pass (C3). If pruning advanced `replaceGeneration`, take that as progress.
5. Force **one useful balanced reduction** — overflow "bypasses threshold and retained-tail policy for one maximal balanced head reduction, leaving the newest indivisible unit" and "needs no capacity metadata". *(note `:70`)*
6. Run the region transaction (C5).
7. Return `{ kind: 'retry' }` **only if** `session.surface.replaceGeneration` increased — including pruning-only progress when no summary range existed. Otherwise call `next()` (or return `undefined`) so the original provider failure stays authoritative. Cancellation or disposal wins over a later summary failure. *(note `:42`; compaction.md:101; core.md:330-334)*
8. On retry the loop closes the failed turn, opens a **new numbered** retry turn, and reconstructs its request from the durable log; the retry "prepares its call and reconciles the retained rendered assembly before request derivation, without repeating assembly, pre-step, or user admission". *(note `:42`; agent-lifecycle.md:85)*

### C5. The region transaction (all entry points)

1. Validate the selected positional range and inspect the durable tail. *(manual note `:39`)*
2. Reject a **live unmatched** `compaction/start` (after the newest `session/end-seed`) → `busy`. An unmatched start **before** a newer `session/end-seed` is stale and ignored. *(manual note `:40`, `:66-68`; compaction.md:21)*
3. Append `compaction/start { compactionId, sourceCommandId?, turn }` **synchronously** — the durable lock. *(manual note `:41`, `:56`)*
4. Prepare and `await` summarization (C6).
5. Revalidate the required stability: **whole surface** for automatic/explicit-region work, **selected positional span only** for manual work (present, contiguous, ordered, equally priced, balanced). *(manual note `:42`, `:62`)*
6. Append `compaction/summary` (log-only: raw summary + `rawOutput` + `llmStreamCall: true` when one local call produced it, `shadowedRange`, `shadowedSeqs`, `shadowedTokenCount`, `provider`, `model`, `maxTokens?`, `usage?`) and then the replacement `user/message` (canonical `compact-checkpoint` source, `surfaceOp: { op:'replace', startSeq, endSeq }`, `sourceEventSeqs` covering the shadowed entries **and** the bookkeeping events, `content` = framed summary). *(manual note `:44`; compaction.md:15-16; note `:74-84`)*
7. Make **exactly one** `compaction/end { turn, error? }` attempt. A failed close leaves the unmatched start deliberately blocking and no flush is attempted. *(manual note `:45`, `:74`)*
8. Flush when the manual caller requested durability — a closed manual attempt is flushed **even when it reports an expected failure**, before releasing admission in `finally`. *(manual note `:46`, `:48`, `:74`)*
9. Map an expected failure to `busy | cancelled | changed | summary | commit | persistence`; `changed`/`summary` leave the surface unchanged and persist the failed attempt; `commit` may follow partial mutation; `persistence` means the in-memory bracket closed but the flush failed; cancellation rethrows the exact abort reason. *(compaction.md:99; manual note `:64`)*

### C6. Summarize call

1. Resolve the target: explicit `summarizationProvider`/`summarizationModel` config → the latest logged routed target → agent options. *(note `:36`; config-catalog.md:701-704)*
2. Replay the routed request's prefix and append the compaction directive as a **trailing user message**, so the provider's warm KV cache is reused. ⚠ directive wording not documented in this snapshot. *(note `:36`, `:88-90`)*
3. Call `ctx.llm.stream()` once with `purpose: 'compaction'` and the generation cap (`maxTokens`), forwarding the caller's `signal`. *(note `:36`; llm-streaming.md:635-640; compaction.md:84, :159)*
4. On the DeepSeek adapter, the request carries `x-deepseek-harness-compact: 1`. *(wire-extensions.md:29)*
5. On any failure, dispatch the `compaction/summary-error` waterfall with `{ session, sourceEventSeqs, error, signal }`; a listener that synchronously records a durable input change (e.g. `compaction-image-offload` recording `image/offload` targets) and returns `true` lets the provider **re-derive and re-price the selection before retrying**; listeners that cannot recover call `next()`; decisions survive a later summary failure or cancellation. *(compaction.md:262-278; event-producer-consumer.md:34; compaction.md:99)*
6. Record `provider`, `model`, `maxTokens?`, `usage?`, `rawOutput`, and `llmStreamCall: true` on `compaction/summary`. *(persistence-catalog.md:431-464)*
7. `deriveMessages()` yields `[summary_as_user_message, ...retained_entries]`. *(note `:86`)*

---

## (d) Unknowns / not specified in this snapshot

**Missing files (cited by present docs but absent from the snapshot):**

1. `packages/compaction/**` — all source and READMEs: `compaction`, `compaction-basic`, `compaction-tool-result-pruner`, `compaction-image-offload`, `command-compact`, and `packages/llm/token-meter`. Consequently: no code-level confirmation of any behavior, no line numbers for implementation, and the cited contracts at `packages/compaction/compaction/README.md#tool-pairing-boundaries`, `compaction-basic/README.md` (routed-prefix replay), `compaction-image-offload/README.md` (recovery policy, registration, detached replay), and `compaction-tool-result-pruner/README.md` cannot be read.
2. `.agents/notes/implemented/architecture/**` — the note tree in this snapshot contains *only* `implemented/feature/*`. Absent: `2026-06-18-session-surface.md`, `2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md`, `2026-07-20-routed-model-context-and-compaction-policy.md`, `2026-07-15-replay-token-meter-service.md` (archived), `2026-09-10-image-offload-events.md`, `2026-09-02-system-prompt-as-surface-node.md`, `reconstructability`, `2026-06-13-capability-seams.md`, and `2026-07-08-tool-output-spill-files.md`. Everywhere the present docs say "see the X Agent Note", only the pointer exists.
3. `docs/reference/**` — does not exist in this snapshot.

**Not specified even in the present docs:**

4. **Summary prompt / directive wording and checkpoint framing text.** Docs say only "the compaction directive as a trailing user message" (note `:36`) and "wraps the summary as established checkpoint context and tags it for incremental merging" (note `:88`). No literal text, no token framing, no "incremental merge" algorithm.
5. **Non-shrinking-summary enforcement.** "each committed summary must be smaller than what it shadows" (note `:70`) is stated as policy; where the comparison happens (pre-commit vs. post-commit), what happens on violation, and whether a committed replacement is ever rolled back are unstated.
6. **Prune omission marker.** `pruneContent` returns `ContentBlock[] | null` — the docs never say what text (if any) replaces the dropped middle, nor whether the omitted code-point count is surfaced to the model.
7. **Prune pass ordering/eligibility details.** Docs do not state whether every over-budget tool result is pruned in one pass or only until pressure recovers, whether there is a pass-level cap, or whether non-text (e.g. image) tool-result blocks participate.
8. **Interpretation of `thresholdRatio` "capped at context window minus reserved output and `headroomTokens`".** Whether `headroomTokens` is the routed output reservation or an increment on top of it (the field comments say "beyond the routed output reservation" in one place and the ratio comment lists it alongside the reservation) is not reconciled; nor is the reserved-output value itself named.
9. **`maxTokens` default conflict** — `8192` (note `:70`) vs. "resolved `headroomTokens`" (config-catalog `:705-706`, whose own default is `65536`). Unreconciled.
10. **Exact `modelPolicies` merge semantics.** "partially override the top-level defaults" (note `:70`) — per-field merge vs. per-block replacement, and the failure mode for duplicate `provider`/`model` targets beyond "duplicate targets fail plugin load".
11. **Overflow-counter lifecycle.** `maxOverflowRetries` says "Maximum retries after canonical context overflow"; the per-agent counter's increment points, reset condition (per turn? per session? on a successful step?), and interaction with `llm-retry` (which also listens on `agent/request-error`) are not documented.
12. **`compaction/summary-error` re-entry bound.** The waterfall says the provider "re-derives and re-prices the selection before retrying", but how many retry rounds are permitted and what happens when no listener makes progress (`next()` all the way) are unstated.
13. **`compactNow`'s "useful range".** "select a useful range without writing on a no-op" (compaction.md:168) and "returns `null` when no safe useful range exists" — the definition of *useful* (and whether it differs from the pressure retention walk) is not given.
14. **`ManualCompactionError` class shape.** JSDoc references `{@link ManualCompactionError}` and the error-code union; the thrown type's fields/message text are not documented. UI mapping text is described only as "exact success/failure text" pinned by tests (manual note `:102`).
15. **Flush/durability mechanism.** "durability checkpoint" and "flush" are named (manual note `:46`, `:48`) but the persistence API they target is not shown in these files.
16. **`session/end-seed` parsing cost/return.** "Tail scanning finds the current turn, unmatched compaction start, and newest `session/end-seed` independently" (manual note `:68`) — no bound on the scan.
17. **Conversation/UI projection of checkpoints.** The client request projection's interruption rule is described (manual note `:72`), but how a checkpoint `user/message` renders in the transcript, and how `CompactionCheckpointSource` is consumed client-side, are not documented in the files present.
18. **`SessionReferenceSource.compacted`.** The field exists (`docs/subsystems/session-reference.md:88`) alongside `originalMessages`/`retainedMessages`/`omittedMessages`/`omittedBytes`/`truncated`, but no prose in this snapshot defines what `compacted: true` records or how it relates to context compaction vs. session-reference byte retention.
19. **Spill relation.** `docs/subsystems/spill.md` documents tool-output spill and session-reference retention, *not* compaction; it appears in the search list but contains no compaction hooks (grep for `compact|prun|shadow|pressure` in `spill.md` returns no matches). Any spill↔compaction interaction (e.g. spill locators inside pruned text) is **not documented** and I did not infer one.
20. **Wire-format exposure of compaction events.** `docs/deepseek-llm-api-wire-extensions.md:160` mentions `dsh_session_log` may expose "compaction summaries", but the exact serialization of `compaction/*` in the session-log body extension is not enumerated in the present docs.
21. **Test/diagnostic surface.** The seam note's Testing section (`:130-134`) describes unit, loop, manual, with-key e2e, and snapshot coverage, but names no test file paths and no fixtures that this snapshot contains.

**Explicitly *not* claimed here:** no code was executed, no threshold beyond the table in §7 was located, and no prompt, framing, marker, or message wording was reconstructed — none is quotable from this snapshot.
