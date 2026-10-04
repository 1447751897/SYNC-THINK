# SYNC-THINK — Inventory: (A) context/prompt caching, (B) context compression/compaction

Research date: 2026-10-02. Read-only static analysis (no build/test/git available in this environment).
Method: scoped `glob`/`grep` (`include: *.ts`) over `packages/**/src` and `apps/*/src` plus test dirs; every claim below carries file path + line numbers.
Repo layout note: `apps/cli` and `apps/mcp-server` have no `src/` at the expected path; repo-wide `.ts` greps produced **zero** hits for compaction/prompt-cache in `apps/website`, `apps/cloud`, `apps/cli`, `apps/mcp-server`. All relevant code lives in `packages/adapters`, `packages/core`, `packages/shared`, `packages/protocol`, `packages/storage`, `apps/runtime`, `apps/desktop`.

---

## 0. Executive summary

| Area | Verdict |
|---|---|
| Prompt caching | **Implemented and tested at the adapter layer** (OpenAI `prompt_cache_key`/`prompt_cache_options`, Anthropic explicit `cache_control` breakpoints, cache-token usage parsing). Cache **key construction is split across two inconsistent schemes** and lives in the runtime, not the adapters. |
| Cache key stability | Stable across turns within one thread **but the key does not change when compaction rewrites the prefix**; the orchestration path instead re-keys per `context_epoch`. |
| Model-context compaction | **Fully implemented end-to-end, including a real LLM summarization call.** Not "only typed". |
| Summarization call metering | The compaction LLM call's token usage is **silently discarded**; `ProviderUsagePurpose = 'compaction'` is **declared but never produced anywhere**. |
| History handling | **Append-only log + projection.** No destructive rewrite of stored conversation history; the model-visible list is derived per turn and filtered by a `compactedAt` timestamp. |
| Token accounting | Char/byte ÷ 4 estimates for the context ring; provider-reported usage for billing. **No revisioned/immutable measurement type.** |
| `database-compaction.ts` | **SQLite file compaction (incremental-vacuum / offline-compaction) — explicitly NOT model-context compaction.** Out of scope below except this sentence. |

---

# PART A — Prompt / context caching

## A1. Adapter boundary type (typed + implemented by adapters)

- `packages/adapters/src/types.ts:47-53` — `ProviderCallRequest.promptCache?: { key?: string; retention?: 'in_memory' | '24h'; strategy?: 'automatic' | 'explicit' }`.
  Comment states the contract: *"Provider-managed prompt cache identity. The application keeps the prompt prefix stable; cache bytes remain provider-side."*
- `packages/adapters/src/types.ts:127-139` — `ProviderUsage` carries `cachedTokensHit` (L132) and `cachedTokensCreated` (L134).
- `packages/adapters/src/types.ts:16-55` — the single request shape every adapter consumes.
- Lifecycle/state: **none in adapters.** `promptCache` is a per-call value; adapters are stateless translators.

## A2. OpenAI chat + responses: cache key/options emission

- `packages/adapters/src/openai/prompt-cache.ts:1-44` (whole file, 44 lines — this is the entire OpenAI cache policy):
  - `usesOpenAIModernPromptCaching` (L7-15): true only when `promptCache.key` is non-empty **and** the model matches `^gpt-(\d+)(?:\.(\d+))?` with major > 5 or (major 5 and minor ≥ 6).
  - `supportsOpenAIExtendedPromptCacheRetention` (L17-23): allowlist regex for `gpt-5.5/5.4/5.2/5.1`, `gpt-5-codex`, base `gpt-5` (excluding mini/nano/chat), `gpt-4.1` (excluding mini/nano).
  - `openAIPromptCacheBodyFields` (L25-44):
    - no key → `{}` (L27);
    - non-`gpt-*` model → `{}` — deliberate relay safety: *"third-party relays (glm/grok/qwen etc.) reject it with 400 Unsupported parameter(s)"* (L28-31);
    - modern → `{ prompt_cache_key, prompt_cache_options: { mode: 'implicit', ttl: '30m' } }` (L32-37) — note `retention` is **ignored** on this branch;
    - legacy → `{ prompt_cache_key, ...(retention && supported ? { prompt_cache_retention } : {}) }` (L38-43).
- Call sites: `packages/adapters/src/openai/stream-chat.ts:16` (import) → `:406` (spread into body); `packages/adapters/src/openai/stream-responses.ts:19` (import) → `:1049` (spread into body).
- Responses path emits **no explicit breakpoints**: `stream-responses.test.ts:382` asserts `JSON.stringify(body.input)` does not contain `prompt_cache_breakpoint`. There is no `prompt_cache_breakpoint` producer anywhere in the repo.
- Graceful degrade: `packages/adapters/src/openai/gateway-degrade.ts:17-23` and `:26-34` list `prompt_cache_key`, `prompt_cache_options`, `prompt_cache_retention` as droppable; `stream-chat.ts:447,476-481` performs a single degraded retry when a relay returns 400 "Unsupported parameter(s)". `extractUnsupportedParameterNames` at `gateway-degrade.ts:9-14`.

## A3. Anthropic: explicit cache breakpoints (the only adapter that emits breakpoints)

`packages/adapters/src/anthropic/stream-messages.ts`:
- `:184-203` — after building messages, if `promptCache.key` is set, the **last two messages excluding the final (changing) user turn** get `cache_control: { type: 'ephemeral' }` (string content is rewritten into a text-block array at L190-198; array content gets the marker on its last block at L200-201). Comment L186-188 states the 4-breakpoint budget reasoning.
- `:319-329` — the `system` field becomes `[{ type:'text', text, cache_control:{type:'ephemeral'} }]` only when a cache key is present.
- `:338-341` — the **last tool schema** gets `cache_control` when a key is present.
- `:480-490` — usage mapping: `cache_read_input_tokens` → `cachedTokensHit`, `cache_creation_input_tokens` → `cachedTokensCreated`, and `tokensIn = ordinaryInputTokens + cachedTokensHit + cachedTokensCreated` (L482) so `tokensIn` stays a true input total.
- `strategy: 'explicit' | 'automatic'` from the type is **not read by this adapter** — presence of `key` alone gates all breakpoints. (`grep` for `strategy` consumers: none outside tests/type.)

## A4. OpenAI usage parsing

