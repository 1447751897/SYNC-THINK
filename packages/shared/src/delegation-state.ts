import type { Event } from './types/event.js';
import type { DelegatedRunRecord } from './types/delegated-run.js';

/** Event-local facts; sequence and timestamp always come from the event envelope. */
export type DelegatedRunSnapshot = Omit<DelegatedRunRecord, 'sequence' | 'updatedAt'>;

export function delegatedRunFromEvent(event: Event): DelegatedRunRecord | undefined {
  const value = event.payload.delegatedRun;
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('delegation.invalid_event');
  }
  const row = value as DelegatedRunSnapshot;
  if (
    !event.runId ||
    row.childRunId !== event.runId ||
    row.threadId !== event.payload.threadId ||
    ![row.childRunId, row.parentRunId, row.threadId, row.agentId, row.name].every(
      (field) => typeof field === 'string' && field.length > 0,
    ) ||
    row.childRunId === row.parentRunId ||
    !['running', 'completed', 'failed', 'cancelled', 'timed_out'].includes(row.status) ||
    !Number.isSafeInteger(row.toolCount) ||
    row.toolCount < 0 ||
    (row.result !== undefined && typeof row.result !== 'string')
  )
    throw new Error('delegation.invalid_event');
  const expected =
    event.type === 'run.completed'
      ? ['completed']
      : event.type === 'run.failed'
        ? ['failed', 'timed_out']
        : event.type === 'run.cancelled'
          ? ['cancelled', 'timed_out']
          : ['running'];
  if (!expected.includes(row.status)) throw new Error('delegation.event_status_mismatch');
  return {
    childRunId: row.childRunId,
    parentRunId: row.parentRunId,
    threadId: row.threadId,
    agentId: row.agentId,
    name: row.name,
    status: row.status,
    toolCount: row.toolCount,
    ...(row.result !== undefined ? { result: row.result } : {}),
    sequence: event.sequence,
    updatedAt: event.occurredAt,
  };
}
