import type { Event, RunId } from '@sync-think/shared';

export interface FormalPlanEventPort {
  listEventsByRun(runId: RunId): readonly Pick<Event, 'type' | 'payload'>[];
}

export class FormalPlanRevisionRegistry {
  private readonly revisions = new Map<string, number>();

  constructor(private readonly events?: FormalPlanEventPort) {}

  get(runId: RunId): number | undefined {
    const cached = this.revisions.get(runId);
    if (cached !== undefined) return cached;
    const events = this.events?.listEventsByRun(runId) ?? [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.type !== 'conversation.plan_submitted') continue;
      const revision = event.payload?.revision;
      if (!isFormalPlanRevision(revision)) continue;
      this.revisions.set(runId, revision);
      return revision;
    }
    return undefined;
  }

  record(runId: RunId, revision: number): void {
    if (!isFormalPlanRevision(revision)) {
      throw new Error(`Invalid formal plan revision: ${revision}`);
    }
    this.revisions.set(runId, revision);
  }

  delete(runId: RunId): void {
    this.revisions.delete(runId);
  }
}

function isFormalPlanRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
