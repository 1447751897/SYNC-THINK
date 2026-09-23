import type { DelegatedRunRecord } from '@sync-think/shared';

export interface DelegationHistoryQueryPorts {
  listLegacy(threadId: string): readonly DelegatedRunRecord[];
  listStored(threadId: string): readonly DelegatedRunRecord[];
  getLegacy(threadId: string, childRunId: string): DelegatedRunRecord | undefined;
  getStored(childRunId: string): DelegatedRunRecord | undefined;
  /** Repair through the state owner; the query never writes messages or state itself. */
  reconcile(record: DelegatedRunRecord): DelegatedRunRecord;
}

/** Merge canonical/legacy facts and preserve the tool's list/report pagination contract. */
export class DelegationHistoryQuery {
  constructor(private readonly ports: DelegationHistoryQueryPorts) {}

  listByThread(threadId: string): DelegatedRunRecord[] {
    const records = new Map(
      this.ports.listLegacy(threadId).map((item) => [item.childRunId, item]),
    );
    for (const item of this.ports.listStored(threadId)) records.set(item.childRunId, item);
    return [...records.values()]
      .map((item) => item.status === 'running' ? this.ports.reconcile(item) : item)
      .sort(
        (a, b) =>
          a.updatedAt.localeCompare(b.updatedAt) || a.childRunId.localeCompare(b.childRunId),
      );
  }

  getByThread(threadId: string, childRunId: string): DelegatedRunRecord | undefined {
    const stored = this.ports.getStored(childRunId);
    if (stored) {
      if (stored.threadId !== threadId) return undefined;
      return stored.status === 'running' ? this.ports.reconcile(stored) : stored;
    }
    const legacy = this.ports.getLegacy(threadId, childRunId);
    if (!legacy || legacy.threadId !== threadId) return undefined;
    return legacy.status === 'running' ? this.ports.reconcile(legacy) : legacy;
  }

  query(threadId: string, args: Record<string, unknown>): Record<string, unknown> {
    const offset =
      typeof args.offset === 'number' && Number.isSafeInteger(args.offset) && args.offset >= 0
        ? args.offset
        : 0;
    if (typeof args.childRunId === 'string') {
      const item = this.getByThread(threadId, args.childRunId);
      if (!item) return { ok: false, error: 'Delegated task not found in this conversation.' };
      const text = item.result ?? '';
      return {
        ok: true,
        ...item,
        result: text.slice(offset, offset + 8_000),
        resultCharacters: text.length,
        ...(offset + 8_000 < text.length ? { nextOffset: offset + 8_000 } : {}),
      };
    }
    const records = this.listByThread(threadId);
    return {
      ok: true,
      total: records.length,
      tasks: records
        .slice(offset, offset + 50)
        .map(({ result, ...item }) => ({ ...item, hasResult: Boolean(result?.trim()) })),
      ...(offset + 50 < records.length ? { nextOffset: offset + 50 } : {}),
    };
  }

}
