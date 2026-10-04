# How DSH handles CONTEXT CACHING (as opposed to compaction)

Research snapshot: `deepseek-harness` **0.2.0-rc.2**, read-only tree at
`C:\Users\zhuzhenyu\.codex\visualizations\2026\09\29\01a0eba8-16ae-7d11-9995-6e7f3aeaceb1\deepseek-research\deepseek-harness`.

All paths below are **relative to that snapshot root**. Cited line numbers come from `read`/`grep` against that tree.

**Critical provenance caveat for every claim in this report.** This snapshot contains `docs/` (full), `.agents/notes/implemented/feature/` (full, but **no** `architecture/`, `archived/`, `proposed/`, `bug-fix/`, or `simplification/` note directories), and only the `packages/subagent/*` and `packages/experimental/*` sources. Sources for `packages/llm/`, `packages/core/`, `packages/session/`, `packages/compaction/` and the `docs/cookbook/` page are **absent**. Therefore:
- every statement about cache *mechanics* below is quoted from `.md`/`.json` docs, package READMEs that exist, or the notes that exist;
- wherever a doc cites a decision note that is not in this snapshot, the citation is dangling and the decision text itself is unavailable (noted inline);
- anything about provider-side breakpoint placement, TTL choice, or adapter code is marked **[INFERENCE]** or **[UNKNOWN]**.

---

## (a) Summary

DSH does not implement a prompt cache; it implements **prefix stability**. The durable session log is the single source of truth for model-visible history (`docs/subsystems/core.md:348`), the agent loop derives each request from that log, and the harness deliberately shapes *what it appends* so that the provider's own prefix/KV cache stays warm. Three mechanisms cooperate: (1) a **request-series** concept carried by `agent/pre-step` (`startsRequestSeries`) and logged on `request/header` (`reason: series|change`, `startsSeries: true`), which marks the boundaries where the cached prefix is knowingly lost and therefore where the harness may re-baseline (fold the system prompt back into node 0); (2) a **system prompt that is a surface node, not a request field**, so a changed prompt can be *appended after* the cached history on routes declaring `systemPromptUpdate: 'in-history'` instead of rewriting message 0 (`docs/subsystems/system-prompt.md:44`, note `2026-09-02-in-history-system-prompt-replacement.md`); and (3) **cache-safe runtime context** (`PromptContext`, runtime-context snapshots logged after retained history — `docs/subsystems/system-prompt.md:76`, `docs/subsystems/approval.md:49`). Provider marker plumbing (`cacheRetention`, `cacheControlFormat`, `supportsLongCacheRetention`, `supportsCacheControlOnTools`) exists only as **pi-ai compatibility switches on a route**, described as capabilities a deployment must state because nothing can infer them (`docs/config-catalog.md:1684-1685,1831-1841`); *where* breakpoints land is pi-ai's business and is **not documented anywhere in this snapshot**. Two adjacent, frequently-confused caches are documented and are **not** prompt caches: the **session-projection cache** (host-side, persisted fold checkpoints of log-derived state, `docs/subsystems/session-projection.md:120`) and the **token-meter** (immutable revisioned replay measurements that feed compaction pressure, `docs/subsystems/token-meter.md:5`). The observable cache signal is `TokenUsage.cacheReadTokens`/`cacheWriteTokens` (`docs/subsystems/llm-streaming.md:336-361`), surfaced in the Web UI as a "cache-hit share"; no OTel/telemetry cache-hit metric is documented.

---

## (b) Mechanism by mechanism

### 1. The "request series" concept

#### 1.1 The declaration surface: `startsRequestSeries`

`agent/pre-step` is the only waterfall before request derivation, and its enter decision may declare a new series:

- `docs/architecture.md:92` — `-> agent/pre-step                   reject | enter(messages, startsRequestSeries?)`
- `docs/subsystems/core.md:322-327` (the type):

  > `/** Start a distinct model-message series before this step's admitted messages. */`
  > `startsRequestSeries?: true`

- `docs/architecture.md:113`:

  > "An enter decision may set `startsRequestSeries`: the loop logs a fresh `request/header` (reason `series`, or `change` with `startsSeries: true` when the envelope also changed). Wrapping listeners preserve that declaration with `{ ...decision, messages }`."

- `docs/agent-lifecycle.md:87`:

  > "The returned `agent/pre-step` decision is authoritative; listeners wrapping `next()` preserve downstream messages and `startsRequestSeries` unless replacement is intentional."

#### 1.2 The logged record: `request/header` with `reason` and `startsSeries`

- Event declaration, `docs/subsystems/session.md:132-141`:

  > "Full header for the next request, appended inside its step before dispatch. It is log-only; the latest snapshot reconstructs the request header."
  > `header: EpochHeader` / `reason: RequestHeaderReason` / `/** This request begins a distinct model-message series, independently of the header reason. */` `startsSeries?: true`

  (identical text in the generated catalog at `docs/persistence-catalog.md:722-737`)

- `RequestHeaderReason` is exactly four values — `docs/persistence-catalog.md:4304-4315`:
  `change`, `initial`, `resume`, `series`.

