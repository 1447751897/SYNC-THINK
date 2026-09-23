/** Durable delegation facts, independent of message/card formatting. */
export interface DelegatedRunRecord {
  childRunId: string;
  parentRunId: string;
  threadId: string;
  agentId: string;
  name: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  toolCount: number;
  result?: string;
  updatedAt: string;
  /** Durable event sequence; zero is reserved for legacy message backfill. */
  sequence: number;
}

export interface DelegatedRunRepository {
  upsert(record: DelegatedRunRecord): DelegatedRunRecord;
  get(childRunId: string): DelegatedRunRecord | undefined;
  listByThread(threadId: string): DelegatedRunRecord[];
}