- `packages/adapters/src/openai/stream-chat.ts:60-69` — `prompt_tokens_details.cached_tokens` → `cachedTokensHit`, `prompt_tokens_details.cache_write_tokens` → `cachedTokensCreated`.
- `packages/adapters/src/openai/stream-responses.ts:633-642` — `input_tokens_details.cached_tokens` / `.cache_write_tokens`, same mapping.

## A5. Gateway adapters: breakpoints are dropped, cache *tokens* pass through

`packages/adapters/src/gateway/` (protocol-translation gateways):
- `wire-types.ts:26` declares `cache_control?: unknown` on Anthropic text blocks, but the conversion paths **do not carry it**:
  - `openai-to-anthropic.ts:49-58` (`openAIContentToBlocks`) pushes `{ type:'text', text }` only — no `cache_control`.
  - `anthropic-to-openai.ts:95-96` likewise collects only the text.
  - `anthropic-to-openai.test.ts:29-41` proves the flattening: `flattenAnthropicSystem` given blocks with `cache_control` returns plain `'a\n\nb'`.
  → **A gateway-routed request loses all explicit cache breakpoints.**
- `wire-types.ts:139-140` declares `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` on the OpenAI usage wire type; **no code reads them** (repo-wide grep: declaration only). Typed-only.
- Cache *token counts* do survive translation: `anthropic-to-openai.ts:274-278` (`prompt_tokens_details.cached_tokens` → `cache_read_input_tokens`) and `:337-346`; `chat-stream-to-responses.ts:56-77` maps `cached_tokens` → `input_tokens_details.cached_tokens` and `reasoning_tokens`.
- The gateway **never sets a cache key** — it only forwards/translates bodies.

## A6. Where the cache key is actually constructed (2 incompatible schemes)

**Scheme 1 — interactive chat / conversations** (`apps/runtime/src/demo-run.ts:764-770`, inside `createDemoProviderRequest` L749-792):
```ts
const promptCache = run.providerId
  ? { key: `sync-think:${run.providerId}:${run.modelId}:${run.threadId}`,
      retention: '24h' as const, strategy: 'automatic' as const }
  : undefined;
```
- Callers: `apps/runtime/src/runtime.ts:32709` (fake provider) and `:32726` (`adapter.call(createDemoProviderRequest(...))`) inside `openProviderStream` (L32522).
- Key = provider + model + **thread**. **Stable across every turn of a thread**, and **unchanged by compaction** even though compaction rewrites the message prefix.
- Nothing in the key covers the system prompt, tool schemas, skill bodies, or the actual prefix bytes.

**Scheme 2 — orchestration production steps** (`apps/runtime/src/orchestration/production-step-executor.ts:315-327`):
```ts
const contextEpoch = options.agentContextStore && context.agentContextThreadId
  ? options.agentContextStore.getOrCreateEpoch({ agentContextThreadId, providerId, modelId, contextWindow }) : undefined;
const promptCacheKey = context.agentContextThreadId && contextEpoch
  ? `${model.providerId}:${modelId}:${context.agentContextThreadId}:${contextEpoch.id}` : undefined;
```
then attached at `:525-533` as `{ key, retention: '24h', strategy: 'automatic' }`.
- Different prefix format, different scoping (adds **epoch id**), no `sync-think:` namespace. The two schemes can never share a cache entry.
- Epoch lifecycle (`packages/storage/src/agent-context-store.ts`): `getOrCreateEpoch` L90-103 returns the existing *active* epoch only if `providerId`, `modelId`, `reasoningEffort` and `contextWindow` all match; otherwise it closes the current epoch (`UPDATE ... status='active' → 'closed'`) and inserts a new one with `parent_epoch_id` (L96-99). One active epoch per thread is enforced by a partial unique index (`packages/storage/src/schema/agent-context.ts:41`, and `packages/storage/src/scripts/migrate.ts:995`).
- Epochs are created by the scheduler thread + step executor only: `apps/runtime/src/orchestration/scheduler.ts:752` (`getOrCreateThread`) and `production-step-executor.ts:317`. **No chat-path caller.**

**Consequence:** a model/effort/window change in the orchestration path correctly invalidates the cache key (new epoch), while the same change in the chat path changes the key only if provider/model changed — and compaction invalidates the *prefix* without changing the key in both paths.

---

# PART B — Context compression / compaction

## B1. Native model-context compaction — fully implemented, LLM-backed

### B1.1 Protocol contract
- `packages/protocol/src/commands.ts:4243-4279` — `ConversationCompactPayload` (`mode: 'manual'|'auto'`, legacy `contextWindow`/`usedTokens` hints, `keepRecent`, `onlyIfNeeded`) and `ConversationCompactResponse` (`compacted`, `beforeTokens`, `afterTokens`, `foldedCount`, `durationMs`, `summaryText`, `messageId`). Doc comment L4243-4248 states: *"Primary path: model-generated structured summary of older turns. Local truncate summary is only a degraded fallback."*
- `packages/protocol/src/commands.ts:3838-3860` — `ConversationGetContextStatusResponse` with `estimatedUsedTokens`, `usageRatio`, `compactThreshold: 0.7` (literal), `compactedAt?`, `sections`.
- `packages/protocol/src/conversation-context-status.ts:25-134` — strict Zod response schema; invariants enforced in `superRefine`: section token total **must equal** `estimatedUsedTokens` (L117-124) and `usageRatio` must equal `estimatedUsedTokens / contextWindow` (L126-133); all six section types exactly once (L108-115).
- `packages/protocol/src/commands.ts:3274-3334` — `PeekContextPacketPayload` / `PeekContextTruncationItem` (`sourceId`, `reason`, `beforeTokens`, `afterTokens` at L3298-3303) / `PeekContextPacketResponse` (`truncations` L3329).
- Desktop plumbing: `apps/desktop/src/team-payloads.ts:1089-1102` validates `onlyIfNeeded`; `apps/desktop/src/main/conversation-write-handlers.ts:132` routes `conversation.compact`; `apps/desktop/src/main/runtime-client.ts:210` sets a dedicated request timeout.

### B1.2 Runtime orchestrator (the whole lifecycle)
`apps/runtime/src/runtime.ts:10688-11069` — `handleConversationCompact`. Doc comment `:10679-10687` states the 4-step design. Ordered behaviour:

