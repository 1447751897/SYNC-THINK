import { createHash } from 'node:crypto';
import type {
  AgentVersionId,
  ContextManifest,
  ContextPacket,
  ContextSourceRef,
  ModelId,
  SkillVersionId,
  TaskId,
  RunId,
  StepId,
  CredentialRefId,
} from '@sync-think/shared';

export interface BuildContextPacketInput {
  packetId: string;
  taskId: TaskId;
  agentVersionId: AgentVersionId;
  modelId: ModelId;
  createdAt: string;
  runId?: RunId;
  stepId?: StepId;
  credentialRefId?: CredentialRefId;
  /** Sources the runtime chose to include (app-owned facts only). */
  included: ContextSourceRef[];
  /** Sources considered but left out (for Manifest transparency). */
  excluded?: ContextSourceRef[];
  compressedSectionIds?: string[];
  crossTaskRefs?: string[];
  skillVersionIds?: SkillVersionId[];
  policyVersion?: number;
  /** Optional short summaries shown in Manifest. */
  summaries?: { sourceId: string; summary: string }[];
  truncations?: ContextManifest['truncations'];
  evidenceRefsForMemory?: string[];
}

export interface BuiltContext {
  packet: ContextPacket;
  manifest: ContextManifest;
}

/** Design §20.9 — never silently remove these under overflow. */
export const PROTECTED_SOURCE_KINDS: ReadonlySet<ContextSourceRef['kind']> = new Set([
  'application-context',
  'agent-instructions',
  'task-goal',
  'task-status',
  'acceptance-criteria',
  'decision',
  'constraint',
  'latest-user-message',
]);

/** Parent task snapshot used only for explicit cross-task references (§10.1). */
export interface CrossTaskParentSnapshot {
  id: string;
  title: string;
  goal: string;
  status?: string;
  acceptanceCriteria?: readonly string[];
}

export interface ResolveCrossTaskRefsInput {
  taskId: string;
  /** Explicit parent edge only — never implicit siblings or project-wide scrape. */
  parentTaskId?: string;
  /** Resolved parent record; when missing, no ref is invented. */
  parent?: CrossTaskParentSnapshot;
  /** Soft token estimate for the cross-task source (default from goal length). */
  tokenEstimate?: number;
}

export interface ResolveCrossTaskRefsResult {
  /** Parent task ids that were explicitly linked into this packet. */
  crossTaskRefs: string[];
  /** Source refs of kind cross-task-ref for selection / Manifest. */
  sources: ContextSourceRef[];
  summaries: Array<{ sourceId: string; summary: string }>;
}

/**
 * Build explicit cross-task references for a Context Packet (design §10.1 / §10.2).
 * Cross-task content is included only through an explicit parent edge — never
 * by scanning the workspace or sibling tasks.
 */
export function resolveCrossTaskRefs(
  input: ResolveCrossTaskRefsInput,
): ResolveCrossTaskRefsResult {
  const parentId = input.parentTaskId?.trim();
  if (!parentId || !input.parent || input.parent.id !== parentId) {
    return { crossTaskRefs: [], sources: [], summaries: [] };
  }

  const parent = input.parent;
  const sourceId = `cross-task:${parent.id}`;
  const goal = (parent.goal || "").trim();
  const title = (parent.title || "").trim() || parent.id;
  const accept =
    parent.acceptanceCriteria && parent.acceptanceCriteria.length > 0
      ? parent.acceptanceCriteria.slice(0, 3).join(" · ")
      : "";
  const summaryParts = [`父任务 · ${title}`];
  if (goal) summaryParts.push(goal.slice(0, 96));
  if (accept) summaryParts.push(accept.slice(0, 64));
  const summary = summaryParts.join(" — ").slice(0, 160);
  const tokenEstimate =
    input.tokenEstimate ??
    Math.max(16, Math.ceil((title.length + goal.length + accept.length) / 4) + 8);

  return {
    crossTaskRefs: [parent.id],
    sources: [
      {
        id: sourceId,
        kind: "cross-task-ref",
        tokenEstimate,
      },
    ],
    summaries: [{ sourceId, summary }],
  };
}


export type ProjectMemoryScope = 'task' | 'project' | 'global';

