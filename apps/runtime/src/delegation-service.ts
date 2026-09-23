import type { DelegatedAgentProjection } from '@sync-think/protocol';
import type {
  DelegatedRunRecord, DelegatedRunRepository, MessageBlock, RunId,
} from '@sync-think/shared';
import { DelegationMessageHistory, type DelegationMessagePort } from './delegation-message-history.js';
import { DelegationLegacyMessageHistory } from './delegation-legacy-message-history.js';
import { DelegationHistoryQuery } from './delegation-history-query.js';

// Compatibility exports; consumers of legacy parsing can depend directly on message history.
export { delegatedAgentsFromBlocks, legacyDelegatedRunRecords } from './delegation-message-projection.js';
export type { DelegationMessagePort } from './delegation-message-history.js';

/** State owner and stable facade for Runtime's delegation use cases. */
export class DelegationService {
  private readonly records = new Map<string, DelegatedRunRecord>();
  private readonly history: DelegationMessageHistory;
  private readonly historyQuery: DelegationHistoryQuery;

  constructor(
    messages?: DelegationMessagePort,
    private readonly repository?: DelegatedRunRepository,
    reconcile?: (record: DelegatedRunRecord) => DelegatedRunRecord,
  ) {
    this.history = new DelegationMessageHistory(messages, (id) => this.getState(id));
    const legacyHistory = new DelegationLegacyMessageHistory(messages);
    this.historyQuery = new DelegationHistoryQuery({
      listLegacy: (threadId) => legacyHistory.list(threadId),
      listStored: (threadId) => [
        ...(this.repository?.listByThread(threadId) ?? []),
        ...[...this.records.values()].filter((item) => item.threadId === threadId),
      ],
      getLegacy: (threadId, childRunId) => legacyHistory.get(threadId, childRunId),
      getStored: (childRunId) => this.getState(childRunId),
      reconcile: (item) => {
        if (!reconcile) return item;
        const next = reconcile(item);
        // Persist repairs backed by newer events, not temporary liveness observations.
        return next.sequence > item.sequence ? this.recordState(next) : next;
      },
    });
  }

  getState(childRunId: string): DelegatedRunRecord | undefined {
    return this.repository?.get(childRunId) ?? this.records.get(childRunId);
  }

  /** SQLite has already projected this event; other hosts keep the same service contract. */
  acceptCommittedState(record: DelegatedRunRecord): void {
    const stored = this.getState(record.childRunId);
    if (!stored || stored.sequence < record.sequence) this.recordState(record);
  }

  recordState(record: DelegatedRunRecord): DelegatedRunRecord {
    const old = this.records.get(record.childRunId);
    const next =
      this.repository?.upsert(record) ??
      (old &&
      (old.sequence > record.sequence || (old.status !== 'running' && old.status !== record.status))
        ? old
        : record);
    // SQLite owns durable records; keep memory only for hosts without persistence.
    if (!this.repository) this.records.set(next.childRunId, next);
    return { ...next };
  }

  listByThread(threadId: string): DelegatedRunRecord[] {
    return this.historyQuery.listByThread(threadId);
  }

  query(threadId: string, args: Record<string, unknown>): Record<string, unknown> {
    return this.historyQuery.query(threadId, args);
  }

  listByParent(parentRunId: RunId): DelegatedAgentProjection[] {
    return this.history.listByParent(parentRunId);
  }

  upsert(agent: DelegatedAgentProjection): DelegatedAgentProjection[] {
    return this.history.upsert(agent);
  }

  withMetadata(
    blocks: readonly MessageBlock[],
    agents: readonly DelegatedAgentProjection[],
  ): MessageBlock[] {
    return this.history.withMetadata(blocks, agents);
  }

  persistParent(parentRunId: RunId): void {
    this.history.persistParent(parentRunId);
  }

  releaseParent(parentRunId: RunId): void {
    this.history.releaseParent(parentRunId);
  }
}
