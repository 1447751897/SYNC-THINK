export interface ConversationCompactBoundary {
  summaryText: string;
  compactedAt: string;
}

export interface CompactBoundaryEvent {
  type: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  sequence: number;
}

export interface CompactBoundaryEventPort {
  loadEvents(threadId: string): readonly CompactBoundaryEvent[];
}

export class ConversationCompactBoundaryCache {
  private readonly boundaries = new Map<string, ConversationCompactBoundary>();

  constructor(private readonly events?: CompactBoundaryEventPort) {}

  get(threadId: string): ConversationCompactBoundary | undefined {
    const cached = this.boundaries.get(threadId);
    if (cached) return { ...cached };
    let latest:
      | (ConversationCompactBoundary & {
          sequence: number;
        })
      | undefined;
    for (const event of this.events?.loadEvents(threadId) ?? []) {
      if (event.type !== 'context.compacted' || event.payload.threadId !== threadId) continue;
      const summaryText =
        typeof event.payload.summaryText === 'string' ? event.payload.summaryText.trim() : '';
      if (!summaryText || (latest && latest.sequence >= event.sequence)) continue;
      latest = { summaryText, compactedAt: event.occurredAt, sequence: event.sequence };
    }
    if (!latest) return undefined;
    const boundary = { summaryText: latest.summaryText, compactedAt: latest.compactedAt };
    this.boundaries.set(threadId, boundary);
    return { ...boundary };
  }

  record(threadId: string, boundary: ConversationCompactBoundary): void {
    this.boundaries.set(threadId, { ...boundary });
  }
}