- The rule, `docs/subsystems/session.md:183` (verbatim):

  > "A full `request/header` snapshot with reason `'initial'` or `'resume'` records each loop-instance boundary; a changed request appends a snapshot with reason `'change'`; and an unchanged envelope beginning an explicitly declared message series or following a surface replacement appends a snapshot with reason `'series'`. An `'initial'`, `'resume'`, or `'change'` snapshot carries `startsSeries: true` when that request also begins a series; reason `'series'` already records that fact. Ordinary append-only later Turns, further Steps, and retries in the same model-message series inherit the latest snapshot. `foldRequestHeader(events)` reconstructs the header by selecting the latest snapshot."

- The `startsSeries` computation (the only place it is stated as a rule), note `2026-09-02-in-history-system-prompt-replacement.md:36`:

  > "`startsSeries` is true when the `agent/pre-step` decision declares `startsRequestSeries`, when the surface replace generation moved since the last request (a compaction or any other replacement), or when the visible tool-schema set changed on a route without `toolUpdate` support. Supported tool additions can accompany a prompt append without starting a series. A provider or model swap alone is not a series start for this rule: on a capable destination route the changed prompt is appended, which costs nothing because the route change already misses the cache."

- Retries do **not** start a series and do not re-derive: `docs/architecture.md:113` — "Retries do not repeat assembly or `agent/pre-step`." and `docs/subsystems/llm-streaming.md:741` — "Every attempt synchronously reconciles the same rendered assembly … appends users only on the first attempt".
- Resume is series-**continuing**, note `2026-09-02-in-history-system-prompt-replacement.md:38`: "Resume is series-continuing — the `resume` header is not a series start — so a prompt that changed across a restart is appended; the provider cache may still be warm across a process boundary." Also `docs/architecture.md:113`: "unchanged resume continues the series".
- Other series starters named in `docs/architecture.md:113`: "Surface replacements and image-offload decisions after attachment start a new request series, including during the first resumed pre-step".

#### 1.3 What the series buys: a stable cached prefix

The series flag is the *only* signal the harness uses to decide whether the cached prefix survived, and therefore whether it may append or must consolidate:

- note `2026-09-02-in-history-system-prompt-replacement.md:29-34` (the decision table):

  | Route capability | Prefix state | Operation |
  |---|---|---|
  | none | non-empty rendering, any prefix state | "log an empty replacement for each non-empty later system node, then rewrite the first system node with the rendering if needed" |
  | `in-history` | "the current request series continues" | "append a new `system/message` before the step's `user/message` events; the append alone needs no `request/header`" |
  | `in-history` | "non-empty rendering, a new series starts" | "log empty replacements for non-empty later system nodes, then rewrite the first system node if needed, even when the latest effective text is unchanged" |
  | any | "the rendered prompt is empty" | "log empty replacements for non-empty later system nodes, then empty the head if needed; no prompt version remains in derived messages" |

- The rationale for re-baselining exactly at a series start, note `:62`: "Re-baselining at a series start costs nothing extra because the cache is already lost there."
- `docs/architecture.md:113`: "The prompt travels only as `system/message` history: an empty rendering clears all active system nodes, leaving no old prompt model-visible; capable routes append non-empty updates after cached history, including supported tool updates".

**[INFERENCE]** `startsSeries`/`startsRequestSeries` name a *logical* epoch boundary. The docs never claim the flag itself is sent to the provider; it is log-only metadata (`docs/subsystems/session.md:183`, "The event is not a `SurfaceEventType`: it produces no LLM message").

---

### 2. Prompt-cache provider integration

#### 2.1 What DSH documents: four pi-ai compatibility switches plus a retention preference

All of these live on `PiAiProviderProfile` / `PiAiCompatProfile` in `@deepseek-ai/dsh-llm-pi-ai` (`docs/config-catalog.md:1598-1619`, source `packages/llm/llm-pi-ai/src/config.ts:222` — file not in snapshot):

- `docs/config-catalog.md:1684-1685`:

  > `/** Prompt-cache retention preference. */`
  > `cacheRetention?: CacheRetention`

- `docs/config-catalog.md:1831-1832`:

  > `/** Prompt-cache marker convention; `openai-completions`. */`
  > `cacheControlFormat?: NonNullable<OpenAICompletionsCompat['cacheControlFormat']>`

- `docs/config-catalog.md:1833-1837`:

  > "Whether the endpoint accepts long prompt-cache retention; `openai-completions`, the three Responses protocols, `anthropic-messages`."
  > `supportsLongCacheRetention?: boolean`

- `docs/config-catalog.md:1840-1841`:

  > `/** Whether the endpoint accepts `cache_control` on tool definitions; `anthropic-messages`. */`
  > `supportsCacheControlOnTools?: boolean`

- Why these exist at all, `docs/config-catalog.md:1764-1769`:

  > "pi-ai decides each of these from the provider id and baseURL when no layer sets it, and a private gateway's URL says nothing: for an endpoint it does not recognize the detection answers as though it were OpenAI itself, which is wrong for most OpenAI-compatible gateways. So every field here is one a deployment must be able to state because nothing can infer it, while the fields pi-ai's catalog sets for a named vendor stay withheld."

- `CacheRetention` and `OpenAICompletionsCompat` are **imported from `@earendil-works/pi-ai`** (`docs/config-catalog.md:1604`, refs list). Their enumerated values are therefore upstream facts and are not reproduced anywhere in this snapshot.

#### 2.2 `cache_control` / ephemeral breakpoints — what the snapshot actually contains

A whole-snapshot grep for `cache_control` returns **exactly two lines**, both the same JSDoc comment in the two language versions:
`docs/config-catalog.md:1840` and `docs/config-catalog.zh.md:1842`.