/** Active durable memory row snapshot for packet assembly (design §10.1 layer 2). */
export interface ProjectMemoryEntrySnapshot {
  id: string;
  key: string;
  value: string;
  scope: ProjectMemoryScope;
  taskId?: string;
}

export interface ResolveProjectMemorySourcesInput {
  entries: readonly ProjectMemoryEntrySnapshot[];
  /** Hard cap on how many memory sources enter candidates (default 8). */
  maxEntries?: number;
  /** Max characters of value shown in Manifest summary (default 96). */
  summaryMaxChars?: number;
}

export interface ResolveProjectMemorySourcesResult {
  sources: ContextSourceRef[];
  summaries: Array<{ sourceId: string; summary: string }>;
  /** Stable evidence refs for long-term memory trail on Manifest. */
  evidenceRefs: string[];
}

const SCOPE_RANK: Record<ProjectMemoryScope, number> = {
  task: 0,
  project: 1,
  global: 2,
};

function scrubSecretLike(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9]{10,}/g, '[redacted]')
    .replace(/(?:api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, '[redacted]');
}

/**
 * Map approved/active project memory entries into Context Packet sources (§10.1 / §10.2).
 * Only explicit durable memory rows are included — never raw chat archives.
 */
export function resolveProjectMemorySources(
  input: ResolveProjectMemorySourcesInput,
): ResolveProjectMemorySourcesResult {
  const maxEntries = Math.min(Math.max(input.maxEntries ?? 8, 0), 32);
  const summaryMax = Math.min(Math.max(input.summaryMaxChars ?? 96, 24), 200);

  const cleaned = input.entries
    .map((e) => ({
      id: String(e.id || '').trim(),
      key: String(e.key || '').trim(),
      value: String(e.value || '').trim(),
      scope: (e.scope || 'project') as ProjectMemoryScope,
      taskId: e.taskId,
    }))
    .filter((e) => e.id && e.key && e.value);

  cleaned.sort((a, b) => {
    const ra = SCOPE_RANK[a.scope] ?? 9;
    const rb = SCOPE_RANK[b.scope] ?? 9;
    if (ra !== rb) return ra - rb;
    return 0;
  });

  const picked = cleaned.slice(0, maxEntries);
  const sources: ContextSourceRef[] = [];
  const summaries: Array<{ sourceId: string; summary: string }> = [];
  const evidenceRefs: string[] = [];

  for (const entry of picked) {
    const sourceId = `memory:${entry.id}`;
    const safeValue = scrubSecretLike(entry.value);
    const safeKey = scrubSecretLike(entry.key);
    const body =
      safeValue.length > summaryMax
        ? `${safeValue.slice(0, summaryMax - 1)}…`
        : safeValue;
    const summary = scrubSecretLike(`记忆 · ${safeKey}：${body}`).slice(0, summaryMax + 32);
    const tokenEstimate = Math.max(
      12,
      Math.ceil((entry.key.length + entry.value.length) / 4) + 4,
    );
    sources.push({ id: sourceId, kind: 'project-memory', tokenEstimate });
    summaries.push({ sourceId, summary });
    evidenceRefs.push(sourceId);
  }

  return { sources, summaries, evidenceRefs };
}

/** Allowed Skill version snapshot for packet assembly (design §9 / §10.2). */
export interface AllowedSkillSnapshot {
  id: string;
  name: string;
  version: string;
  description: string;
  body: string;
  allowedTools?: readonly string[];
  hasScripts?: boolean;
}

export interface ResolveAllowedSkillSourcesInput {
  /** Agent allowlist skill version ids — order preserved; missing ids are skipped. */
  skillVersionIds: readonly string[];
  /** Lookup by skillVersionId; return undefined when not in library. */
  getSkill: (skillVersionId: string) => AllowedSkillSnapshot | undefined;
  /** Hard cap on how many skill definitions enter candidates (default 6). */
  maxSkills?: number;
  /** Max characters of body counted toward tokenEstimate (default 2400). */
  bodyMaxChars?: number;
  /** Max characters of body shown in Manifest summary (default 120). */
  summaryMaxChars?: number;
}

export interface ResolveAllowedSkillSourcesResult {
  sources: ContextSourceRef[];
  summaries: Array<{ sourceId: string; summary: string }>;
  /** Ids that were on the allowlist but missing from the library. */
  missingSkillVersionIds: string[];
  /** Ids successfully mapped into sources. */
  resolvedSkillVersionIds: string[];
}

