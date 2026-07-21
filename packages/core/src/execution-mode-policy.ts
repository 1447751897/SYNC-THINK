/**
 * Codex three-mode execution policy (§2026-07-20).
 *
 * Product authority is ExecutionMode. Legacy ApprovalMode remains a wire
 * compatibility projection only.
 */

import {
  approvalRoutingFromLegacyApprovalMode,
  executionModeFromLegacyApprovalMode,
  executionModeLabelZh,
  executionModeSummaryZh,
  legacyApprovalModeFromExecutionMode,
  normalizeExecutionMode,
  resolveExecutionMode,
  type ApprovalMode,
  type EffectiveExecutionSnapshot,
  type ExecutionApprovalRouting,
  type ExecutionMode,
  type ExecutionModeSource,
} from '@sync-think/shared';

export type ExecutionFilesystemPolicy = 'read' | 'write-workspace' | 'unrestricted';
export type ExecutionNetworkPolicy = 'deny' | 'ask' | 'allow';
export type ExecutionApprovalPolicy = 'ask-protected' | 'never';

export interface ResolveEffectiveExecutionInput {
  taskMode?: ExecutionMode | string | null;
  projectMode?: ExecutionMode | string | null;
  installMode?: ExecutionMode | string | null;
  /** Compatibility input while payloads still store ApprovalMode. */
  legacyApprovalMode?: ApprovalMode | string | null;
  workspaceRoot?: string | null;
  /**
   * Candidate tool names already known to Runtime (system tools ∩ bindings).
   * Mode filtering is applied on top of this list.
   */
  candidateToolNames?: readonly string[];
  /**
   * Optional delegated/subtask allowlist. When present, tools must also appear here.
   */
  allowedTools?: readonly string[];
  /** Optional override when legacy mode is not delegate but routing still needs delegate. */
  approvalRouting?: ExecutionApprovalRouting;
}

export interface EffectiveExecution {
  mode: ExecutionMode;
  source: ExecutionModeSource;
  legacyApprovalMode: ApprovalMode;
  workspaceRoot?: string;
  filesystem: ExecutionFilesystemPolicy;
  network: ExecutionNetworkPolicy;
  approval: ExecutionApprovalPolicy;
  approvalRouting: ExecutionApprovalRouting;
  toolNames: string[];
  requiresWorkspaceRoot: boolean;
  hasWorkspaceRoot: boolean;
  labelZh: string;
  summaryZh: string;
}

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_files',
  'git_status',
  'git_diff',
  'browser_extract',
]);

function normalizeRoot(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function uniqueToolNames(names: readonly string[] | undefined): string[] {
  if (!names || names.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function modeAllowsTool(mode: ExecutionMode, toolName: string): boolean {
  if (mode === 'full-access' || mode === 'workspace') return true;
  // read-only: inspection tools only
  return READ_ONLY_TOOLS.has(toolName);
}

export function resolveEffectiveExecution(
  input: ResolveEffectiveExecutionInput,
): EffectiveExecution {
  const resolved = resolveExecutionMode({
    taskMode: input.taskMode,
    projectMode: input.projectMode,
    installMode: input.installMode,
    legacyApprovalMode: input.legacyApprovalMode,
  });
  const mode = normalizeExecutionMode(resolved.mode);
  // Explicit routing wins. Legacy `delegate` only affects routing when mode came from legacy.
  const approvalRouting: ExecutionApprovalRouting =
    input.approvalRouting ??
    (resolved.source === 'legacy-approval'
      ? approvalRoutingFromLegacyApprovalMode(input.legacyApprovalMode)
      : 'user');

  const workspaceRoot = normalizeRoot(input.workspaceRoot);
  const hasWorkspaceRoot = workspaceRoot !== undefined;
  const requiresWorkspaceRoot = mode !== 'full-access';

  let candidate = uniqueToolNames(input.candidateToolNames);
  if (!hasWorkspaceRoot && mode !== 'full-access') {
    candidate = [];
  } else {
    candidate = candidate.filter((name) => modeAllowsTool(mode, name));
  }

  if (input.allowedTools && input.allowedTools.length > 0) {
    const allow = new Set(uniqueToolNames(input.allowedTools));
    candidate = candidate.filter((name) => allow.has(name));
  }

  const filesystem: ExecutionFilesystemPolicy =
    mode === 'full-access'
      ? 'unrestricted'
      : mode === 'workspace'
        ? 'write-workspace'
        : 'read';
  const network: ExecutionNetworkPolicy =
    mode === 'full-access' ? 'allow' : mode === 'workspace' ? 'ask' : 'deny';
  const approval: ExecutionApprovalPolicy =
    mode === 'full-access' ? 'never' : 'ask-protected';

  return {
    mode,
    source: resolved.source,
    legacyApprovalMode: legacyApprovalModeFromExecutionMode(mode, approvalRouting),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    filesystem,
    network,
    approval,
    approvalRouting,
    toolNames: candidate,
    requiresWorkspaceRoot,
    hasWorkspaceRoot,
    labelZh: executionModeLabelZh(mode),
    summaryZh: executionModeSummaryZh(mode),
  };
}

/**
 * Whether an action should auto-run under the effective mode without an approval queue.
 * Boundary checks beyond mode remain Runtime/worker responsibility.
 */
export function isAutoApprovedByExecutionMode(
  mode: ExecutionMode | string,
  options?: { insideModeBoundary?: boolean; toolAvailable?: boolean },
): boolean {
  const normalized = normalizeExecutionMode(mode);
  if (normalized === 'full-access') return options?.toolAvailable !== false;
  if (options?.toolAvailable === false) return false;
  if (normalized === 'read-only') return false;
  // workspace: in-boundary auto, out-of-boundary asks
  return options?.insideModeBoundary !== false;
}

export function executionModeFromApprovalMode(
  mode: ApprovalMode | string | null | undefined,
): ExecutionMode {
  return executionModeFromLegacyApprovalMode(mode);
}


/** Freeze the effective execution surface for a Run (audit + resume). */
export function captureEffectiveExecutionSnapshot(
  effective: EffectiveExecution,
  capturedAt: string = new Date().toISOString(),
): EffectiveExecutionSnapshot {
  return {
    mode: effective.mode,
    ...(effective.workspaceRoot ? { workspaceRoot: effective.workspaceRoot } : {}),
    filesystem: effective.filesystem,
    network: effective.network,
    approval: effective.approval,
    approvalRouting: effective.approvalRouting,
    toolNames: [...effective.toolNames],
    capturedAt,
    source: effective.source,
  };
}