| Step | Lines | Behaviour |
|---|---|---|
| Resolve conversation → task → thread | 10706-10735 | no `taskId` → `compacted:false` no-op response (10710-10729) |
| Load events + context snapshot | 10736-10748 | `beforeTokens = snapshot.status.estimatedUsedTokens` (10750); `fixedContextTokens = beforeTokens − messages-section tokens` (10751-10753) |
| Threshold gate | 10756-10797 | `onlyIfNeeded` (auto always) + below 0.7 → emits **`context.compaction_skipped`** with `reason: 'below-threshold'` and returns |
| Split | 10799-10841 | `splitHistoryForCompact(history.messages, keepRecent)`; nothing to fold → `context.compaction_skipped`, `reason: 'insufficient-history'` |
| Start marker | 10850-10869 | emits **`context.compaction_started`** (`beforeTokens`, `foldedCount`, `keepRecent`, `startedAt`) |
| Local fallback computed first | 10871-10875 | `buildLocalCompactSummary(...)` |
| **Model summary** | 10877-10893 | `await this.generateModelCompactSummary(...)`; wrap + require `isMeaningfulCompactReduction(beforeTokens, fixed + estimateCompactAfterTokens(...))`; sets `summarySource:'model'` |
| Fallback selection | 10894-10899 | `summarySource:'local'`, `afterTokens = fixedContextTokens + local.afterTokens` |
| Reduction gate | 10901-10945 | empty summary OR not a real reduction → `context.compaction_skipped`, `reason: 'no-reduction'` |
| Durable write (unit of work) | 10947-11020 | `context.compacted` event (payload: `threadId, conversationId, mode, summaryText, summarySource, beforeTokens, afterTokens, foldedCount, keepRecent, operationId, durationMs, messageId`) **plus** a visible system marker `message.appended` with `compact:true, tone:'info'` and a task-version bump; then `compactBoundaryCache.record(...)` (11014), snapshot invalidation (11018), publish both events |
| Failure path | 11042-11068 | if started and not settled → emits **`context.compaction_failed`** with capped `error` (500 chars), then writes a protocol error |

### B1.3 The summarization LLM call — `generateModelCompactSummary`
`apps/runtime/src/runtime.ts:11091-11153`:
- Guards: `canStartModelRun()` (11097) and non-empty older messages (11098).
- `prepareRunBinding({ runId, threadId, userText: '[compact]', modelId, skillVersionIds: [], reasoningEffort: 'off' })` (11105-11114) — `reasoningEffort:'off'` is an explicit opt-out for cost (comment 11111-11113). Failure → `undefined` (fallback to local).
- Prompt: `buildCompactSummaryUserPrompt(olderMessages)` (11119).
- 90 s abort timer (11121-11122).
- `openProviderStream(prepared.run, { messages:[{role:'user',content:userPrompt}], toolsEnabled:false, networkEnabled:false, signal, systemPromptOverride: COMPACT_SUMMARY_SYSTEM_PROMPT })` (11124-11130) — **tools and network explicitly disabled**.
- Consumes **only** `text-delta` / `error` / `finished` (11134-11143). **`usage` adapter events are ignored** → the summarizer's token cost is never recorded (see Q2/Q4).
- Rejects responses shorter than 40 chars (11146) → falls back to local compaction.

### B1.4 Prompts and helpers (`apps/runtime/src/chat-tools.ts`)
- Constants: `MAX_HISTORY_MESSAGES = 40` (L2471), `COMPACT_KEEP_RECENT_MESSAGES = 8` (L2475), `COMPACT_AUTO_THRESHOLD = 0.7` (L2481, comment cites NewMax `PREVENTIVE_COMPACT_WINDOW_RATIO=0.7`), `COMPACT_CHARS_PER_TOKEN = 4` (L2483), `COMPACT_TOOL_OUTPUT_FOLD_CHARS = 2_000` (L2488), `COMPACT_TOOL_OUTPUT_KEEP_RECENT = 2` (L2490), `COMPACT_MIN_REDUCTION_RATIO = 0.9` (L2601), `COMPACT_MODEL_SUMMARY_MAX_CHARS = 12_000` (L2775).
- `COMPACT_SUMMARY_SYSTEM_PROMPT` (L2498-2503) — "Respond with TEXT ONLY. Do NOT call any tools."
- `COMPACT_SUMMARY_USER_PROMPT_PREFIX` (L2505-2525) — 9-section Claude-Code-style summary template (Primary Request, Key Technical Concepts, Files and Code, Errors and fixes, Problem Solving, All user messages, Pending Tasks, Work Completed, Context for Continuing Work).
- `COMPACT_RESUME_INSTRUCTION` (L2528-2529).
- `collectThreadChatHistory` (L2603-2694): sorts events, finds the **latest `context.compacted`** for the thread (L2612-2621), pushes its `summaryText` as a leading `system` message (L2624-2630), then appends only events *after* that sequence (L2636); skips compact UI markers via `payload.compact === true` (L2643); also folds `run.completed` assistant text (L2656-2668); returns `shouldAutoCompact` from `usedTokens/contextWindow ≥ 0.7` or `messages.length > 40` (L2683-2686).
- `isMeaningfulCompactReduction` (L2697-2705): `afterTokens ≤ beforeTokens × 0.9`; refuses zero/negative inputs.
- `splitHistoryForCompact` (L2711-2737) — older (to summarize) vs newest `keepRecent` verbatim.
- `formatTranscriptForCompactSummary` (L2740-2758) — caps assistant turns at 4 000 chars, others at 3 000; collapses nested compact boundaries to `System: [previous compact summary omitted]`.
- `buildCompactSummaryUserPrompt` (L2763-2768).
- `wrapModelCompactSummary` (L2777-2792) — prefixes `[context compact]` + resume instruction, caps at 12 000 chars.
- `buildLocalCompactSummary` (L2798-2854) — degraded local path; per-message 220/280-char truncation; returns **empty `summaryText`** when the reduction test fails (L2837-2845) so callers must not write a boundary.
- `estimateCompactAfterTokens` (L2857-2862).