/**
 * Map Agent-allowlisted Skill versions into Context Packet sources (§9.1 / §10.2).
 * Install ≠ available: only explicit allowlist ids are candidates.
 * Scripts are never executed — body text is treated as untrusted instructions.
 */
export function resolveAllowedSkillSources(
  input: ResolveAllowedSkillSourcesInput,
): ResolveAllowedSkillSourcesResult {
  const maxSkills = Math.min(Math.max(input.maxSkills ?? 6, 0), 16);
  const bodyMax = Math.min(Math.max(input.bodyMaxChars ?? 2400, 200), 12_000);
  const summaryMax = Math.min(Math.max(input.summaryMaxChars ?? 120, 32), 240);

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.skillVersionIds) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }

  const sources: ContextSourceRef[] = [];
  const summaries: Array<{ sourceId: string; summary: string }> = [];
  const missingSkillVersionIds: string[] = [];
  const resolvedSkillVersionIds: string[] = [];

  for (const id of orderedIds) {
    if (sources.length >= maxSkills) break;
    const skill = input.getSkill(id);
    if (!skill) {
      missingSkillVersionIds.push(id);
      continue;
    }
    const name = String(skill.name || '').trim() || id.slice(0, 12);
    const version = String(skill.version || '').trim() || '0.0.0';
    const description = String(skill.description || '').trim();
    const body = String(skill.body || '').trim();
    const bodyForTokens = body.length > bodyMax ? body.slice(0, bodyMax) : body;
    const tools = (skill.allowedTools ?? []).map((t) => String(t).trim()).filter(Boolean);
    const toolHint = tools.length > 0 ? tools.slice(0, 4).join(', ') : '';
    const scriptHint = skill.hasScripts ? ' · 含脚本(不执行)' : '';

    const sourceId = `skill:${id}`;
    const bodyPreview =
      bodyForTokens.length > summaryMax
        ? `${bodyForTokens.slice(0, summaryMax - 1)}…`
        : bodyForTokens;
    const summaryCore = [
      `Skill · ${name}@${version}`,
      description ? description.slice(0, 48) : '',
      toolHint ? `tools: ${toolHint}` : '',
      bodyPreview,
    ]
      .filter(Boolean)
      .join(' — ');
    const summary = scrubSecretLike(`${summaryCore}${scriptHint}`).slice(0, summaryMax + 48);

    const tokenEstimate = Math.max(
      24,
      Math.ceil(
        (name.length + description.length + bodyForTokens.length + toolHint.length) / 4,
      ) + 12,
    );

    sources.push({ id: sourceId, kind: 'skill-definition', tokenEstimate });
    summaries.push({ sourceId, summary });
    resolvedSkillVersionIds.push(id);
  }

  return { sources, summaries, missingSkillVersionIds, resolvedSkillVersionIds };
}


