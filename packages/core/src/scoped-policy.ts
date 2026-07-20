import {
  HUMAN_ONLY_ACTIONS,
  type AgentVersionId,
  type ApprovalMode,
  type HumanOnlyAction,
} from '@sync-think/shared';

export type PolicyScopeType =
  'user' | 'workspace' | 'project' | 'task' | 'agent' | 'workflow' | 'run';

export interface ScopedPolicyRule {
  action: string;
  approvalMode: ApprovalMode;
  delegateAgentVersionId?: AgentVersionId;
}

export interface ScopedPolicy {
  scope: PolicyScopeType;
  scopeId?: string;
  approvalMode: ApprovalMode;
  rules?: readonly ScopedPolicyRule[];
  policyId?: string;
  version?: number;
}

export interface ResolvedScopedPolicy {
  approvalMode: ApprovalMode;
  rules: ScopedPolicyRule[];
}

export type ActionPolicyDecision = 'allowed' | 'delegate-required' | 'human-required';

export interface ResolveActionDecisionInput {
  action: string;
  approvalMode: ApprovalMode;
  rules?: readonly ScopedPolicyRule[];
}

export interface ResolvedActionDecision {
  action: string;
  approvalMode: ApprovalMode;
  decision: ActionPolicyDecision;
  humanOnly: boolean;
  humanOnlyAction?: HumanOnlyAction;
  delegateAgentVersionId?: AgentVersionId;
}

const APPROVAL_RESTRICTION: Record<ApprovalMode, number> = {
  full: 0,
  custom: 1,
  delegate: 2,
  request: 3,
};

const HUMAN_ONLY_SET = new Set<string>(HUMAN_ONLY_ACTIONS);

function normalizeApprovalMode(value: unknown): ApprovalMode {
  return value === 'request' || value === 'delegate' || value === 'custom' || value === 'full'
    ? value
    : 'request';
}

function moreRestrictive(left: unknown, right: unknown): ApprovalMode {
  const normalizedLeft = normalizeApprovalMode(left);
  const normalizedRight = normalizeApprovalMode(right);
  return APPROVAL_RESTRICTION[normalizedLeft] >= APPROVAL_RESTRICTION[normalizedRight]
    ? normalizedLeft
    : normalizedRight;
}

export function resolveScopedPolicy(policies: readonly ScopedPolicy[]): ResolvedScopedPolicy {
  if (policies.length === 0) {
    return { approvalMode: 'request', rules: [] };
  }

  let approvalMode: ApprovalMode = 'full';
  for (const policy of policies) {
    approvalMode = moreRestrictive(approvalMode, policy.approvalMode);
  }

  const rulesByAction = new Map<
    string,
    {
      approvalMode: ApprovalMode;
      delegateAgentVersionIds: Set<string>;
      missingDelegateAgentVersion: boolean;
    }
  >();
  for (const policy of policies) {
    for (const rule of policy.rules ?? []) {
      const action = rule.action.trim();
      if (!action) continue;
      const existing = rulesByAction.get(action);
      const ruleMode = normalizeApprovalMode(rule.approvalMode);
      const delegateAgentVersionIds = new Set(existing?.delegateAgentVersionIds ?? []);
      let missingDelegateAgentVersion = existing?.missingDelegateAgentVersion ?? false;
      if (ruleMode === 'delegate') {
        const delegateAgentVersionId = rule.delegateAgentVersionId?.trim();
        if (delegateAgentVersionId) delegateAgentVersionIds.add(delegateAgentVersionId);
        else missingDelegateAgentVersion = true;
      }
      rulesByAction.set(action, {
        approvalMode: existing ? moreRestrictive(existing.approvalMode, ruleMode) : ruleMode,
        delegateAgentVersionIds,
        missingDelegateAgentVersion,
      });
    }
  }

  return {
    approvalMode,
    rules: [...rulesByAction]
      .map(([action, rule]) => {
        const delegateAgentVersionId =
          rule.approvalMode === 'delegate' &&
          !rule.missingDelegateAgentVersion &&
          rule.delegateAgentVersionIds.size === 1
            ? ([...rule.delegateAgentVersionIds][0] as AgentVersionId)
            : undefined;
        return {
          action,
          approvalMode: rule.approvalMode,
          ...(delegateAgentVersionId ? { delegateAgentVersionId } : {}),
        };
      })
      .sort((left, right) =>
        left.action < right.action ? -1 : left.action > right.action ? 1 : 0,
      ),
  };
}

export function resolveActionDecision(input: ResolveActionDecisionInput): ResolvedActionDecision {
  const action = input.action.trim();
  const approvalMode = normalizeApprovalMode(input.approvalMode);
  const humanOnlyAction = HUMAN_ONLY_SET.has(action) ? (action as HumanOnlyAction) : undefined;

  if (approvalMode === 'full') {
    return {
      action,
      approvalMode,
      decision: 'allowed',
      humanOnly: Boolean(humanOnlyAction),
      ...(humanOnlyAction ? { humanOnlyAction } : {}),
    };
  }

  if (humanOnlyAction) {
    return {
      action,
      approvalMode,
      decision: 'human-required',
      humanOnly: true,
      humanOnlyAction,
    };
  }

  let matchingRuleMode: ApprovalMode | undefined;
  let delegateAgentVersionId: AgentVersionId | undefined;
  let delegateConfigurationInvalid = false;
  for (const rule of input.rules ?? []) {
    const ruleAction = rule.action.trim();
    if (ruleAction !== action && ruleAction !== '*') continue;
    const ruleMode = normalizeApprovalMode(rule.approvalMode);
    matchingRuleMode = matchingRuleMode ? moreRestrictive(matchingRuleMode, ruleMode) : ruleMode;
    if (ruleMode === 'delegate') {
      const candidate = rule.delegateAgentVersionId?.trim() as AgentVersionId | undefined;
      if (!candidate || (delegateAgentVersionId && delegateAgentVersionId !== candidate)) {
        delegateConfigurationInvalid = true;
      } else {
        delegateAgentVersionId = candidate;
      }
    }
  }

  let effectiveMode: ApprovalMode = approvalMode;
  if (matchingRuleMode) {
    effectiveMode =
      approvalMode === 'custom'
        ? matchingRuleMode
        : moreRestrictive(approvalMode, matchingRuleMode);
  }

  const decision: ActionPolicyDecision =
    effectiveMode === 'full'
      ? 'allowed'
      : effectiveMode === 'delegate' &&
          delegateAgentVersionId !== undefined &&
          !delegateConfigurationInvalid
        ? 'delegate-required'
        : 'human-required';

  return {
    action,
    approvalMode: effectiveMode,
    decision,
    humanOnly: false,
    ...(decision === 'delegate-required' ? { delegateAgentVersionId } : {}),
  };
}