### B1.5 Auto-trigger (client-driven only)
- Threshold constant: `apps/runtime/src/context-snapshot.ts:4` (`CONTEXT_COMPACT_THRESHOLD = 0.7`), surfaced as `shouldAutoCompact` at L253.
- Desktop: `apps/desktop/src/renderer/shell/use-conversation-compaction.ts:209-218` — `runAutoCompact(kernelId, status)` returns early unless `kernelId === 'native'` **and** `status.usageRatio >= status.compactThreshold`; `run('auto')` at L110-207 sends `onlyIfNeeded: mode === 'auto'` (L132).
- It also consumes the four lifecycle events for progress UI (L229-232, L258-297).
- **No server-side auto-compaction was found**: `onlyIfNeeded` is read only at `runtime.ts:10756`; the runtime never self-invokes `handleConversationCompact`. If the renderer does not call it, occupancy grows.
- External (non-native) kernels are explicitly excluded from host compaction (`use-conversation-compaction.ts:214`).

### B1.6 Kernel-driven compaction (external kernels)
- Types: `packages/shared/src/types/kernel.ts:280-298` — `context-occupancy` (`usedTokens`, `windowTokens`, `categories`; comment L281-284: *"the host must not invent it"*), `compaction-started` (L292), `compaction-failed` (L293), `compacted` (L295).
- Producers: `apps/runtime/src/kernel/codex-app-server-adapter.ts:1045` (occupancy), `:1053-1057` (`thread/compacted` → `compacted`), `:1121` (`compaction-started`), `:1158` (`compacted`); `apps/runtime/src/kernel/claude-sdk-adapter.ts:182-200` (occupancy), `:720` (`compacted`).
- Host projection: `apps/runtime/src/runtime.ts:22211-22217` (switch on the three event kinds) → `kernel.context_compaction_started` / `kernel.context_compacted` (`:25177`, filtered at `:34363`). Deliberately **not** `context.compacted` — see comment at `:25138` and the assertion in `tests/external-kernel-run.test.ts:1209`. The host therefore keeps kernel compaction and native compaction as separate event namespaces.

### B1.7 Preventive tool-output folding (the "pruner")
- `foldToolOutputText` (`chat-tools.ts:2868-2890`) — head 55% / tail remainder with an explicit `[… tool output folded: omitted N chars; full output was M chars …]` marker.
- `foldLongToolOutputsInMessages` (`chat-tools.ts:2902-2952`) — folds all `role:'tool'` messages except the newest `keepRecent` (default 2); `preserveBoundedSourcePages` (L2918-2936) protects up to 100 000 chars of *contiguous, non-redundant* immutable source pages (validated by `sourceSha256` + `startOffset`/`endOffset` + ≤50 000 chars, merging overlapping ranges).
- Applied live each tool round: `runtime.ts:21775` (`foldLongToolOutputsInMessages(chatMessages, { preserveBoundedSourcePages: true })`) and per result at `:21753` (`browser_workflow_execute` gets a dedicated projection; `collaboration_read_context` / `web_fetch` are exempt from folding).
- **Recoverability:** the *unfolded* result is persisted. `runtime.ts:27661-27687` writes `tool.completed` with `result: persistedResult`; very large payloads are additionally projected to a `DeferredContent` reference (`deferred-content-projection.ts:348-381`, `payload.resultRef ??= result.deferred`, with `result` replaced by a bounded preview at L380). Full bytes live in the conversation content store (`packages/storage/src/conversation-content-store.ts:169,229`; type at `packages/shared/src/deferred-content.ts:9`). Folding is therefore a **model-view projection, not data loss**.

## B2. Context Packet budget selection (orchestration path — accounting-level truncation)

`packages/core/src/context-packet.ts`:
- `PROTECTED_SOURCE_KINDS` (L44-49): `task-goal`, `acceptance-criteria`, `decision`, `constraint` — "never silently remove these under overflow".
- `selectContextSources` (L535-590): protected sources are always included (L538, L541); compressible sources are included while they fit (L548-554); when remaining budget is positive and the kind is in `allowSoftTruncateKinds`, the source is **included with a rewritten `tokenEstimate = remaining`** and a truncation record `reason: 'token-budget-protect-core'` (L557-571); otherwise excluded (L573). Returns `overflow`, `protectedPreserved`, `tokenEstimate` (L576-589).
  - **Important:** soft truncation only rewrites the *token estimate metadata* — it does not shorten any content. The actual provider payload is whatever the caller assembled.
- `resolveAllowedSkillSources` (L273-359): real content truncation — `bodyForTokens = body.slice(0, bodyMax)` with default 2 400 / max 12 000 chars (L278, L308) and a truncation record `reason: 'skill-body-limit'` (L341-348).
- `resolveProjectMemorySources` (L165-222), `resolveAllowedMcpToolSources` (L410-495, schema cap 800/4 000 chars, L415/458), `resolveCrossTaskRefs` (L83-118).
- `applyUserContextAmendments` (L624-695): user force-excludes are refused for protected kinds and reported in `refusedProtectedIds` (L636-651).
- `buildContextPacket` (L704-744): builds `ContextPacket` (with `proofHash` = truncated sha256 over packetId/modelId/agentVersionId/included ids/excluded ids, L522-524, L720-726) and `ContextManifest` (truncations L735).
- Type shapes: `packages/shared/src/types/context.ts:6-57` (`ContextPacket.compressedSectionIds` L16; `ContextManifest.truncations` L51; `ContextSourceRef.kind` union L25-41).
- Observation surface: `apps/runtime/src/runtime.ts:11847-11878` (`handlePeekContextPacket`) → `PeekContextPacketResponse`.

## B3. Token estimation / the "token meter" that feeds compaction decisions

`apps/runtime/src/context-snapshot.ts`:
- `estimateTextTokens` (L81-84): `max(1, ceil(Buffer.byteLength(text,'utf8') / 4))` — byte-based, so CJK is ~3× more tokens than the char/4 heuristic used elsewhere.
- `estimateJsonTokens` (L86-88); `estimateProviderMessageTokens` (L90-106) — `+1` per message, `1024` flat per image part, JSON estimate for non-text parts.
- `selectRecentMessagesWithinBudget` (L108-127): walks backwards keeping messages until the budget is exceeded; the first over-budget message is still included when it is alone (L119-122).
- `ContextSnapshotBuilder.build` (L171-259): assembles `systemPrompt` from `system`/`agent`/`project`/`compact summary` sections (L173-181 — **the compact summary is injected here as the `summary` section**, L176-178); enforces an invariant that every `included` source is actually present in the provider payload, else `ContextSnapshotInvariantError` (L72-79, L194-201); computes the six sections (L203-213), `estimatedUsedTokens` (L214), `usageRatio`, `compactThreshold`, `shouldAutoCompact` (L250-253).
- Call sites: `runtime.ts:32498` (snapshot build) and `:9651` (must mirror `openProviderStream`); status RPC path at `:9622`, `:9710-9732`.

