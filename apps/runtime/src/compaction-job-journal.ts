export interface CompactionJob {
  threadId: string;
  operationId: string;
  conversationId: string;
  taskId: string;
  ownerId: string;
  leaseExpiresAt: number;
  modelBinding: string;
  sourceFingerprint: string;
  boundaryFingerprint: string;
  coveredThroughMessageSequence?: number;
}
interface JobEvent {
  type: string;
  payload: Record<string, unknown>;
}
function parseJob(value: unknown): CompactionJob | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const p = value as Record<string, unknown>;
  const fields = [
    'threadId',
    'operationId',
    'conversationId',
    'taskId',
    'ownerId',
    'modelBinding',
    'sourceFingerprint',
    'boundaryFingerprint',
  ] as const;
  if (
    fields.some((field) => typeof p[field] !== 'string' || !p[field]) ||
    !Number.isSafeInteger(p.leaseExpiresAt) ||
    Number(p.leaseExpiresAt) <= 0 ||
    !/^[a-f0-9]{64}$/.test(String(p.sourceFingerprint)) ||
    !/^[a-f0-9]{64}$/.test(String(p.boundaryFingerprint)) ||
    (p.coveredThroughMessageSequence !== undefined &&
      (!Number.isSafeInteger(p.coveredThroughMessageSequence) ||
        Number(p.coveredThroughMessageSequence) < 0))
  )
    return undefined;
  return Object.fromEntries([
    ...fields.map((field) => [field, p[field]]),
    ['leaseExpiresAt', p.leaseExpiresAt],
    ...(p.coveredThroughMessageSequence === undefined
      ? []
      : [['coveredThroughMessageSequence', p.coveredThroughMessageSequence]]),
  ]) as unknown as CompactionJob;
}
/** Durable ownership metadata only: raw transcript remains authoritative, and interrupted jobs never auto-rebill. */
export class CompactionJobJournal {
  private jobs = new Map<string, CompactionJob>();
  apply(event: JobEvent): void {
    if (event.type === 'context.compaction_started') {
      const job = parseJob(event.payload);
      if (job) this.jobs.set(job.threadId, job);
      return;
    }
    if (
      !['context.compacted', 'context.compaction_failed', 'context.compaction_skipped'].includes(
        event.type,
      )
    )
      return;
    const thread = String(event.payload.threadId ?? '');
    if (this.jobs.get(thread)?.operationId === event.payload.operationId) this.jobs.delete(thread);
  }
  restore(values: unknown): void {
    this.jobs.clear();
    if (Array.isArray(values))
      for (const value of values) {
        const job = parseJob(value);
        if (job) this.jobs.set(job.threadId, job);
      }
  }
  snapshot(): CompactionJob[] {
    return structuredClone([...this.jobs.values()]);
  }
  pending(): CompactionJob[] {
    return this.snapshot();
  }
  stage(events: readonly JobEvent[]): CompactionJob[] {
    const staged = new CompactionJobJournal();
    staged.restore(this.snapshot());
    for (const event of events) staged.apply(event);
    return staged.snapshot();
  }
  owns(thread: string, operation: string, owner: string, now: number): boolean {
    const job = this.jobs.get(thread);
    return (
      !!job && job.operationId === operation && job.ownerId === owner && job.leaseExpiresAt >= now
    );
  }
}