export interface AllowedMcpServerSnapshot {
  id: string;
  name: string;
  transport?: string;
  endpoint?: string;
  trusted?: boolean;
  tools: readonly {
    name: string;
    description?: string;
    inputSchemaJson?: string;
  }[];
  /** Soft policy stubs for Manifest observability. */
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export interface ResolveAllowedMcpToolSourcesInput {
  /** Agent allowlist MCP server ids — order preserved; missing ids are skipped. */
  mcpServerIds: readonly string[];
  /** Lookup by mcpServerId; return undefined when not registered. */
  getServer: (mcpServerId: string) => AllowedMcpServerSnapshot | undefined;
  /** Hard cap on how many tool schemas enter candidates (default 16). */
  maxTools?: number;
  /** Max servers considered from allowlist (default 6). */
  maxServers?: number;
  /** Max characters of schema counted toward tokenEstimate (default 800). */
  schemaMaxChars?: number;
  /** Max characters shown in Manifest summary (default 100). */
  summaryMaxChars?: number;
}

export interface ResolveAllowedMcpToolSourcesResult {
  sources: ContextSourceRef[];
  summaries: Array<{ sourceId: string; summary: string }>;
  /** Server ids on allowlist but missing from registry. */
  missingMcpServerIds: string[];
  /** Server ids successfully mapped into at least one tool-schema source. */
  resolvedMcpServerIds: string[];
  /** Number of tool-schema sources produced. */
  toolSchemaCount: number;
}

/**
 * Map Agent-allowlisted MCP servers into Context Packet tool-schema sources (§9.3 / §10.2).
 * Register ≠ available: only explicit mcpServerIds allowlist is considered.
 * Tool schemas are untrusted metadata — never executed; process output would be
 * size-limited / timed out / audited when real workers land (stubbed here).
 */
export function resolveAllowedMcpToolSources(
  input: ResolveAllowedMcpToolSourcesInput,
): ResolveAllowedMcpToolSourcesResult {
  const maxServers = Math.min(Math.max(input.maxServers ?? 6, 0), 16);
  const maxTools = Math.min(Math.max(input.maxTools ?? 16, 0), 48);
  const schemaMax = Math.min(Math.max(input.schemaMaxChars ?? 800, 80), 4_000);
  const summaryMax = Math.min(Math.max(input.summaryMaxChars ?? 100, 32), 200);

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.mcpServerIds) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }

  const sources: ContextSourceRef[] = [];
  const summaries: Array<{ sourceId: string; summary: string }> = [];
  const missingMcpServerIds: string[] = [];
  const resolvedMcpServerIds: string[] = [];
  let serversSeen = 0;

  for (const id of orderedIds) {
    if (serversSeen >= maxServers) break;
    if (sources.length >= maxTools) break;
    const server = input.getServer(id);
    if (!server) {
      missingMcpServerIds.push(id);
      continue;
    }
    serversSeen += 1;
    const serverName = String(server.name || '').trim() || id.slice(0, 12);
    const transport = String(server.transport || 'local-stdio').trim();
    const trusted = Boolean(server.trusted);
    const tools = (server.tools ?? []).filter((t) => String(t?.name || '').trim());
    if (tools.length === 0) {
      // Server registered but no tools yet — still mark resolved for observability.
      resolvedMcpServerIds.push(id);
      continue;
    }

    let any = false;
    for (const tool of tools) {
      if (sources.length >= maxTools) break;
      const toolName = String(tool.name).trim();
      const description = String(tool.description || '').trim();
      const schemaRaw = String(tool.inputSchemaJson || '').trim();
      const schemaForTokens = schemaRaw.length > schemaMax ? schemaRaw.slice(0, schemaMax) : schemaRaw;
      const sourceId = `tool:${id}:${toolName}`;
      const trustHint = trusted ? 'trusted' : 'untrusted';
      const summaryCore = [
        `MCP · ${serverName}/${toolName}`,
        transport,
        trustHint,
        description ? description.slice(0, 48) : '',
        schemaForTokens
          ? schemaForTokens.length > summaryMax
            ? `${schemaForTokens.slice(0, summaryMax - 1)}…`
            : schemaForTokens
          : '',
      ]
        .filter(Boolean)
        .join(' — ');
      const summary = scrubSecretLike(summaryCore).slice(0, summaryMax + 64);
      const tokenEstimate = Math.max(
        16,
        Math.ceil(
          (serverName.length + toolName.length + description.length + schemaForTokens.length) / 4,
        ) + 10,
      );
      sources.push({ id: sourceId, kind: 'tool-schema', tokenEstimate });
      summaries.push({ sourceId, summary });
      any = true;
    }
    if (any) resolvedMcpServerIds.push(id);
  }

  return {
    sources,
    summaries,
    missingMcpServerIds,
    resolvedMcpServerIds,
    toolSchemaCount: sources.length,
  };
}

export interface SelectContextSourcesInput {
  candidates: readonly ContextSourceRef[];
  /** Soft token budget for the packet. Protected sources may exceed it. */
  tokenBudget: number;
  /**
   * When remaining budget is positive but insufficient for a full compressible
   * source, soft-truncate those kinds instead of excluding them entirely.
   */
  allowSoftTruncateKinds?: readonly ContextSourceRef['kind'][];
}

export interface SelectContextSourcesResult {
  included: ContextSourceRef[];
  excluded: ContextSourceRef[];
  truncations: ContextManifest['truncations'];
  overflow: boolean;
  /** True when every protected candidate remains in included (never dropped). */
  protectedPreserved: boolean;
  tokenEstimate: number;
}