A grep for `cache point|breakpoint|cachePoint|ephemeral_` finds nothing cache-related (`ephemeral` matches only Codex "ephemeral thread" text in `packages/subagent/subagent-codex/*`).

⇒ **No DSH document in this snapshot states either that DSH emits `cache_control` breakpoints, or where it would place them (system head / last tool / last message).** The only documented fact is that the endpoint's acceptance of `cache_control` *on tool definitions* is a declarable capability. See the UNKNOWN section.

#### 2.3 OpenAI `prompt_cache_key` / `prompt_cache_retention`

The only occurrences in the snapshot are inside a **subagent backend's wire fixture** for the Codex Responses API shape — not a DSH conversation adapter:

- `packages/subagent/subagent-codex/tests/responses-fixture.ts:71-72`:

  > `prompt_cache_key: null,`
  > `prompt_cache_retention: null,`

- the same fixture reports cached input as `packages/subagent/subagent-codex/tests/responses-fixture.ts:86`: `input_tokens_details: { cached_tokens: 0 }`.

Those fields belong to the Codex app-server protocol that `subagent-codex` speaks (see `packages/subagent/subagent-codex/README.md:115`, which lists the `thread/start` fields the provider sends and does **not** include any prompt-cache field). ⇒ **No doc states that DSH's own adapters send `prompt_cache_key`, `prompt_cache_options`, or `prompt_cache_retention`.**

#### 2.4 How the harness decides where the *content* goes relative to a cached prefix

DSH's contribution to prompt caching is content placement, not marker placement. The documented rules:

1. **The system prompt is derived history, not a request field.** `docs/subsystems/session.md:183`:

   > "The rendered system prompt is not part of the header: it is derived history, the `system/message` event at surface node 0 and any later in-history system node … so a prompt change replaces or appends a system node and leaves the header unchanged."

   On the wire, `docs/subsystems/llm-streaming.md:743`:

   > "On the wire, a loop-built request is the derived history alone: the rendered prompt travels as the leading `system`-role message (surface node 0, a `system/message` event) and, when the prepared call declares `systemPromptUpdate: 'in-history'`, a non-empty changed prompt may follow the cached history as a later `system`-role message that the model reads as the effective prompt; the request's `system` field is unset …"

2. **The head is reserved even for an empty prompt.** `docs/architecture.md:113`: "The first admitted step reserves the system head before user messages even for an empty prompt (no wire message)."; note `:27`: "With no surviving system node it reserves the head even for an empty rendering."

3. **Append-only after the cached prefix is the default for capable routes; consolidation only at a series boundary.** Table in §1.3; plus note `:38`: "Reconciliation sees both pre-step compaction (`compaction-basic` with `auto: true`) and recovery compaction, and consolidates non-empty prompt text at the head when either starts a new series."

4. **Tools are part of the cached prefix and get their own capability.** note `:11`:

   > "Tool schemas remain part of the cached prefix; dynamic tool updates can defer additions, while changed retained definitions still invalidate reuse."

   The capability set is `ToolUpdate = 'in-history' | 'addition-only'` (`docs/subsystems/llm-streaming.md:73`, `docs/config-catalog.md:1949`) and its carrier is a `developer`-role message with `tool-addition` / `tool-removal` blocks (`docs/subsystems/llm-streaming.md:29-31,73`):

   > "`ToolAdditionBlock.toolName` activates the definition selected by the containing Session event's historical header reference; `ToolRemovalBlock.toolName` removes the active definition. … `GenerateOptions.toolHistory` carries `ToolHistory`: initial `tools` and ordered `updates`, each binding a developer `messageId` to its historically resolved `additions`. The runtime projects this state into provider declarations; it does not change the active tool list in logged headers."

   and the deferred-loading marker `deferLoading` (`docs/subsystems/llm-streaming.md:674-678`): "Requests deferred loading of the tool definition into model context … Uses Anthropic's `defer_loading` terminology."

5. **Dynamic facts are appended, not folded into the prompt.** `PromptContext` is documented as "the cache-safe counterpart to `PromptSection`. The assembly resolves and orders these contributions, while agent-loop logs their complete current snapshot after retained model history only when it changed or compaction removed it." (`docs/subsystems/system-prompt.md:76`). Concretely for approval/sandbox state, `docs/subsystems/approval.md:49`:

   > "Both policies contribute their complete current meaning to the cache-safe runtime-context snapshot. The sourced `user/message` is the durable model-visible input; changing approval state appends a new full snapshot after retained history without touching the `system/message` nodes that hold the rendered system prompt."

   The architectural motivation is stated bluntly in note `:9`: "Every system prompt change costs the whole provider prefix cache. … the runtime-context snapshot design exists precisely because moving a changing fact out of the prompt was the only way to keep the prefix stable."

6. **Adapter-specific serialization preserves prefixes.** For the DeepSeek Messages adapter, note `2026-09-07-deepseek-messages-adapter.md:23`:

   > "Messages retains the initial top-level system and emits later snapshots as native system turns after the corresponding user/tool-result turn, preserving previously sent prefixes. This placement differs from the loop's system-before-user admission; serialization changes neither the durable log nor conversation-turn order."

   and its rejected alternative, `:37`: "**Always rewrite the top-level system prompt.** This discards the cache-preserving native update path on capable routes."

#### 2.5 Cache-preserving forks and subagents

