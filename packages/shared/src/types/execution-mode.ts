import type { ApprovalMode, ExecutionMode } from './enums.js';

export type ExecutionModeSource = 'task' | 'project' | 'install' | 'legacy-approval' | 'default';

export type ExecutionApprovalRouting = 'user' | 'delegate-agent';

export const DEFAULT_EXECUTION_MODE: ExecutionMode = 'workspace';

const EXECUTION_MODES = new Set<ExecutionMode>(['read-only', 'workspace', 'full-access']);

const EXECUTION_MODE_LABEL_ZH: Record<ExecutionMode, string> = {
  'read-only': '只读',
  workspace: '工作区',
  'full-access': '完全访问',
};

const EXECUTION_MODE_SUMMARY_ZH: Record<ExecutionMode, string> = {
  'read-only': '可自动检查项目内文件；写入、命令与外联需批准或不提供',
  workspace: '项目内读写与命令可自动执行；越界与敏感动作需批准',
  'full-access': '当前可用动作全部自动执行，不弹审批，仅保留审计',
};

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === 'string' && EXECUTION_MODES.has(value as ExecutionMode);
}

/** Normalize product execution modes and common aliases. Unknown -> workspace. */
export function normalizeExecutionMode(value: unknown): ExecutionMode {
  if (typeof value !== 'string') return DEFAULT_EXECUTION_MODE;
  const raw = value.trim().toLowerCase().replace(/_/g, '-');
  if (raw === 'readonly' || raw === 'read-only' || raw === 'read only') return 'read-only';
  if (raw === 'workspace' || raw === 'default' || raw === 'agent' || raw === 'workspace-write') {
    return 'workspace';
  }
  if (
    raw === 'full-access' ||
    raw === 'full' ||
    raw === 'danger-full-access' ||
    raw === 'unrestricted'
  ) {
    return 'full-access';
  }
  return DEFAULT_EXECUTION_MODE;
}

export function executionModeLabelZh(mode: ExecutionMode | string): string {
  return EXECUTION_MODE_LABEL_ZH[normalizeExecutionMode(mode)];
}

export function executionModeSummaryZh(mode: ExecutionMode | string): string {
  return EXECUTION_MODE_SUMMARY_ZH[normalizeExecutionMode(mode)];
}

/**
 * Map legacy ApprovalMode values onto ExecutionMode.
 * delegate keeps workspace sandbox and only changes approval routing.
 */
export function executionModeFromLegacyApprovalMode(
  mode: ApprovalMode | string | null | undefined,
): ExecutionMode {
  const raw = String(mode ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'full') return 'full-access';
  if (raw === 'request' || raw === 'delegate' || raw === 'custom') return 'workspace';
  return normalizeExecutionMode(raw);
}

export function approvalRoutingFromLegacyApprovalMode(
  mode: ApprovalMode | string | null | undefined,
): ExecutionApprovalRouting {
  const raw = String(mode ?? '')
    .trim()
    .toLowerCase();
  return raw === 'delegate' ? 'delegate-agent' : 'user';
}

/**
 * Compatibility projection for existing payloads that still store ApprovalMode.
 * full-access -> full; workspace+delegate -> delegate; otherwise request.
 * custom is not re-emitted from the three-mode model.
 */
export function legacyApprovalModeFromExecutionMode(
  mode: ExecutionMode | string,
  routing: ExecutionApprovalRouting = 'user',
): ApprovalMode {
  const normalized = normalizeExecutionMode(mode);
  if (normalized === 'full-access') return 'full';
  if (routing === 'delegate-agent') return 'delegate';
  return 'request';
}

export function resolveExecutionMode(input: {
  taskMode?: ExecutionMode | string | null;
  projectMode?: ExecutionMode | string | null;
  installMode?: ExecutionMode | string | null;
  legacyApprovalMode?: ApprovalMode | string | null;
}): { mode: ExecutionMode; source: ExecutionModeSource } {
  if (input.taskMode != null && String(input.taskMode).trim() !== '') {
    return { mode: normalizeExecutionMode(input.taskMode), source: 'task' };
  }
  if (input.projectMode != null && String(input.projectMode).trim() !== '') {
    return { mode: normalizeExecutionMode(input.projectMode), source: 'project' };
  }
  if (input.installMode != null && String(input.installMode).trim() !== '') {
    return { mode: normalizeExecutionMode(input.installMode), source: 'install' };
  }
  if (input.legacyApprovalMode != null && String(input.legacyApprovalMode).trim() !== '') {
    return {
      mode: executionModeFromLegacyApprovalMode(input.legacyApprovalMode),
      source: 'legacy-approval',
    };
  }
  return { mode: DEFAULT_EXECUTION_MODE, source: 'default' };
}

/** Immutable Run-level snapshot of effective execution (audit / resume). */
export interface EffectiveExecutionSnapshot {
  mode: ExecutionMode;
  workspaceRoot?: string;
  filesystem: 'read' | 'write-workspace' | 'unrestricted';
  network: 'deny' | 'ask' | 'allow';
  approval: 'ask-protected' | 'never';
  approvalRouting: ExecutionApprovalRouting;
  toolNames: string[];
  capturedAt: string;
  source?: ExecutionModeSource;
}