function tokenSum(sources: readonly ContextSourceRef[]): number {
  return sources.reduce((sum, s) => sum + (s.tokenEstimate || 0), 0);
}

function proofHash(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function isProtected(kind: ContextSourceRef['kind']): boolean {
  return PROTECTED_SOURCE_KINDS.has(kind);
}

/**
 * Select which context sources enter a packet under a token budget.
 * Protected kinds (goals, decisions, acceptance, constraints) are never
 * silently excluded — overflow is surfaced, compressible sources go first.
 */
export function selectContextSources(input: SelectContextSourcesInput): SelectContextSourcesResult {
  const budget = Math.max(0, input.tokenBudget);
  const softKinds = new Set(input.allowSoftTruncateKinds ?? []);
  const protectedSources = input.candidates.filter((s) => isProtected(s.kind));
  const compressible = input.candidates.filter((s) => !isProtected(s.kind));

  const included: ContextSourceRef[] = [...protectedSources];
  const excluded: ContextSourceRef[] = [];
  const truncations: ContextManifest['truncations'] = [];

  let used = tokenSum(protectedSources);
  const protectedOverBudget = used > budget;

  for (const source of compressible) {
    const cost = source.tokenEstimate || 0;
    if (used + cost <= budget) {
      included.push(source);
      used += cost;
      continue;
    }

    const remaining = budget - used;
    if (remaining > 0 && softKinds.has(source.kind) && cost > remaining) {
      const shrunk: ContextSourceRef = {
        ...source,
        tokenEstimate: remaining,
      };
      included.push(shrunk);
      truncations.push({
        sourceId: source.id,
        reason: 'token-budget-protect-core',
        beforeTokens: cost,
        afterTokens: remaining,
      });
      used += remaining;
      continue;
    }

    excluded.push(source);
  }

  const overflow = protectedOverBudget || excluded.length > 0 || truncations.length > 0;
  const protectedIds = new Set(protectedSources.map((s) => s.id));
  const protectedPreserved = [...protectedIds].every((id) =>
    included.some((s) => s.id === id),
  );

  return {
    included,
    excluded,
    truncations,
    overflow,
    protectedPreserved,
    tokenEstimate: tokenSum(included),
  };
}

/**
 * Build an inspectable Context Packet + Manifest for one model call (§10.3).
 * Pure — Runtime persists/events; this only shapes the inspectable record.
 */

export interface ApplyUserContextAmendmentsInput {
  included: readonly ContextSourceRef[];
  excluded?: readonly ContextSourceRef[];
  /** User force-exclude source ids (thread-scoped). Protected kinds are refused. */
  forceExcludeSourceIds?: readonly string[];
  summaries?: readonly { sourceId: string; summary: string }[];
  evidenceRefsForMemory?: readonly string[];
}

export interface ApplyUserContextAmendmentsResult {
  included: ContextSourceRef[];
  excluded: ContextSourceRef[];
  /** Force-exclude ids that were applied (non-protected, were included). */
  appliedExcludeIds: string[];
  /** Protected source ids the user tried to exclude but were refused. */
  refusedProtectedIds: string[];
  summaries: Array<{ sourceId: string; summary: string }>;
  evidenceRefsForMemory: string[];
  tokenEstimate: number;
  amended: boolean;
}

/**
 * Apply user Manifest amendments before a sensitive Run (design §10.3).
 * Non-protected sources may be force-excluded; protected kinds (§20.9) are never
 * silently dropped — refused ids are reported for observability.
 */
export function applyUserContextAmendments(
  input: ApplyUserContextAmendmentsInput,
): ApplyUserContextAmendmentsResult {
  const forceIds = [...new Set((input.forceExcludeSourceIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const includedIn = [...input.included];
  const excludedIn = [...(input.excluded ?? [])];
  const byId = new Map<string, ContextSourceRef>();
  for (const s of includedIn) byId.set(s.id, s);
  for (const s of excludedIn) {
    if (!byId.has(s.id)) byId.set(s.id, s);
  }

  const appliedExcludeIds: string[] = [];
  const refusedProtectedIds: string[] = [];

  const includedIds = new Set(includedIn.map((s) => s.id));
  for (const id of forceIds) {
    const src = byId.get(id);
    if (!src) continue;
    if (isProtected(src.kind)) {
      refusedProtectedIds.push(id);
      continue;
    }
    // Only count as applied when currently included (idempotent for already-excluded).
    if (includedIds.has(id)) {
      appliedExcludeIds.push(id);
    }
  }

  const applySet = new Set(appliedExcludeIds);
  const included = includedIn.filter((s) => !applySet.has(s.id));
  const excludedMap = new Map<string, ContextSourceRef>();
  for (const s of excludedIn) excludedMap.set(s.id, s);
  for (const id of appliedExcludeIds) {
    const src = byId.get(id);
    if (src) excludedMap.set(id, src);
  }
  // Keep excluded order stable: prior excluded then newly applied
  const excluded: ContextSourceRef[] = [];
  const seen = new Set<string>();
  for (const s of excludedIn) {
    if (!seen.has(s.id)) {
      excluded.push(s);
      seen.add(s.id);
    }
  }
  for (const id of appliedExcludeIds) {
    if (!seen.has(id)) {
      const src = byId.get(id);
      if (src) {
        excluded.push(src);
        seen.add(id);
      }
    }
  }

  const dropEvidence = applySet;
  // Keep all summaries so Manifest can still label excluded rows.
  const summaries = [...(input.summaries ?? [])];
  const evidenceRefsForMemory = (input.evidenceRefsForMemory ?? []).filter((id) => !dropEvidence.has(id));

  return {
    included,
    excluded,
    appliedExcludeIds,
    refusedProtectedIds,
    summaries,
    evidenceRefsForMemory,
    tokenEstimate: tokenSum(included),
    amended: appliedExcludeIds.length > 0,
  };
}

/**
 * Whether a source kind is protected under design §20.9 (cannot force-exclude).
 */
export function isProtectedSourceKind(kind: ContextSourceRef['kind'] | string): boolean {
  return PROTECTED_SOURCE_KINDS.has(kind as ContextSourceRef['kind']);
}

export function buildContextPacket(input: BuildContextPacketInput): BuiltContext {
  const included = input.included;
  const excluded = input.excluded ?? [];
  const packet: ContextPacket = {
    id: input.packetId,
    taskId: input.taskId,
    runId: input.runId,
    stepId: input.stepId,
    agentVersionId: input.agentVersionId,
    modelId: input.modelId,
    credentialRefId: input.credentialRefId,
    includedSources: included,
    excludedSources: excluded,
    compressedSectionIds: input.compressedSectionIds ?? [],
    crossTaskRefs: input.crossTaskRefs ?? [],
    tokenEstimate: tokenSum(included),
    proofHash: proofHash({
      packetId: input.packetId,
      modelId: input.modelId,
      agentVersionId: input.agentVersionId,
      included: included.map((s) => s.id),
      excluded: excluded.map((s) => s.id),
    }),
    createdAt: input.createdAt,
  };

  const manifest: ContextManifest = {
    packetId: packet.id,
    included,
    excluded,
    summaries: input.summaries ?? included.map((s) => ({ sourceId: s.id, summary: s.kind })),
    truncations: input.truncations ?? [],
    crossTaskRefs: packet.crossTaskRefs,
    agentVersionId: input.agentVersionId,
    skillVersionIds: input.skillVersionIds ?? [],
    policyVersion: input.policyVersion,
    evidenceRefsForMemory: input.evidenceRefsForMemory ?? [],
  };

  return { packet, manifest };
}

export function buildContextManifest(
  packet: ContextPacket,
  extras?: Partial<ContextManifest>,
): ContextManifest {
  return {
    packetId: packet.id,
    included: packet.includedSources,
    excluded: packet.excludedSources,
    summaries: extras?.summaries ?? packet.includedSources.map((s) => ({ sourceId: s.id, summary: s.kind })),
    truncations: extras?.truncations ?? [],
    crossTaskRefs: packet.crossTaskRefs,
    agentVersionId: packet.agentVersionId,
    skillVersionIds: extras?.skillVersionIds ?? [],
    policyVersion: extras?.policyVersion,
    evidenceRefsForMemory: extras?.evidenceRefsForMemory ?? [],
  };
}

