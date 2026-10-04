import type { AutomationAcceptanceChecks } from '@sync-think/shared';
import type { AutomationOutcome } from './automation/types.js';
/** Host-owned delivery facts. Provider prose is never an execution receipt. */
export interface AutomationRunEvidence {
  outcome?: AutomationOutcome;
  /** Captured only from a successful bound live browser_read, never supplied by the actor. */
  browserRead?: { runId: string; toolCallId: string; commandId: string; ownerId: string; profileId: string; url: string; observedAt: string };
  browserWorkflowCompleted?: boolean;
  outputs: Array<{
    format: 'spreadsheet' | 'presentation';
    path: string;
    sha256: string;
    bytes: number;
    businessAcceptance?: { passed: true; contractHash: string; expectedLocalDate: string };
  }>;
  delivery?: { state: 'sending' | 'sent' | 'unknown'; receiptId?: string; toolCallId: string };
}
export function emptyAutomationEvidence(): AutomationRunEvidence {
  return { outputs: [] };
}
export function isAutomationEvidence(value: unknown): value is AutomationRunEvidence {
  if (!value || typeof value !== 'object') return false;
  const row = value as AutomationRunEvidence;
  return (
    (row.outcome === undefined || (
      row.outcome && ['success', 'failed', 'blocked'].includes(row.outcome.status) &&
      typeof row.outcome.reason === 'string' && !!row.outcome.reason.trim() && row.outcome.reason.length <= 2000 &&
      typeof row.outcome.runId === 'string' && !!row.outcome.runId &&
      typeof row.outcome.reportedAt === 'string' && Number.isFinite(Date.parse(row.outcome.reportedAt))
    )) &&
    (row.browserRead === undefined || (
      row.browserRead && typeof row.browserRead.runId === 'string' && !!row.browserRead.runId &&
      typeof row.browserRead.toolCallId === 'string' && !!row.browserRead.toolCallId &&
      typeof row.browserRead.commandId === 'string' && !!row.browserRead.commandId &&
      typeof row.browserRead.ownerId === 'string' && !!row.browserRead.ownerId &&
      typeof row.browserRead.profileId === 'string' && !!row.browserRead.profileId &&
      typeof row.browserRead.url === 'string' && /^https?:\/\//.test(row.browserRead.url) &&
      typeof row.browserRead.observedAt === 'string' && Number.isFinite(Date.parse(row.browserRead.observedAt))
    )) &&
    Array.isArray(row.outputs) &&
    row.outputs.every(
      (out) =>
        out &&
        ['spreadsheet', 'presentation'].includes(out.format) &&
        typeof out.path === 'string' &&
        typeof out.sha256 === 'string' &&
        Number.isFinite(out.bytes),
    )
  );
}
/** A connector must return a structured message/send identifier, not merely HTTP 200. */
export function extractAutomationMailReceipt(text: unknown): string | undefined {
  const visit = (value: unknown, depth: number): string | undefined => {
    if (depth > 7 || !value) return undefined;
    if (typeof value === 'string') {
      try {
        return visit(JSON.parse(value), depth + 1);
      } catch {
        return undefined;
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const id = visit(item, depth + 1);
        if (id) return id;
      }
      return undefined;
    }
    if (typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    if (
      record.ok === false ||
      record.isError === true ||
      record.error ||
      ['failed', 'error', 'cancelled', 'pending', 'draft'].includes(
        String(record.status ?? '').toLowerCase(),
      )
    )
      return undefined;
    for (const key of ['messageId', 'message_id', 'sentMessageId', 'receiptId']) {
      const id = record[key];
      if (typeof id === 'string' && id.trim() && id.length <= 500) return id.trim();
    }
    // Gmail's native messages.send response has id + threadId; a draft id alone is insufficient.
    if (
      typeof record.id === 'string' &&
      record.id.trim() &&
      typeof record.threadId === 'string' &&
      record.threadId.trim()
    )
      return record.id.trim();
    for (const key of ['result', 'data', 'content', 'text', 'toolResultText']) {
      const id = visit(record[key], depth + 1);
      if (id) return id;
    }
    return undefined;
  };
  return visit(text, 0);
}
export function automationRecipientMatches(
  args: Record<string, unknown>,
  expected: string,
): boolean {
  const values = ['to', 'recipient', 'recipients', 'to_email', 'toEmail']
    .filter((key) => Object.hasOwn(args, key))
    .map((key) => args[key]);
  if (
    !values.length ||
    ['cc', 'bcc'].some(
      (key) =>
        args[key] &&
        (Array.isArray(args[key]) ? (args[key] as unknown[]).length : String(args[key]).trim()),
    )
  )
    return false;
  const recipient = expected.trim().toLowerCase();
  return values.every((value) => {
    const list = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/[;,]/)
        : [];
    return (
      list.length === 1 && typeof list[0] === 'string' && list[0].trim().toLowerCase() === recipient
    );
  });
}
export function automationAcceptanceFailure(
  config: {
    browser?: { workflowTaskId?: string };
    outputs?: Array<'spreadsheet' | 'presentation'>;
    delivery?: unknown;
    acceptanceChecks?: AutomationAcceptanceChecks;
  },
  evidence: AutomationRunEvidence,
  expectedContractHash?: string,
): string | undefined {
  if (config.browser?.workflowTaskId && !evidence.browserWorkflowCompleted)
    return '已绑定的浏览器流程尚无本轮执行成功记录';
  const missing = (config.outputs ?? []).filter(
    (format) => !evidence.outputs.some((output) => output.format === format && output.bytes > 0),
  );
  if (missing.length) return '缺少真实交付文件：' + missing.join('、');
  if (
    config.acceptanceChecks &&
    (!expectedContractHash ||
      (config.outputs ?? []).some(
        (format) =>
          !evidence.outputs.some(
            (output) =>
              output.format === format &&
              output.bytes > 0 &&
              output.businessAcceptance?.passed === true &&
              output.businessAcceptance.contractHash === expectedContractHash,
          ),
      ))
  )
    return '结构化业务验收缺少本轮宿主确认，请按冻结规则修正并重新导出';
  if (
    config.delivery &&
    (evidence.delivery?.state !== 'sent' || !evidence.delivery.receiptId?.trim())
  )
    return evidence.delivery?.state === 'unknown' || evidence.delivery?.state === 'sending'
      ? '邮件发送结果待核对，为避免重复发送，本轮已停止自动重发'
      : '尚未取得邮件发送回执';
  return undefined;
}

