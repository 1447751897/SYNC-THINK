/**
 * Approval policy helpers (§13 Permissions and approvals).
 *
 * Product authority is the Codex three-mode model:
 *   read-only | workspace | full-access
 *
 * Legacy modes remain accepted for wire compatibility:
 *   request | delegate | full | custom
 *
 * Full access / full-access execute every currently available action without
 * an approval prompt and retain audit metadata.
 */

import {
  HUMAN_ONLY_ACTIONS,
  executionModeFromLegacyApprovalMode,
  legacyApprovalModeFromExecutionMode,
  normalizeExecutionMode,
  type ApprovalMode,
  type ExecutionMode,
  type HumanOnlyAction,
} from '@sync-think/shared';

export type ApprovalActionKind =
  | 'plan'
  | 'tool'
  | 'memory'
  | 'export'
  | 'skill-permission'
  | 'mcp-permission'
  | 'human-only'
  | 'other';

export type ApprovalDecisionGate = 'auto-approve' | 'require-human' | 'require-delegate' | 'deny';

export interface EvaluateApprovalInput {
  /** Active approval mode (Agent / Workspace / Run). */
  mode: ApprovalMode | string;
  /** Free-form action code, e.g. tool name or human-only slug. */
  action: string;
  /** Optional high-level kind for UI grouping. */
  kind?: ApprovalActionKind | string;
  /**
   * When true, the action is inside the explicit auto-allow policy surface
   * (full/custom modes). Default false — safest.
   */
  insideExplicitPolicy?: boolean;
  /**
   * When true, a designated approval Agent may decide (delegate mode).
   * Does not apply to human-only actions.
   */
  delegateAvailable?: boolean;
}

export interface EvaluateApprovalResult {
  gate: ApprovalDecisionGate;
  humanOnly: boolean;
  humanOnlyAction?: HumanOnlyAction;
  mode: ApprovalMode;
  /** Short English reason for tests / audit. */
  reason: string;
  /** Chinese one-line for UI status bars. */
  labelZh: string;
}

const HUMAN_ONLY_SET = new Set<string>(HUMAN_ONLY_ACTIONS);

const HUMAN_ONLY_LABEL_ZH: Record<HumanOnlyAction, string> = {
  'access-or-create-secret': '访问/创建密钥',
  'payment-or-purchase': '支付或购买',
  'public-publishing': '公开发布',
  'send-external-message-as-user': '以用户身份外发',
  'change-identity-or-permission-policy': '变更身份/权限策略',
  'irreversible-deletion': '不可逆删除',
  'export-sensitive-data-outside-boundary': '越界导出敏感数据',
};

const MODE_LABEL_ZH: Record<ApprovalMode, string> = {
  request: '请求批准',
  delegate: '替我审批',
  full: '完全访问',
  custom: '自定义',
};

export function isHumanOnlyAction(action: string | null | undefined): boolean {
  if (!action) return false;
  return HUMAN_ONLY_SET.has(String(action).trim());
}

export function asHumanOnlyAction(action: string | null | undefined): HumanOnlyAction | undefined {
  if (!action) return undefined;
  const key = String(action).trim();
  return HUMAN_ONLY_SET.has(key) ? (key as HumanOnlyAction) : undefined;
}

export function normalizeApprovalMode(mode: unknown): ApprovalMode {
  const m = String(mode ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (m === 'delegate' || m === 'full' || m === 'custom' || m === 'request') {
    return m;
  }
  // Accept ExecutionMode values on the approval path for gradual migration.
  if (m === 'full-access' || m === 'danger-full-access' || m === 'unrestricted') {
    return 'full';
  }
  if (m === 'workspace' || m === 'workspace-write' || m === 'default' || m === 'agent') {
    return 'request';
  }
  if (m === 'read-only' || m === 'readonly' || m === 'read only') {
    return 'request';
  }
  return 'request';
}

export function toExecutionMode(mode: ApprovalMode | ExecutionMode | string | null | undefined): ExecutionMode {
  const raw = String(mode ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-');
  if (raw === 'read-only' || raw === 'readonly' || raw === 'workspace' || raw === 'full-access') {
    return normalizeExecutionMode(raw);
  }
  return executionModeFromLegacyApprovalMode(mode);
}

export function fromExecutionMode(
  mode: ExecutionMode | string,
  routing: 'user' | 'delegate-agent' = 'user',
): ApprovalMode {
  return legacyApprovalModeFromExecutionMode(mode, routing);
}

export function humanOnlyActionLabelZh(action: HumanOnlyAction | string): string {
  const key = String(action).trim() as HumanOnlyAction;
  return HUMAN_ONLY_LABEL_ZH[key] ?? String(action);
}

export function approvalModeLabelZh(mode: ApprovalMode | string): string {
  const m = normalizeApprovalMode(mode);
  return MODE_LABEL_ZH[m];
}

/**
 * Evaluate whether an action may auto-approve under the given mode.
 * Sensitive actions force require-human unless full access is the effective mode (§13.2 / §19).
 */
export function evaluateApproval(input: EvaluateApprovalInput): EvaluateApprovalResult {
  const mode = normalizeApprovalMode(input.mode);
  const action = String(input.action ?? '').trim();
  const humanOnlyAction = asHumanOnlyAction(action);
  const humanOnly =
    Boolean(humanOnlyAction) || input.kind === 'human-only' || isHumanOnlyAction(action);

  if (mode === 'full') {
    return {
      gate: 'auto-approve',
      humanOnly,
      ...(humanOnlyAction ? { humanOnlyAction } : {}),
      mode,
      reason: 'full access runs every available action without approval',
      labelZh: humanOnly ? '完全访问 · 敏感操作自动执行并记录' : '完全访问 · 自动执行',
    };
  }

  if (humanOnly) {
    const slug = humanOnlyAction ?? (action as HumanOnlyAction);
    return {
      gate: 'require-human',
      humanOnly: true,
      humanOnlyAction: humanOnlyAction,
      mode,
      reason: 'human-only action cannot be auto-approved or delegated',
      labelZh: `敏感操作 · 需本人确认 · ${humanOnlyActionLabelZh(slug)}`,
    };
  }

  const inside = Boolean(input.insideExplicitPolicy);

  if (mode === 'request') {
    return {
      gate: 'require-human',
      humanOnly: false,
      mode,
      reason: 'request mode requires human approval for protected actions',
      labelZh: '请求批准 · 需真人确认',
    };
  }

  if (mode === 'delegate') {
    if (input.delegateAvailable) {
      return {
        gate: 'require-delegate',
        humanOnly: false,
        mode,
        reason: 'delegate mode routes to approval agent (not human-only)',
        labelZh: '替我审批 · 由审批 Agent 评估',
      };
    }
    return {
      gate: 'require-human',
      humanOnly: false,
      mode,
      reason: 'delegate mode without available agent falls back to human',
      labelZh: '替我审批 · 无审批 Agent · 回退真人',
    };
  }

  // custom
  if (inside) {
    return {
      gate: 'auto-approve',
      humanOnly: false,
      mode,
      reason: 'custom mode allows auto-approve when rule matches',
      labelZh: '自定义 · 规则命中自动通过',
    };
  }
  return {
    gate: 'require-human',
    humanOnly: false,
    mode,
    reason: 'custom mode requires human when no matching auto rule',
    labelZh: '自定义 · 无匹配规则 · 需真人',
  };
}

export function listHumanOnlyActions(): readonly HumanOnlyAction[] {
  return HUMAN_ONLY_ACTIONS;
}

export function formatApprovalGateLabel(result: EvaluateApprovalResult): string {
  return result.labelZh;
}