The subagent packages (present in this snapshot) document a "KV Cache effect" contract for every model-visible surface, as required by `packages/AGENTS.md:27`:

> "Package READMEs document model, token, and KV-cache effects using the [canonical Model Experience format](../docs/cookbook/adding-a-package.md#4-write-the-package-readme)."

(that cookbook page is **not** in this snapshot, so the canonical format itself is unavailable).

- `packages/subagent/subagent-fork-in-process/README.md:122`:

  > "The child may reuse the inherited byte-identical prefix under the same provider and model. Persona, tool-filter, generated-SDK, or route changes may invalidate reuse before inherited history; later child history is append-only. Continuable messaging adds no child-only system-prompt section or tool schema; the parent id and return guidance follow inherited history in the initial user task"

- `packages/subagent/subagent-fork-in-process/README.md:146`: "Both keep the inherited prefix eligible for reuse because parent and child messaging definitions match byte for byte; explicit persona, tool filtering, generated-SDK, or route changes can still break equality."
- `packages/subagent/subagent-fork-in-process/README.md:147`: "**Shipped fork tools do not expose child LLM route selection** — they inherit the parent's provider and model so the copied history remains eligible for KV Cache reuse."
- Append-only parent-side effects: `packages/subagent/tool-subagent/README.md:188` and `:202` — "Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries." (same wording in `subagent-in-process-driver/README.md:143,157`, `subagent-spawn-in-process/README.md:131`, `subagent-acp/README.md:150`, `subagent-dsh-sdk/README.md:163`).
- Independent child prefixes: `subagent-in-process-driver/README.md:109`; `subagent-spawn-in-process/README.md:117`; `subagent-dsh-sdk/README.md:149` ("Independent of the parent request cache. Each SDK child can reuse only prefixes identical under its own provider, model, composition, and history; child steps otherwise grow append-only."); `subagent-acp/README.md:136`; `subagent-claude-code/README.md:151`; `subagent-codex/README.md:149`.
- Structured output can invalidate mid-child: `subagent-in-process-driver/README.md:129` — "Prefix-stable inside the child while the structured-output instruction and schema are unchanged. Changing the schema or capability may invalidate the child's cache from that early segment".
- Team forks: `packages/experimental/tool-agent-team/README.md:136` — "With the same provider/model, shared system policy, and tool schemas, a fork retains the parent request prefix and appends the initial task with its identity prefix. … Sessions recorded with identity inside the system prompt can change that prefix on their first request under this layout; actual provider cache hits remain best-effort."
- The warning is model-visible and tested: `packages/subagent/tool-subagent/tests/model-selection.spec.ts:427-431` asserts the schema description "can prevent provider-side reuse of the inherited conversation prefix".
- Design rationale (note present): `.agents/notes/implemented/feature/2026-08-18-model-selected-subagent-routes.md:25` — "live topology neither expands every parent request nor invalidates its cache prefix"; `:33` — a rejected alternative because "catalog changes would rewrite an early cache-prefix definition"; `:55` — "Adapter catalog and topology changes leave the delegation definition and its prompt-cache prefix unchanged." (`:61` references the absent architecture note `2026-08-10-fork-children-stay-one-shot.md`.)

#### 2.6 Compaction reuses the warm prefix

Note `2026-06-18-compaction-capability-seam.md:36`:

> "It replays the routed request's prefix and appends the compaction directive as a trailing user message so the provider's warm KV cache is reused"

and note `2026-09-02-in-history-system-prompt-replacement.md:54`:

> "`buildSummarizationInput` prepends the derived head to `messages`, followed by every shadowed node's derived message in surface order, so a mid-region system node is replayed in place and the summarization call remains a genuine prefix of the conversation."

---

### 3. Session-projection-cache (host-side; NOT a prompt cache)

This is a *derived read-model* cache in the harness process/DB, keyed to session identity and log position — it never touches a provider request.

- Service row, `docs/capability-seams.md:638`:

  > "Durably checkpoints projection unit states per session (throttled + turn/end/detach mandatory points), serves cached projection views, and accelerates prepared-Session projection hydration."

- Full contract, `docs/subsystems/session-projection.md:120`:

  > "The persisted projection cache service. Opens the `session_projcache` domain at init, checkpoints live sessions on a throttled write-behind (count/interval triggers from Config) plus three mandatory points — session creation, `turn/end`, and session disposal (the live-to-cold moment) — and serves the cached rows for a session header. Every durable write is fail-soft: failures log a warning and the cache self-heals on the next write."

  (the capability-seams wording says "turn/end/detach"; session-projection.md says "session creation, `turn/end`, and session disposal". The wording differs; the count is three either way.)

- The two throttles are explicit deployment choices, `docs/config-catalog.md:2635-2648`:

  > "Both throttle triggers are deployment choices with no universally correct value, so the composition states them explicitly (cordis.yml); the three mandatory write points (session creation, `turn/end`, and session disposal) are policy, not tunables, and always fire."
  > `writeEveryEvents: number` — "Committed events per session that force a durable checkpoint write between mandatory points."
  > `writeIntervalMs: number` — "Longest time (milliseconds) a dirty checkpoint may stay unwritten between mandatory points."

