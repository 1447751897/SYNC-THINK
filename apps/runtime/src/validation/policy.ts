// policy command payload parsers (extracted from command-validation.ts).
import type { SavePolicyPayload } from '@sync-think/protocol';
import { POLICY_SCOPE_TYPES, APPROVAL_MODES, hasOnlyKeys, isRecord } from './shared.js';

export function parseSavePolicyPayload(value: unknown): SavePolicyPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'workspaceId',
      'policyId',
      'scopeType',
      'scopeId',
      'approvalMode',
      'rules',
    ])
  )
    return undefined;
  if (
    typeof value.workspaceId !== 'string' ||
    value.workspaceId.trim().length === 0 ||
    value.workspaceId.length > 256 ||
    typeof value.scopeType !== 'string' ||
    !POLICY_SCOPE_TYPES.has(value.scopeType) ||
    typeof value.scopeId !== 'string' ||
    value.scopeId.trim().length === 0 ||
    value.scopeId.length > 256 ||
    typeof value.approvalMode !== 'string' ||
    !APPROVAL_MODES.has(value.approvalMode)
  ) {
    return undefined;
  }
  if (
    value.policyId !== undefined &&
    (typeof value.policyId !== 'string' ||
      value.policyId.trim().length === 0 ||
      value.policyId.length > 256)
  ) {
    return undefined;
  }
  if (value.rules !== undefined) {
    if (!Array.isArray(value.rules) || value.rules.length > 256) return undefined;
    for (const rule of value.rules) {
      if (
        !isRecord(rule) ||
        !hasOnlyKeys(rule, ['action', 'approvalMode', 'delegateAgentVersionId']) ||
        typeof rule.action !== 'string' ||
        rule.action.trim().length === 0 ||
        rule.action.length > 256 ||
        typeof rule.approvalMode !== 'string' ||
        !APPROVAL_MODES.has(rule.approvalMode)
      ) {
        return undefined;
      }
      if (
        rule.delegateAgentVersionId !== undefined &&
        (rule.approvalMode !== 'delegate' ||
          typeof rule.delegateAgentVersionId !== 'string' ||
          rule.delegateAgentVersionId.trim().length === 0 ||
          rule.delegateAgentVersionId.length > 128)
      )
        return undefined;
    }
  }

  return {
    workspaceId: value.workspaceId.trim() as SavePolicyPayload['workspaceId'],
    policyId: typeof value.policyId === 'string' ? value.policyId.trim() : undefined,
    scopeType: value.scopeType as SavePolicyPayload['scopeType'],
    scopeId: value.scopeId.trim(),
    approvalMode: value.approvalMode as SavePolicyPayload['approvalMode'],
    rules: Array.isArray(value.rules)
      ? value.rules.map((rule) => {
          const normalized = rule as Record<string, string | undefined>;
          return {
            action: normalized.action!.trim(),
            approvalMode: normalized.approvalMode as SavePolicyPayload['approvalMode'],
            ...(normalized.delegateAgentVersionId
              ? {
                  delegateAgentVersionId: normalized.delegateAgentVersionId.trim() as NonNullable<
                    SavePolicyPayload['rules']
                  >[number]['delegateAgentVersionId'],
                }
              : {}),
          };
        })
      : undefined,
  };
}
