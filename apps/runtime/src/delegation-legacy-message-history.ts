import type { DelegatedRunRecord, Message, ThreadId } from '@sync-think/shared';
import { legacyDelegatedRunRecords } from './delegation-message-projection.js';

export interface DelegationLegacyMessagePort {
  listDelegatedMessages?(threadId: ThreadId): Message[];
  findDelegatedMessage?(threadId: ThreadId, childRunId: string): Message | undefined;
}

/** Reads pre-projection delegated task facts from compatibility message metadata. */
export class DelegationLegacyMessageHistory {
  constructor(private readonly messages: DelegationLegacyMessagePort | undefined) {}

  list(threadId: string): DelegatedRunRecord[] {
    return legacyDelegatedRunRecords(
      this.messages?.listDelegatedMessages?.(threadId as ThreadId) ?? [],
    );
  }

  get(threadId: string, childRunId: string): DelegatedRunRecord | undefined {
    if (this.messages?.findDelegatedMessage) {
      const message = this.messages.findDelegatedMessage(threadId as ThreadId, childRunId);
      if (!message) return undefined;
      const exact = legacyDelegatedRunRecords([message]).find(
        (item) => item.childRunId === childRunId,
      );
      if (exact) return exact;
    }
    return this.list(threadId).find((item) => item.childRunId === childRunId);
  }
}