- **What is cached**: per-unit fold state for every registered projection unit, not messages. `docs/subsystems/session-projection.md:61` — "Persisted-cache invalidation version: bump whenever the serialized state fields or the …"; `:20` — "`state` MUST be plain JSON (the persisted-cache precondition)"; `:106` — "… a duplicate key with a different `stateVersion` throws, while same-version registrants share one unit and are counted."
- **Read/write faces** (`docs/subsystems/session-projection.md:257-338`): `cachedSnapshot( session, keys? )` is "Read only already-materialized client-visible cells without folding history. Values may trail the live Session and are therefore hints, not a complete baseline."; `cachedSnapshot( meta, keys? )` (line 142) is "The zero-I/O listing read: whole values viewed straight from the stored rows (version-matching keys only)"; `checkpoint(session)` (line 281) is "the write side of the persisted projection cache"; `viewCheckpoint` (line 312) is "The zero-I/O rung of the read ladder — values are as stale as their rows, never wrong"; `restore` (line 338) is "Cold read: fold every persisted unit over a stored log suffix, seeding each from its checkpoint row when usable".
- The watermark-cache sibling is in-memory and distinct: `docs/subsystems/session-projection.md:106` ("eager `apply` over every registered unit, and per-session per-unit watermark cells. Cells build lazily"), `:248` ("read from the watermark cache (missing cells fold lazily over the in-memory log)").
- **Relationship to session format**: `docs/session-format-status.md:20` — "A package version, codec export name, fixture filename, or projection-cache version is not the writer authority."
- **Disposability**: `docs/subsystems/storage.md:64` — "disposable — the projection cache".
- **Listing uses it as a hint, never as a body read**: `docs/subsystems/persistence.md:323` — "it reads headers plus identity-checked projection-cache hints only".
- **Not** the prompt history cache: `deriveMessages()` is a separate in-memory projection cache, `docs/subsystems/session.md:668` — "cached (each surface node projected once, when first seen; a surface rewrite rebuilds) and frozen", and `:647-649` — "CACHED: pure tail growth costs O(new nodes); a replacement or message projection … rebuilds."

