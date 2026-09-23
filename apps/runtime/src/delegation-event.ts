import {
  delegatedRunFromEvent,
  type DelegatedRunRecord,
  type DelegatedRunSnapshot,
  type Event,
} from '@sync-think/shared';
import type { DemoRunState } from './demo-run.js';

type DelegationRun = Pick<
  DemoRunState,
  | 'runId'
  | 'threadId'
  | 'delegationParentRunId'
  | 'globalAgentId'
  | 'globalAgentName'
  | 'delegationTerminationReason'
  | 'assistantText'
  | 'assistantTimeline'
>;

/** Capture domain facts before run-state delta compaction and before publication. */
export function withDelegatedRunSnapshot<T extends Omit<Event, 'sequence'>>(
  event: T,
  run: DelegationRun | undefined,
): T {
  if (!run?.delegationParentRunId || !run.globalAgentId || event.runId !== run.runId) return event;
  const terminal = ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type);
  const status: DelegatedRunSnapshot['status'] =
    event.type === 'run.completed'
      ? 'completed'
      : terminal && run.delegationTerminationReason === 'timed_out'
        ? 'timed_out'
        : event.type === 'run.failed'
          ? 'failed'
          : event.type === 'run.cancelled'
            ? 'cancelled'
            : 'running';
  const result = (
    typeof event.payload.assistantText === 'string'
      ? event.payload.assistantText
      : run.assistantText
  ).trim();
  const delegatedRun: DelegatedRunSnapshot = {
    childRunId: run.runId,
    parentRunId: run.delegationParentRunId,
    threadId: run.threadId,
    agentId: String(run.globalAgentId),
    name: run.globalAgentName?.trim() || '已配置智能体',
    status,
    toolCount: (run.assistantTimeline ?? []).filter((item) => item.kind === 'tool').length,
    ...(terminal && result ? { result } : {}),
  };
  return { ...event, payload: { ...event.payload, threadId: run.threadId, delegatedRun } };
}

export function reconcileDelegatedRecord(
  record: DelegatedRunRecord,
  events: readonly Event[],
  active: boolean,
): DelegatedRunRecord {
  const terminal = [...events]
    .reverse()
    .find(
      (event) =>
        event.runId === record.childRunId &&
        ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type),
    );
  if (!terminal) return active ? record : { ...record, status: 'failed' };
  const snapshot = delegatedRunFromEvent(terminal);
  if (snapshot) {
    if (snapshot.threadId !== record.threadId || snapshot.parentRunId !== record.parentRunId) {
      throw new Error('delegation.recovery_scope_mismatch');
    }
    return snapshot;
  }
  // Compatibility for events written before the atomic delegation projection.
  const status =
    terminal.type === 'run.completed'
      ? 'completed'
      : terminal.payload.failureClass === 'timeout'
        ? 'timed_out'
        : terminal.type === 'run.cancelled'
          ? 'cancelled'
          : 'failed';
  return {
    ...record,
    status,
    sequence: terminal.sequence,
    updatedAt: terminal.occurredAt,
    ...(typeof terminal.payload.assistantText === 'string'
      ? { result: terminal.payload.assistantText }
      : {}),
  };
}