**Budget gate that silently drops history:** `runtime.ts:26992-26995` — `buildChatProviderMessages` returns `selectRecentMessagesWithinBudget(built.messages, floor(window × 0.82))`. This drop is **not** recorded anywhere (no event, no manifest truncation entry). A second silent stop exists in `listDurableContextMessages` (`runtime.ts:26906-26934`): paging stops at `roughTokens >= contextWindow × 1.25` (L26929), using a `JSON.stringify(blocks).length / 4` estimate (L26922-26925), or as soon as a page crosses the compaction boundary (L26926-26928).

---

# Explicit answers

## Q1 — Does SYNC-THINK rewrite/truncate conversation history for the model, or use an append-only log + replacement/projection?

**Append-only log + projection (replacement). No destructive rewrite exists.**

Evidence:
1. **Nothing deletes conversation rows.** Repo-scoped grep for `DELETE FROM message` / `deleteMessages` / `pruneMessages` in `packages/storage/src` returns only `fts.ts:20` (a full-text-index trigger), never a conversation-history delete.
2. **Compaction is an event, not a mutation.** `runtime.ts:10947-11020` appends `context.compacted` (carrying `summaryText`) plus a visible `message.appended` marker. Pre-compaction `Message` rows remain intact.
3. **The model-visible list is derived per turn** — the actual code path:

```
runtime.ts:20586 / :11124  openProviderStream(...)
  └─ runtime.ts:32522        openProviderStream
       ├─ :32680-32684       requestExtras (systemPrompt, tools, toolChoice, hostedTools, maxOutputTokens)
       └─ :32726             adapter.call(createDemoProviderRequest(run, apiKey, signal, requestExtras))
                              └─ demo-run.ts:749-792 createDemoProviderRequest   ← provider request factory
```
and the message list fed into it is built (for chat) by:
```
runtime.ts:26936-26996  buildChatProviderMessages(run)
  ├─ :26939             compact = this.compactBoundaryCache.get(run.threadId)
  ├─ :26949             this.listDurableContextMessages(threadId, window, compact)      // durable Message rows
  ├─ :26950-26959       buildProviderMessagesFromDurableMessages({ messages, compact, ... })
  │                       └─ apps/runtime/src/context-message-history.ts:161-225
  │                            L164-171  filter: keep only messages with createdAt > compactedAt
  │                            L175       drop UI compact notices (^上下文已(?:自动)?压缩)
  │                            L176-197   assistant commentary/final_answer split, cancelled-run repair
  │                            L204-205   delegated-run context unshifted as a system message
  │                            L206-217   append/replace the current user turn
  │                            L219-224   return { messages, compactSummary, compactedAt }
  ├─ :26965-26988       prepend persisted task plan as a system message
  ├─ :26990-26991       run.compactSummary / run.compactedAt set on run state
  └─ :26992-26995       selectRecentMessagesWithinBudget(messages, window × 0.82)   // final silent gate
```
4. **The `summary` section is materialised in the prompt**: `compactSummary` is passed into `ContextSnapshotBuilder` and becomes `## Compact summary` in the rebuilt `systemPrompt` (`context-snapshot.ts:176-181`) — the "replacement" half of the design.
5. There is a **legacy/alternate** projection, `buildChatMessagesFromEvents` (`chat-tools.ts:2958-2997`), which reads the *event* log, prepends the last compact summary via `collectThreadChatHistory`, and hard-slices to `MAX_HISTORY_MESSAGES = 40` (L2993-2995). Repo-wide grep shows it is referenced **only by `chat-tools.test.ts`** — it is not on the live path. It is the only place a raw 40-message slice still applies.

Net: history is never rewritten on disk; the model sees `[latest compact summary as a system block] + [messages newer than compactedAt] + [current user turn]`, further windowed by the 0.82 budget gate. **Content older than the boundary survives in the log but is unreachable to the model except through the summary text.**

## Q2 — Is there any summarization call (an LLM call whose purpose is 'compaction' or 'summary')? Where invoked? Wired end-to-end?

**Yes — a real, end-to-end LLM summarization call exists.**

- Invocation site: `runtime.ts:10877-10882` inside `handleConversationCompact`, calling `generateModelCompactSummary` (`runtime.ts:11091-11153`).
- Transport: `openProviderStream` with `toolsEnabled:false`, `networkEnabled:false`, `systemPromptOverride: COMPACT_SUMMARY_SYSTEM_PROMPT`, 90 s abort, `reasoningEffort:'off'` (L11114, L11124-11130).
- Prompt construction: `buildCompactSummaryUserPrompt` (`chat-tools.ts:2763-2768`) → 9-section template.
- Result handling: `wrapModelCompactSummary` (`chat-tools.ts:2777-2792`) → `context.compacted` payload `summaryText` with `summarySource:'model'` (or `'local'` on fallback).
- Wired through protocol (`commands.ts:4243-4279`), host RPC (`apps/desktop/src/main/conversation-write-handlers.ts:132`), renderer trigger (`use-conversation-compaction.ts`), and lifecycle events observed by the UI.
- Fallback chain is explicit: model summary → local truncation summary (`buildLocalCompactSummary`, empty ⇒ skip) → `context.compaction_skipped`.

