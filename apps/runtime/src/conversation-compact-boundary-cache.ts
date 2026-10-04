export interface ConversationCompactBoundary {
  summaryText: string;
  compactedAt: string;
  /** Canonical durable Message.sequence, never Event.sequence or wall-clock time. */
  coveredThroughMessageSequence?: number;
  /** Exact legacy event nodes shadowed by this checkpoint. */
  coveredEventSequences?: number[];
  /** Compatibility hint for old timestamp-only boundaries. */
  keepRecent?: number;
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
    if (cached) return structuredClone(cached);
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
      const through = event.payload.coveredThroughMessageSequence;
      const covered = event.payload.coveredEventSequences;
      if (through !== undefined && (!Number.isSafeInteger(through) || Number(through) < 0)) continue;
      if (covered !== undefined && (!Array.isArray(covered) || covered.some(value => !Number.isSafeInteger(value) || value < 0))) continue;
      latest = { summaryText, compactedAt: event.occurredAt, sequence: event.sequence,
        ...(typeof through === 'number' ? { coveredThroughMessageSequence: through } : {}),
        ...(Array.isArray(covered) ? { coveredEventSequences: [...covered] as number[] } : {}),
        ...(typeof event.payload.keepRecent === 'number' ? { keepRecent: event.payload.keepRecent } : {}),
      };
    }
    if (!latest) return undefined;
    const { sequence: _eventSequence, ...boundary } = latest;
    this.boundaries.set(threadId, boundary);
    return structuredClone(boundary);
  }

  record(threadId: string, boundary: ConversationCompactBoundary): void {
    this.boundaries.set(threadId, structuredClone(boundary));
  }
}