**How it differs from prompt caching** (docs' own framing): this cache is keyed by *session identity + log revision* and holds *host-side folded domain state*; the prompt cache is keyed by *provider-side prefix bytes* and holds *KV/attention state in the provider*. They share only the word "cache". `docs/capability-seams.md:593` states the token-meter analogously as "isolated per-session replay folds".

---

### 4. Token-meter

- Purpose, `docs/subsystems/token-meter.md:5`:

  > "`@deepseek-ai/dsh-token-meter` exposes one detached replay snapshot for request pressure and positional surface pricing. `logRevision` is the number of durable events consumed for every field in the measurement."

  (`logRevision` is typed `SessionLogOffset` with the JSDoc "Number of durable events consumed; equal to the next unread event seq.", `:13-15`).

- Seam classification, `docs/capability-seams.md:593`:

  > "Owns isolated per-session replay folds; pressure consumers share immutable revisioned measurements."

  Consumers listed there and at `docs/capability-seams.md:551`: `compaction-basic`. `docs/subsystems/compaction.md:84`: "The seam owns no pricing API: the singleton `ctx.tokenMeter` directly owns estimation and replay, while `dsh-compaction-basic` owns retention, event sequencing, routed summarization calls, and their configuration."

- Immutability / revisioning, `docs/subsystems/token-meter.md:54`:

  > "Surface order is authoritative; replacement nodes can have higher durable seqs than later positional nodes. The snapshot is immutable and does not grow when the underlying replay fold advances."

- Measurement shape (`:11-26`): `logRevision`, `baseline`, `surfaceDeltaTokens`, `totalTokens`, `surfaceTokens` ("Total route-priced request tokens across the current surface; equals the sum of the node prices."), `nodes: readonly TokenSurfaceNode[]`.
- `baseline.kind`, `:29`:

  > "`baseline.kind === 'usage'` means the latest successful provider call has the same canonical request envelope and its total is no lower than that call's full route-priced anchor. `estimated` means no reusable conservative usage anchor exists, so the service priced the complete envelope and surface itself. A later successful request replaces the earlier anchor; signed `surfaceDeltaTokens` preserves growth and shrinkage relative to a matching anchor, repricing both sides under the same route."

- Node pricing (`:38-50`): `tokens` is "Request-pressure tokens for the exact message projected by this node under the measured route … Trigger, retention, and range selection all read this price."; `heuristicTokens` is "Fixed-heuristic tokens for the same message, independent of any route. The shadow-price protocol prices replacements with this value so the O(1) projection fold stays in agreement with its own appends."
- API (`:66-101`): `measure(session, requestHeader?)` — "Provider usage is reused only when the latest successful call's canonical request envelope matches `requestHeader` and its total is no lower than that call's full route-priced anchor; otherwise the complete envelope and surface are repriced. … Every call clones those positional nodes, so measurement is O(surface)."; and `estimateMessage(message)`.
- No configuration: `docs/config-catalog.md:3446-3458` — `export type TokenMeterConfig = Record<string, never>` (source `packages/llm/token-meter/src/types.ts:13`).
- How it feeds compaction decisions, `docs/subsystems/compaction.md:101`:

  > "Once pressure or canonical overflow qualifies, compaction-basic invokes optional `ctx.toolResultPruner` before range selection, remeasures through `ctx.tokenMeter`, and can advance the surface without a summary."

  and note `2026-06-18-compaction-capability-seam.md:40`: "`dsh-compaction-basic` measures the canonical logged request through `ctx.tokenMeter`, so the next request sees any replacement without a speculative envelope override. Once pressure qualifies, optional `ctx.toolResultPruner` rewriting runs before summary selection; compaction-basic remeasures the durable surface and skips summarization if pruning restores safe pressure."
- Where cache reasoning touches it: `dsh-token-meter` is described as pricing "as the routed request actually sends it" including image pricing (`docs/subsystems/llm-streaming.md:257`), and for prompt accounting it classifies the last surviving system node, note `2026-09-02-in-history-system-prompt-replacement.md:46`:

  > "`dsh-token-meter` prices the last nonempty surviving system node in surface order as `contextBreakdown.systemTokens`; every other visible node, including superseded prompts, contributes to `messageTokens`. Empty dormant nodes are ignored. … `cacheReadTokens` on subsequent assistant usage remains the observable provider-cache effect."

  Note this text mentions `contextBreakdown`/`messageTokens`, which are **not** in the `TokenMeasurement` interface documented at `docs/subsystems/token-meter.md:11-26` — a doc/implementation drift worth flagging (the `contextBreakdown` fields likely live in an internal or later projection; **[INFERENCE]**, unverifiable here).

**[INFERENCE]** DSH's measurement model is *not* cache-aware: `totalTokens` is monotonic request pressure and the anchor is only reused when the "canonical request envelope" matches. Nothing in `token-meter.md` subtracts cached input or uses `cacheReadTokens`; the docs treat `cacheReadTokens` purely as a post-hoc observability signal. Marked as inference because it rests on absence of a statement, not a positive statement.

---

### 5. Stable-prefix invalidation: what breaks the cache, and how DSH orders/normalizes to avoid it

**Documented invalidators**

| Invalidator | Source |
|---|---|
| Any change to rendered prompt bytes ("a plan-mode section entering or leaving, a skill or tool guidance section registering, an agent-scoped persona shadow, a changed `{{model}}` variable") | note `2026-09-02-in-history-system-prompt-replacement.md:9` |
| Changed retained tool definitions; visible tool-schema change on a route without `toolUpdate` starts a new series | note `:11`, `:36` |
| Surface replacement generation moving (compaction, tool-result pruning, image offload) | note `:36`; `docs/architecture.md:113` |
| Provider/model swap — "the cache misses either way" and is explicitly *not* modelled as a series start | note `:36`, `:72` |
| Persona, tool-filter, generated-SDK, or route changes before inherited child history | `packages/subagent/subagent-fork-in-process/README.md:122` |
| Structured-output schema/capability change inside a child | `packages/subagent/subagent-in-process-driver/README.md:129` |
| A deployment whose prompt changes on most steps | note `:80` |
| A proxy rewriting/reordering system messages (silent breakage) | note `:84` |

**Documented preservers / normalizers**

- **Tool order is authoritative and recorded.** `docs/subsystems/llm-streaming.md:739`:

  > "`EpochHeader` records call config, marks the fields supplied by adapter defaults, and records the authoritative returned tool order (configured by `toolOrder`, or lexicographic when unset) through full `request/header` snapshots."

  The knob, `docs/config-catalog.md:3340-3345` (package `@deepseek-ai/dsh-system-prompt`):

  > "Model-facing tool names in order, with `TOOL_ORDER_REST` exactly once. Invalid fields fail at load and unknown names fail at assembly; known names hidden in one scope may be absent there. Omitted means lexicographic order."
  > `toolOrder?: string[]`

  PTC interaction, `docs/config-catalog.md:4017-4025` (package `@deepseek-ai/dsh-tools`): "Under `ptc`, native names in `toolOrder` are invalid."
- **Prompt section and runtime-context ordering is centralized and stable.** `docs/subsystems/system-prompt.md:44`: "Sections sort by ascending order and then code-unit name; repository contributors resolve the service-owned named allocation through `getSectionOrder()`. Runtime-context contributors resolve their independent allocation through `getContextOrder()`."
- **Timestamps/volatile facts are kept out of the prefix.** `PromptContext` exists for exactly this (`docs/subsystems/system-prompt.md:76`); the note at `:80` states the trade-off: "A prompt change on a capable route keeps the provider prefix cache; the appended node costs its own tokens on every request in the series until compaction shadows it. A deployment whose prompt changes on most steps is better served by moving that fact into runtime context."
- **Extension/telemetry data is placed outside the model-visible prefix.** `docs/deepseek-llm-api-wire-extensions.md:7`:

  > "The adapter sends the additions to its resolved `baseURL`, including a configured gateway. They remain outside `messages`, system prompts, and tool schemas, so they do not add model-input tokens or alter the model-visible prefix."

  and `:160`: "A gateway selected through `baseURL` receives the same values as the official endpoint."
- **Identity headers do not alter cache identity.** note `2026-08-11-deepseek-request-user-id-header.md:11`: "The user id is transport metadata, not model input. It must not enter the request body, prompt, token accounting, KV-cache identity, or session log."; `:44`: "The identity headers do not alter the request body, prompt, token count, KV-cache identity, or session log".
- **Orphaned-attempt output never enters history**, so a failed attempt cannot pollute the prefix: `docs/subsystems/llm-streaming.md:300` ("the agent loop commits the attempt stream as `assistant/attempt`, closes the failed step"); `docs/subsystems/session.md:671` ("An **empty-content** `assistant/message` is also skipped"); `docs/subsystems/session.md:675` ("Everything else … is structural and does not project into a message").
- **The epoch/header boundary is explicitly unsettled.** `docs/subsystems/llm-streaming.md:745`:

  > "FIXME(call-config-shape): revisit which remaining fields are genuinely epoch-level for cache purposes (`model` and the model-owned reasoning effort are explicit; the sampling scalars sit here out of caution)."

- **Compaction preserves the prefix for its own summarization call** (see §2.6).
- **`request/context` deliberately stays out of `EpochHeader` so a route change does not register as an envelope change** — `docs/subsystems/session.md:210`: "It stays outside `EpochHeader` because that type is the reconstruction contract compared field-wise by `headerEquals`: capacity and the update mode describe a route, not a request input, so folding them in would let a route change register as a request-envelope `change` and would pull adapter metadata into the loop's reconstruction invariant."

---

### 6. Config knobs, metrics, and telemetry

**Provider-cache knobs** (all on `@deepseek-ai/dsh-llm-pi-ai`): `cacheRetention` (`docs/config-catalog.md:1685`) sits on `PiAiProviderProfile` — **route-level only**; `PiAiModelProfile` (`:1713-1749`) and `PiAiModelOverride` (`:1758`) do *not* carry it. The three compat switches are settable on the route and overridable per model, `docs/config-catalog.md:1647-1654`: "pi-ai wire-compatibility switches defaulting every model on this route whose protocol declares them; each model's own `compat` overrides per field" — namely `cacheControlFormat` (`:1832`), `supportsLongCacheRetention` (`:1837`), `supportsCacheControlOnTools` (`:1841`). The replay/test route can also declare `systemPromptUpdate` and `toolUpdate` (`docs/config-catalog.md:1946-1949`), which are the cache-behaviour switches that a keyless scenario can exercise.

**Token accounting fields (the observable cache signal)**, `docs/subsystems/llm-streaming.md:336`:

> "Per-call token accounting. Counts are **disjoint**: `inputTokens` is uncached input only; cached input is reported separately, and billed input is the sum of the three. Adapters whose providers fold cache hits into a single prompt total (DeepSeek's `prompt_tokens`) subtract them back out."

and the type at `:347-361` / `docs/persistence-catalog.md:4856-4869`: `inputTokens`, `outputTokens`, `totalTokens?`, `cacheReadTokens?`, `cacheWriteTokens?`, `reasoningTokens?`.

- It travels with the message: `docs/subsystems/session.md:77-95` — "`assistant/message` … Carries the step's `usage` when the adapter reported token accounting, so the model output and its accounting travel together (there is no separate usage record)." Failed attempts keep usage without fabricating history (`docs/subsystems/session.md:675`).
- Compaction summaries also carry usage: `docs/subsystems/compaction.md:16` — `'compaction/summary'` includes `usage?`.
- Pruned content keeps a heuristic price: `docs/persistence-catalog.md:395` — "Heuristic price of the shadowed content under the token-meter's fixed estimator."

**UI-level cache metrics** (client packages not in this snapshot; documented in a note that is):
`.agents/notes/implemented/feature/2026-09-07-composer-session-stats-pills.md:15` — shared helpers `deriveStats`, `formatDuration`, **`cacheHitPercent`**, **`billedInputTokens`** absorbed into `StatsPills`; `:17` — the database pill "shows the compact billed total plus cache-hit share and click-opens the Token 用量 dialog (cache hit, uncached input, cache read, output, and cache write when non-zero — exact counts)"; `:19` — "token figures ride `tokenUsage` only, so an absent projection drops the usage pill rather than showing window-derived billing. Cache writes stay in the billed total and the cache-hit denominator" (citing the absent architecture note `2026-07-29-projected-token-usage-and-request-context.md`); `:27` — the per-turn panel has "required session input, cache-read, and output rows plus a non-zero cache-write row". Presentation preference: `.agents/notes/implemented/feature/2026-09-16-performance-usage-preference.md:15` ("Compact retains only available output speed and cache-hit percentage under the composer") and `:29` ("Unavailable speed or cache-hit data is omitted rather than replaced with invented values").

**Telemetry**: greps for `cache` across `docs/subsystems/otel.md`, `docs/subsystems/session-telemetry.md`, and `docs/subsystems/product-telemetry.md` return **nothing**. ⇒ No documented OTel metric, span attribute, or product-analytics event for cache hit rate exists in this snapshot. The only cache-derived observable is the durable per-call `TokenUsage` described above.

**Indirect knobs (they decide *when the cache is thrown away* by compaction)**: `docs/config-catalog.md:692-711` — `thresholdRatio` (0.8), `headroomTokens` (65536), `retainRatio` (0.16), `retainTokens`, `summarizationProvider`/`summarizationModel`, `maxTokens`, `compactionRetries` (1), `maxOverflowRetries` (1), plus `auto` (default `true`, `:687-688`). Projection-cache knobs: `writeEveryEvents`, `writeIntervalMs` (`docs/config-catalog.md:2643-2648`).

---

## (c) What the docs do NOT specify / unknown

Grouped by how confident the negative is (grep-verified absence vs. merely unstated).

**Grep-verified absences in this snapshot**

1. **`cache_control` breakpoint placement.** `cache_control` occurs exactly twice (both the same JSDoc line: `docs/config-catalog.md:1840`, `docs/config-catalog.zh.md:1842`) and never in a code file. No doc says DSH emits `cache_control` markers, how many, on which block, or with which TTL. There is **no** occurrence of Anthropic's `ephemeral` cache-marker vocabulary anywhere in the snapshot. The harness's *own* contribution to caching is content placement (§2.4), not marker emission.
2. **`CacheRetention` values and defaults.** The type is imported from `@earendil-works/pi-ai` (`docs/config-catalog.md:1604`) and is not expanded. Whether it means `'short' | 'long'`, hours, or a boolean is **unknown** here. The only adjacent statement is the capability `supportsLongCacheRetention` ("Whether the endpoint accepts long prompt-cache retention", `:1834-1835`). Likewise `cacheControlFormat`'s values ("Prompt-cache marker convention", `:1831`) are **unknown**.
3. **`prompt_cache_key` / `prompt_cache_options` / `prompt_cache_retention`.** Only in the Codex subagent wire fixture (`packages/subagent/subagent-codex/tests/responses-fixture.ts:71-72`). No doc states DSH's conversation adapters send any of them; no `prompt_cache_options` string exists anywhere in the snapshot at all.
4. **Prompt-cache hit-rate telemetry.** No OTel/session-telemetry/product-telemetry field, metric name, or event for cache hits, and no `prompt_cache_hit_tokens`-style field. Only the durable `TokenUsage.cacheReadTokens`/`cacheWriteTokens` and client-side derived percentages (`cacheHitPercent`) exist.
5. **Which request fields are epoch-level for caching.** Explicitly open: `docs/subsystems/llm-streaming.md:745` (`FIXME(call-config-shape)`).
6. **Implementation of any of the above.** `packages/llm/**`, `packages/core/**`, `packages/session/**`, `packages/compaction/**` are absent from the snapshot, so `SystemPromptProjection.project(...)` (`packages/core/agent-loop/src/runtime-context.ts`, cited in note `:27`), `EpochHeader`/`headerEquals`, the pi-ai compat plumbing, and the DeepSeek adapter's serialization cannot be verified against code. Only the `packages/subagent/**` and `packages/experimental/**` trees and their tests are inspectable.
7. **Dangling decision notes.** Docs cite many notes that are not in this snapshot, e.g. `.agents/notes/implemented/architecture/2026-09-02-system-prompt-as-surface-node.md` (cited at `docs/subsystems/system-prompt.md:44`, `docs/architecture.md:113`), `2026-07-05-reconstructable-requests.md` (`docs/subsystems/llm-streaming.md:739`), `2026-08-10-fork-children-stay-one-shot.md` (`packages/subagent/subagent-fork-in-process/README.md:122`), `2026-09-20-dynamic-tool-updates.md`, `2026-07-29-projected-token-usage-and-request-context.md`, `2026-07-30-current-sandbox-policy-context.md`. The note directories present are only `.agents/notes/implemented/feature/`. Every rationale they own is therefore **unavailable**, and the package README's *decision rule* pointer (`packages/core/agent-loop/README.md#understand-the-implementation`) is also an absent file.
8. **The canonical "KV Cache effect" README format.** Mandated by `packages/AGENTS.md:27` but defined in `docs/cookbook/adding-a-package.md`, which is absent.

**Stated but partial**

9. **How the cached prefix is actually keyed/segmented by providers.** The docs speak of "the whole provider prefix cache" (note `:9`), "the DeepSeek context cache" (`:9`), "the provider's warm KV cache" (note `2026-06-18:36`), and "provider cache hits remain best-effort" (`packages/experimental/tool-agent-team/README.md:136`), but never define minimum cacheable prefix, block granularity, or TTL semantics. `supportsLongCacheRetention` is the only duration-adjacent knob and its semantics are upstream.
10. **Whether `request/header` snapshots or `request/context` records are ever consulted by an adapter for cache control.** The docs are explicit that both are log-only and produce no LLM message (`docs/subsystems/session.md:183`, `:210`); `docs/subsystems/session.md:210` further states "Prompt admission uses the bound prepared call's capability, not this snapshot from an earlier request" (mirrored at `docs/subsystems/session.md:145-146`). So the recorded header's cache role is reconstructability and *change detection*, not request emission. **[INFERENCE]** no adapter reads the logged header to place cache markers — nothing states one does.
11. **Token-meter and caching.** `token-meter.md` has no cache-token input, no cache-aware anchor rule, and no field for cache hits; the prompt-related token split referenced by note `:46` (`contextBreakdown.systemTokens` / `messageTokens`) does not appear in the documented `TokenMeasurement` interface. Whether the meter deliberately excludes cache tokens (`[INFERENCE]` it does — its `totalTokens` is full request pressure) is not stated.
12. **Docs drift on the projection cache's mandatory points**: "creation, turn/end, disposal" (`docs/subsystems/session-projection.md:120`, `docs/config-catalog.md:2639-2641`) vs. "turn/end/detach" (`docs/capability-seams.md:638`). Both are three points; whether "detach" and "disposal" are the same event is not stated.
13. **In-history prompt accounting cost**: the note quantifies the *conceptual* cost ("the appended node costs its own tokens on every request in the series until compaction shadows it", `:80`) but no doc gives a measurement protocol or a hit-rate target for cache effectiveness. The only assertion-level evidence is a gated real-API e2e described at note `:97`: "`packages/llm/llm-deepseek/tests/adapter.e2e.ts` … asserts that the appended request reads more cached tokens than the same conversation with a rewritten leading prompt; it skips when the variable is unset."