/** Explicit schema adapters; generated bytes never pass through provider context. */
export function bindAutomationMailAttachments(
  schema: unknown,
  args: Record<string, unknown>,
  files: Array<{ path: string; fileName: string; base64: string; mimeType: string }>,
): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  if (!properties) return undefined;
  const result = { ...args };
  const paths = files.map((file) => file.path);
  const field = properties.attachmentPaths as
    { type?: string; items?: { type?: string } } | undefined;
  if (field?.type === 'array' && field.items?.type === 'string') {
    delete result.attachments;
    result.attachmentPaths = paths;
    return result;
  }
  const attachments = properties.attachments as
    { type?: string; items?: { type?: string; properties?: Record<string, unknown> } } | undefined;
  if (attachments?.type !== 'array') return undefined;
  delete result.attachmentPaths;
  if (attachments.items?.type === 'string') {
    result.attachments = paths;
    return result;
  }
  const item = attachments.items?.properties;
  if (!item) return undefined;
  const contentKey = ['contentBase64', 'content', 'data'].find((key) => Object.hasOwn(item, key));
  const pathKey = ['path', 'filePath'].find((key) => Object.hasOwn(item, key));
  if (!contentKey && !pathKey) return undefined;
  result.attachments = files.map((file) => {
    const output: Record<string, unknown> = contentKey
      ? { [contentKey]: file.base64 }
      : { [pathKey!]: file.path };
    if (Object.hasOwn(item, 'filename')) output.filename = file.fileName;
    if (Object.hasOwn(item, 'fileName')) output.fileName = file.fileName;
    if (Object.hasOwn(item, 'name')) output.name = file.fileName;
    if (Object.hasOwn(item, 'mimeType')) output.mimeType = file.mimeType;
    if (Object.hasOwn(item, 'contentType')) output.contentType = file.mimeType;
    if (contentKey && Object.hasOwn(item, 'encoding')) output.encoding = 'base64';
    return output;
  });
  return result;
}

/** Keep control-plane results valid JSON; screenshot URLs live in the persisted run trace. */
export function projectBrowserWorkflowResultForModel(text: string): string {
  try {
    const input = JSON.parse(text) as Record<string, unknown>;
    const keys = [
      'ok',
      'runId',
      'workflowVersionId',
      'taskId',
      'profileId',
      'stepCount',
      'executedStepCount',
      'code',
      'error',
      'failureClass',
      'missingVariables',
      'missingOrigins',
      'askUser',
    ];
    const output: Record<string, unknown> = {};
    for (const key of keys)
      if (Object.hasOwn(input, key))
        output[key] =
          typeof input[key] === 'string' ? (input[key] as string).slice(0, 600) : input[key];
    if (Array.isArray(input.steps)) {
      output.steps = input.steps.slice(-3).map((step: Record<string, unknown>) => ({
        sequence: step.sequence,
        ok: step.ok,
        actionKind: step.actionKind,
        outputUrl: typeof step.outputUrl === 'string' ? step.outputUrl.slice(0, 200) : undefined,
        error: typeof step.error === 'string' ? step.error.slice(0, 200) : undefined,
      }));
      output.traceStepCount = input.steps.length;
      output.note = '完整步骤和截图保留在本次浏览器执行记录中。';
    }
    return JSON.stringify(output);
  } catch {
    return text;
  }
}