**Caveats (typed-only / broken wiring):**
- `ProviderUsagePurpose` includes `'compaction' | 'summary' | 'delegation'` (`packages/shared/src/types/usage.ts:3-4`), but **no code ever produces them**: the only purpose producers are `production-step-executor.ts:2379-2383` (`'review' | 'revision' | 'normal'`), `runtime.ts:2171` and `demo-run.ts:885` (`'normal'`). So the compaction call is **not tagged as `'compaction'`**.
- Worse, the compaction call's **usage is not recorded at all**: `generateModelCompactSummary` consumes only `text-delta`/`error`/`finished` (L11134-11143) and discards `{type:'usage'}` events. `provider.usage` events are only emitted from the scheduler's `onProviderUsage` (`runtime.ts:2568-2580`), which the chat/compaction path never reaches. The summarization cost is therefore invisible in `usage-summary-cache.ts` (`cachedTokensHit`/`cachedTokensCreated` fields exist at L28-29, L49-50, L102-103 but will never see it).
- Kernel-side: external kernels compact themselves and the host only mirrors the lifecycle events (`shared/types/kernel.ts:291-295`); the host never issues a summary request for them.

## Q3 — Prompt-cache: which adapters emit breakpoints/keys, what decides the key, is it stable across turns?

| Adapter | Emits | Evidence |
|---|---|---|
| `openai-chat` | `prompt_cache_key` + (`prompt_cache_options{mode:'implicit',ttl:'30m'}` \| `prompt_cache_retention`) | `stream-chat.ts:406` ← `prompt-cache.ts:25-44` |
| `openai-responses` | same body fields, **no breakpoints** | `stream-responses.ts:1049`; `stream-responses.test.ts:382` |
| `anthropic-messages` | 3 explicit `cache_control:{type:'ephemeral'}` breakpoints: system block, last tool, last two non-final messages | `stream-messages.ts:184-203`, `:319-329`, `:338-341` |
| `openai-images` | none | n/a |
| `gateway/*` | **none**; drops incoming `cache_control` | `openai-to-anthropic.ts:49-58`; `anthropic-to-openai.test.ts:29-41` |

**What decides the key:** the *caller* — the adapters only consume `request.promptCache.key`:
- chat: `sync-think:${providerId}:${modelId}:${threadId}` (`demo-run.ts:766`) — no epoch, no prefix hash, no system-prompt/tool-schema component.
- orchestration: `${providerId}:${modelId}:${agentContextThreadId}:${contextEpoch.id}` (`production-step-executor.ts:326`).

