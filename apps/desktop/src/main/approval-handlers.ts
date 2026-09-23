import type {
  ApprovalCommand,
  ApprovalCommandRequest,
  ApprovalCommandResponse,
} from '@sync-think/protocol';
import {
  parseDecideApprovalPayload,
  parseEnqueueApprovalPayload,
  parseEvaluateApprovalPayload,
  parseListApprovalsPayload,
} from '../approval-payloads.js';

export interface ApprovalHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestApproval<K extends ApprovalCommand>(
    command: K,
    payload: ApprovalCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ApprovalCommandResponse<K>>;
}

export function registerApprovalHandlers<Event>(host: ApprovalHost<Event>): void {
  host.handle('runtime:approval-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestApproval('approval.list', parseListApprovalsPayload(value));
  });

  host.handle('runtime:approval-evaluate', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestApproval('approval.evaluate', parseEvaluateApprovalPayload(value));
  });

  host.handle('runtime:approval-enqueue', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestApproval('approval.enqueue', parseEnqueueApprovalPayload(value));
  });

  host.handle('runtime:approval-decide', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestApproval('approval.decide', parseDecideApprovalPayload(value));
  });
}
