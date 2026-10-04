import type { AutomationRunEvidence } from './automation-run-evidence.js';

import type { AutomationOutcome } from './automation/types.js';
export type { AutomationOutcome } from './automation/types.js';
export function parseAutomationOutcome(
  value: unknown,
): Pick<AutomationOutcome, 'status' | 'reason'> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => !['status', 'reason'].includes(key)) ||
    !['success', 'failed', 'blocked'].includes(String(row.status)) ||
    typeof row.reason !== 'string' ||
    !row.reason.trim() ||
    row.reason.length > 2000
  )
    return undefined;
  return { status: row.status as AutomationOutcome['status'], reason: row.reason.trim() };
}

/** Model completion is not business acceptance. Never classify final prose. */
export function automationOutcomeFailure(
  config: { browser?: unknown; outputs?: readonly string[]; delivery?: unknown },
  evidence: AutomationRunEvidence,
  runId: string,
): { status: 'failed' | 'blocked'; reason: string } | undefined {
  const outcome = evidence.outcome?.runId === runId ? evidence.outcome : undefined;
  if (outcome && outcome.status !== 'success')
    return { status: outcome.status, reason: outcome.reason };
  // Preserve the established host-verified artifact/delivery acceptance contract.
  // Explicit negative outcomes still take precedence over those receipts.
  if (config.outputs?.length || config.delivery) return undefined;
  if (!outcome)
    return {
      status: 'blocked',
      reason: '缺少本轮结构化业务结果，请调用 automation_report_outcome',
    };
  if (config.browser && evidence.browserRead?.runId !== runId)
    return { status: 'blocked', reason: '业务成功尚无本轮真实 browser_read 读取证据' };
  return undefined;
}