**Stability:** within a thread, scheme 1 is byte-stable across turns (all three components are fixed for the thread's lifetime), and `retention:'24h'` + `strategy:'automatic'` are constants. Scheme 2 changes whenever an epoch rolls (provider/model/`reasoningEffort`/`contextWindow` change — `agent-context-store.ts:93`). Neither key changes when compaction rewrites the prefix, so after a compaction the provider sees the same key with a different prefix: implicit-cache prefix matching will miss at the new boundary but the key itself does not misattribute. There is **no test asserting key stability across turns**, and no prefix/content fingerprint in either scheme.

## Q4 — Token accounting: how is used-token count estimated/stored, and is there a revisioned/immutable measurement type?

**Estimation (two different, inconsistent heuristics):**
- Context ring / compaction decisions: `context-snapshot.ts:81-84` — `ceil(utf8ByteLength / 4)` (+1/message, +1024/image). `estimatedUsedTokens` = sum of six sections (L214). This is what `conversation.compact` uses for `beforeTokens` (`runtime.ts:10750`).
- Compaction helpers: `chat-tools.ts:2577-2584` — `ceil(text.length / 4)` (UTF-16 *chars*, contradicting the constant's comment "~4 chars per token") used for `beforeTokens`/`afterTokens` inside `buildLocalCompactSummary` and `estimateCompactAfterTokens`.
- Durable paging budget: `runtime.ts:26922-26925` — `ceil(JSON.stringify(blocks).length / 4)`.
- Protocol pins the ring's arithmetic: `conversation-context-status.ts:117-133` requires `Σ sections.tokens === estimatedUsedTokens` and `usageRatio === estimatedUsedTokens / contextWindow`.

**Real provider usage (billing, separate from the ring):**
- Adapter → `ProviderUsage` (`adapters/types.ts:127-139`) incl. `cachedTokensHit` / `cachedTokensCreated` / `reasoningTokens`.
- Orchestration: `production-step-executor.ts:596-618` builds `ProviderRequestUsage[]`; scheduler forwards via `onProviderUsage` (`scheduler.ts:72,788`) → runtime appends a durable **`provider.usage` event** (`runtime.ts:2568-2580`).
- Storage/projection: `packages/storage/src/production-execution-store.ts:538-560` normalizes/validates `providerUsages` (purpose allow-list at `:553`); `apps/runtime/src/usage-summary-cache.ts` (v3 cache, L17) reads `provider.usage` / run-terminal / tool facts (`:188`, `:327`) into usage rows carrying `contextEpochId` (L41, L98, L246, L533) and cached-token fields.
- Chat/goal path: `runtime.ts:17503-17532` `addGoalUsage` accumulates `tokensIn`/`tokensOut` into `GoalStatus`, guarded by a **revision** check (`goalExecutionState.revisionForRun`, L17527; `addGoalUsage` requires `goalRevision(goal) === revision`, L17510); driven from `:20884` and `:25256` (`usage.input ?? usage.real`).

**Revisioned/immutable measurement type: NO.**
- There is **no** `TokenMeasurement` / revisioned measurement record (grep for `TokenMeasurement|tokenMeasurement|measuredAt|approximateTokens` yields only the estimator helpers listed above).
- `estimatedUsedTokens` is a **derived per-request projection**, recomputed every time from `ContextSnapshotBuilder` (`context-snapshot.ts:214`), and deliberately excluded from the cached public status (`kernelId` is an internal cache discriminator, `context-snapshot.ts:16-17`).
- The only revision-like mechanisms are (a) the `context_epoch` id used as a cache-key component, (b) `GoalStatus` revision-guarded token accumulation, and (c) `USAGE_SUMMARY_CACHE_VERSION` (`usage-summary-cache.ts:17`, invalidated at `:811`). Usage **events** are immutable once appended, but the *measurement of current context occupancy* is not versioned, not content-addressed, and not comparable across turns except by re-derivation.
- Compaction correctness depends on this derived number: `beforeTokens`/`afterTokens` in `context.compacted` are estimates, so "we freed 12% of the window" is an estimate-of-an-estimate.

## Q5 — Existing tests

| Test file | What it asserts |
|---|---|
| `packages/adapters/src/openai/stream-chat.test.ts` | L176-188: modern GPT + key ⇒ `prompt_cache_key` + `prompt_cache_options{mode:'implicit',ttl:'30m'}`, no `prompt_cache_retention`, and `messages` must not contain `prompt_cache_breakpoint`; L204-213: explicit/legacy model ⇒ key only, no options/retention; L229-238: retention-capable model ⇒ `prompt_cache_retention:'24h'`; L761-762: cached-token usage mapping; **L856-894: 400 "Unsupported parameter(s): `prompt_cache_key`" ⇒ drop and retry once, second body has no key**; L934-953: non-`gpt-*` relay gets no `prompt_cache_*` fields; L981-989: gateway error surfaces the rejected parameter names. |
| `packages/adapters/src/openai/stream-responses.test.ts` | L95-96: `cachedTokensHit:11` / `cachedTokensCreated:3` parsed; L330-341: key passed through verbatim (`openai:gpt-5-mini:thread-123:epoch-456`), no retention; L364-377: modern options emitted; L382: no `prompt_cache_breakpoint` in `input`. |
| `packages/adapters/src/anthropic/stream-messages.test.ts` | L135-144: with `promptCache.key` + `strategy:'explicit'`, `cache_control` appears in `system`, `tools` **and** `messages`; L175-176 & L368-369: `cache_read_input_tokens` / `cache_creation_input_tokens` mapped into usage. |
| `packages/adapters/src/gateway/anthropic-to-openai.test.ts` | L29-41: `flattenAnthropicSystem` drops `cache_control`. |
| `packages/shared/src/types/usage.test.ts` | L10-29: `splitProviderUsageTokens` buckets cache read/write out of `tokensIn` (mutually exclusive billing buckets). |
| `apps/runtime/src/context-snapshot.test.ts` | L80-97: six sections exactly once, `estimatedUsedTokens === Σ sections`, `usageRatio` derivation, `ContextSnapshotInvariantError` on a missing included source (L99-127), MCP/login-fence invariant (L129-158); L239-246: `selectRecentMessagesWithinBudget` keeps the newest messages within budget. |
| `apps/runtime/src/chat-tools.test.ts` | L42-136: `buildChatMessagesFromEvents` history assembly incl. images; **L101-136: latest `context.compacted` boundary is honoured — provider history becomes `['system'(summary), 'user']`**; L139-238: `buildLocalCompactSummary` folds 8 of 12 turns and shrinks tokens (L147-155), auto-compact threshold (L157-176), real `usedTokens` preferred over the transcript estimate (L178-198), **non-shrinking summaries rejected (`summaryText === ''`) instead of clamping the display** (L200-213), compact markers excluded from history (L215-238); L240-251: split older/kept; L253-262: prompt contains the 9-section headings and "Respond with TEXT ONLY"; L264-276: wrapper + resume instruction; L278-294 & L1735-1755: tool-output folding and bounded-source-page preservation. |
| `apps/runtime/src/conversation-compact-boundary-cache.test.ts` | L22-37: latest valid boundary wins by sequence, blank summaries skipped, wrong event type ignored; L39-47: another thread's boundary ignored; L49-56: restored boundary is cached (single `loadEvents` call); L58-70: `record` short-circuits loading and copies defensively. |
| `apps/runtime/src/conversation-context-snapshot-cache.test.ts` | Cache shape incl. `estimatedUsedTokens` (L14). |
| `apps/runtime/tests/conversation-get-context-status.test.ts` | L956-996: **forged high renderer hints are ignored** — Runtime snapshot truth wins, `context.compaction_skipped` with `reason:'below-threshold'`; L998-1058: **forged low hints ignored**, compaction proceeds at the real 70% truth, `beforeTokens` equals the snapshot, `afterTokens < beforeTokens`, and the durable lifecycle is exactly `['context.compaction_started','context.compacted']` with matching payloads; L730/916-918/940: protocol arithmetic invariants (`usageRatio`, `Σ sections`); L460: section token total via `estimateProviderMessageTokens`. |
| `packages/protocol/src/conversation-get-context-status.test.ts` | Schema accept/reject matrix: `estimatedUsedTokens` bounds (L150-151), section-total mismatch (L158), plus valid fixtures. |
| `packages/core/src/context-packet.test.ts` | `buildContextPacket` proof hash + manifest (L15-38); protected kinds never dropped even when over budget and when they alone exceed it (L48, L72, L91); **truncation metadata recorded for compressible sources when the budget shrinks them** (L104); user amendments force-exclude non-protected and refuse protected (L322-367); skill body truncation feeding selection (L389-535); MCP tool-schema compressibility (L561-654). |
| `packages/storage/src/agent-context-store.test.ts` | L20-29: thread idempotency by `(task, agentVersion, workstreamKey)`; **epoch reuse when provider/model/effort/window match, and a new epoch (with the old one closed) when the provider/model changes**; `getActiveEpoch` returns the newest. |
| `packages/storage/src/database-compaction.test.ts` (+ `scripts/database-governance.test.ts`) | SQLite compaction governance only — **not** model-context compaction. |
| `apps/runtime/tests/external-kernel-run.test.ts` | L1135-1209: kernel `compaction-started`/`compacted` project to `kernel.context_compaction_started` / `kernel.context_compacted`, produce `statusType:'compaction'` timeline rows, and must **not** emit native `context.compacted`; L1245: kernel `context-occupancy`; duplicated usage events are deduped (L1141-1168). |
| `apps/runtime/src/kernel/codex-app-server-adapter.test.ts` | L551-563: one `compaction-started` + one `compacted`; L582: occupancy. |
| `apps/runtime/src/kernel/claude-sdk-adapter.test.ts` | L1142: `compacted`; L1179/L1205: `context-occupancy`. |
| `apps/runtime/src/deferred-content-projection.test.ts` | L352-384: long text/thinking survive **payload-size** "compatibility compaction" with canonical recoverable refs (not model-context compaction). |
| `apps/runtime/tests/assistant-timeline-blocks.test.ts`, `apps/desktop/src/renderer/shell/process-activity.test.ts` | `statusType:'compaction'` timeline/activity rendering. |
| `apps/runtime/tests/design-html-contract.test.ts` | Exercises `ContextSnapshotBuilder` through the runtime (L6, L25-77). |

**Coverage gaps in tests:** no test asserts the *cache key is stable across turns*; no test asserts what happens to the cache key after compaction; no test asserts the summarizer's usage is recorded; no end-to-end test asserts that a `'compaction'`-purpose usage row appears; no test covers the 0.82× silent drop in `runtime.ts:26992-26995` (only the standalone helper at `context-snapshot.test.ts:239-246`).

---

# Missing compared to a "surface-replacement + token-meter + pruner + log-only-lock" design

Each gap is stated as observable behaviour.

1. **No LLM summarization path for the orchestration/Context-Packet track.** Summarization exists only for interactive conversations (`runtime.ts:11088`). Orchestration steps prune by excluding/shrinking sources in `selectContextSources` — an agent step that exhausts its window has no summarizer to fall back on.
2. **Truncation of windowed history is silent and irrecoverable from the model's view.** `selectRecentMessagesWithinBudget(messages, window × 0.82)` (`runtime.ts:26992`) and `listDurableContextMessages`' `1.25 × window` paging stop (`runtime.ts:26929`) drop older messages with **no event, no `truncations` record, and no UI signal**. Contrast with the packet path, which does emit `PeekContextTruncationItem`s.
3. **The compaction LLM call is unmetered.** `generateModelCompactSummary` discards the adapter `usage` event (`runtime.ts:11134-11143`), so compaction spend never appears in `provider.usage`, `usage-summary-cache`, or goal counters — the cost of freeing context is invisible.
4. **`ProviderUsagePurpose: 'compaction' | 'summary' | 'delegation'` are declared but unreachable.** No producer exists (`production-step-executor.ts:2379-2383` is the only purpose factory and returns `normal|review|revision`). No per-purpose spend breakdown for compaction/summarization is possible today.
5. **No revisioned/immutable token measurement.** Occupancy is a derived, recomputed estimate (`context-snapshot.ts:214`), not a versioned measurement with provenance. Two code paths disagree on the heuristic (`byteLength/4` vs `String.length/4`), so `beforeTokens`/`afterTokens` recorded in `context.compacted` are not comparable to the ring's numbers for CJK-heavy threads.
6. **No content-addressed / prefix-hashed cache key, and two mutually exclusive key schemes.** `sync-think:${providerId}:${modelId}:${threadId}` (chat) vs `${providerId}:${modelId}:${threadId}:${epochId}` (orchestration) can never share a cache entry; neither covers the system prompt or tool schemas, so a skill/instruction change silently reuses a key over a different prefix.
7. **The cache key does not invalidate on compaction.** After `context.compacted` the prefix is rewritten but the key is byte-identical; there is no key rotation or prefix-fingerprint check, so the first post-compaction turn pays an implicit-cache miss with no observable signal.
8. **The gateway path loses all cache breakpoints.** A request routed through `packages/adapters/src/gateway` has its `cache_control` markers flattened away (`anthropic-to-openai.test.ts:29-41`) and never gains a `prompt_cache_key`; the declared `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` (`wire-types.ts:139-140`) are read by nothing.
9. **`strategy: 'automatic' | 'explicit'` is inert.** Only key *presence* is consulted (`stream-messages.ts:184`, `prompt-cache.ts:8`), so callers cannot actually request "explicit breakpoints only" or "implicit only" and be honoured.
10. **Auto-compaction depends on the renderer being alive.** Only `use-conversation-compaction.ts:209-218` triggers `mode:'auto'`; the runtime checks `onlyIfNeeded` but never self-triggers (`runtime.ts:10756`). A headless/CLI/MCP-driven session grows to the window and hits the silent 0.82 drop instead.
11. **Auto-compaction is disabled for non-native kernels** (`use-conversation-compaction.ts:214` returns unless `kernelId === 'native'`); external kernels that do not emit their own compaction have no host-side safety net.
12. **No log-only lock on the model-visible view.** Pre-compaction `Message` rows stay in the log (correct), but nothing pins *which* durable rows the current model view is derived from: a boundary is located by wall-clock `Date.parse(message.createdAt) > Date.parse(compactedAt)` (`context-message-history.ts:164-171`), so clock skew, equal-millisecond timestamps, or backfilled messages (`message-store-backfill.ts:131`) can silently include or drop turns with no integrity check — unlike the packet path, which has a `proofHash` (`context-packet.ts:720-726`).
13. **Compaction is not surfaced as a measurable, reversible artifact set.** `context.compacted` stores the summary text but no source-range manifest (which message ids were folded, their token totals) and no reconstruction path; the only trace is `foldedCount` plus `beforeTokens`/`afterTokens` estimates. A "what exactly did we lose" query is not answerable from storage alone.
14. **No test or guard for concurrent compaction.** `handleConversationCompact` has no per-thread lock (the renderer holds a client-side `isCompacting` flag only, `use-conversation-compaction.ts:105-108`); two concurrent `conversation.compact` frames can both pass the threshold gate and both write a `context.compacted` boundary.
15. **Preventive folding does not protect semantic structure.** `foldToolOutputText` is head/tail only (55%/rest, `chat-tools.ts:2877-2889`), preserving only byte-bounded "immutable source pages" (`:2918-2936`); a pruner that keeps reasoning-relevant spans (e.g. errors, diffs) does not exist.

---

## Appendix — disambiguation (things that look like the topic but are not)

- `packages/storage/src/database-compaction.ts` (1 100+ lines) + `database-governance.ts` CLI + `database-compaction.test.ts`: **SQLite file/database compaction** (`incremental-vacuum`, `offline-compaction`), governed by manifests/audits/confirmation tokens. Explicitly **not** model-context compaction. Excluded from all findings above.
- `apps/runtime/src/deferred-content-projection.ts` and the test named "...through message compatibility compaction" (`deferred-content-projection.test.ts:352`): payload-size projection that replaces long text with **recoverable** `DeferredContent` refs (`packages/shared/src/deferred-content.ts:9`, `apps/runtime/src/deferred-content-projection.ts:348-381`). Not model-context compaction — and it is the repo's existing building block for *lossless* pruning.
- `apps/runtime/src/delegation-event.ts:21` "run-state delta compaction": event-delta deduplication, unrelated to model context.
- `packages/storage/src/database-governance.ts:409` `summarizeCategories`, `capability-store.ts:522` `summarizeUsage`, `chat-tools.ts:2189` `summarizeToolCallForApproval`: name collisions only.
