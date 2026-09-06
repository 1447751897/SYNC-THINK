import type { EventDraft, EventDraftBatch } from '@sync-think/storage';
import { parseDemoRuns, serializeDemoRun, type DemoRunState } from './demo-run.js';
import {
  diffRunStateSnapshots,
  prepareRunState,
  type RunStateSnapshot,
} from './run-state-delta.js';

const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.paused']);
const PROJECTION_FIELDS = [
  'runId',
  'threadId',
  'kernelId',
  'modelId',
  'providerModelId',
  'providerId',
  'agentVersionId',
  'globalAgentId',
  'globalAgentName',
  'teamId',
  'teamName',
  'resolutionSource',
  'credentialRefId',
  'contextWindow',
  'modelContextWindow',
  'contextWindowOverride',
  'effectiveContextWindow',
  'contextWindowSource',
  'kernelContextWindowLimit',
  'kernelSessionPlan',
  'retryCount',
] as const;

function snapshot(input: unknown): RunStateSnapshot | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Partial<DemoRunState>;
  if (
    typeof value.runId !== 'string' ||
    typeof value.threadId !== 'string' ||
    typeof value.userText !== 'string' ||
    typeof value.modelId !== 'string' ||
    typeof value.assistantText !== 'string' ||
    typeof value.nextAdapterEventIndex !== 'number'
  )
    return undefined;
  return prepareRunState(serializeDemoRun(parseDemoRuns([value])[0]!));
}

function projection(state: RunStateSnapshot['value']): Record<string, unknown> {
  return Object.fromEntries(
    PROJECTION_FIELDS.flatMap((key) => (state[key] === undefined ? [] : [[key, state[key]]])),
  );
}

export class DemoRunPersistenceJournal {
  private snapshots = new Map<string, RunStateSnapshot>();
  private revision = 0;

  rollbackOnFailure<T>(operation: () => T): T {
    const snapshots = new Map(this.snapshots);
    try {
      return operation();
    } catch (error) {
      this.snapshots = snapshots;
      this.revision += 1;
      throw error;
    }
  }

  stage(events: EventDraftBatch): {
    events: EventDraftBatch;
    commit(checkpointWritten: boolean): void;
  } {
    const revision = this.revision;
    const snapshots = new Map(this.snapshots);
    const prepare = (event: EventDraft) => {
      const current = snapshot(event.payload.run);
      let result = event;
      if (current) {
        if (current.value.runId !== event.runId) throw new Error('run-state.identity-mismatch');
        if (Object.hasOwn(event.payload, 'runStateDelta'))
          throw new Error('run-state.reserved-field');
        const previous = snapshots.get(event.runId!);
        const fullBytes = Buffer.byteLength(JSON.stringify({ run: event.payload.run }), 'utf8');
        if (previous && previous.value.threadId === current.value.threadId && fullBytes >= 4096) {
          const compact = {
            run: projection(current.value),
            runStateDelta: diffRunStateSnapshots(previous, current),
          };
          if (Buffer.byteLength(JSON.stringify(compact), 'utf8') < fullBytes) {
            result = { ...event, payload: { ...event.payload, ...compact } };
          }
        }
        snapshots.set(event.runId!, current);
      }
      if (event.runId && TERMINAL_EVENTS.has(event.type)) snapshots.delete(event.runId);
      return result;
    };
    const prepared: EventDraftBatch = [prepare(events[0]), ...events.slice(1).map(prepare)];
    return {
      events: prepared,
      commit: (checkpointWritten) => {
        if (this.revision !== revision) throw new Error('run-state.stale-stage');
        this.snapshots = checkpointWritten ? new Map() : snapshots;
        this.revision += 1;
      },
    };
  }

  forget(runId: string): void {
    if (this.snapshots.delete(runId)) this.revision += 1;
  }
}
