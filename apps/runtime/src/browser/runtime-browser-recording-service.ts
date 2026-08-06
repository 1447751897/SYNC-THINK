import { randomUUID } from 'node:crypto';
import { BROWSER_RECORDING_MAX_STEPS, type BrowserRecordingStepRecord } from '@sync-think/shared';
import type { BrowserRecordingRecord, SqliteBrowserStore } from '@sync-think/storage';
import type { BrowserRecordingSummary } from '@sync-think/protocol';
import type {
  BrowserHostLike,
  BrowserRecordingMutation,
  BrowserRecordingTerminationReason,
} from '@sync-think/workers';

export interface RuntimeBrowserRecordingServiceOptions {
  store: SqliteBrowserStore;
  host: BrowserHostLike;
}

export class RuntimeBrowserRecordingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options);
    this.name = 'RuntimeBrowserRecordingError';
  }
}

export class RuntimeBrowserRecordingService {
  private readonly store: SqliteBrowserStore;
  private readonly host: BrowserHostLike;
  private readonly mutationTails = new Map<string, Promise<void>>();
  private readonly stopOperations = new Map<string, Promise<BrowserRecordingSummary>>();

  constructor(options: RuntimeBrowserRecordingServiceOptions) {
    this.store = options.store;
    this.host = options.host;
  }

  listRecordings(input: { profileId: string; limit?: number }): BrowserRecordingSummary[] {
    return this.store
      .listRecordings(input.profileId, { limit: input.limit })
      .map(toPublicRecording);
  }

  async getRecording(input: {
    recordingId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<{ recording: BrowserRecordingSummary; steps: BrowserRecordingStepRecord[] }> {
    const recording = this.requireRecording(input.recordingId);
    return {
      recording: toPublicRecording(recording),
      steps: this.store.listRecordingSteps(recording.id, {
        afterSequence: input.afterSequence,
        limit: input.limit,
      }),
    };
  }

  async startRecording(input: {
    profileId: string;
    expectedProfileRevision: number;
    startUrl?: string;
    draftId?: string;
  }): Promise<BrowserRecordingSummary> {
    if (!this.host.startRecording || !this.host.stopRecording) {
      throw new RuntimeBrowserRecordingError(
        'browser.recording-host-unavailable',
        'The Browser Host does not support semantic recording.',
      );
    }
    const recordingId = `recording-${randomUUID()}`;
    const ownerId = `recording:${recordingId}`;
    const intent = this.store.createRecording({
      id: recordingId,
      profileId: input.profileId,
      ownerId,
      expectedProfileRevision: input.expectedProfileRevision,
      ...(input.startUrl ? { startUrl: input.startUrl } : {}),
    });
    let lease: Awaited<ReturnType<BrowserHostLike['acquireLease']>> | undefined;
    try {
      if (input.draftId) {
        this.store.attachWorkflowDraftRecording({
          draftId: input.draftId,
          recordingId: intent.id,
        });
      }
      lease = await this.host.acquireLease({
        profileId: intent.profileId,
        ownerId,
        mode: 'recording',
      });
      const started = this.store.markRecordingStarted({
        id: intent.id,
        leaseId: lease.leaseId,
        pageId: lease.pageId,
        ...(intent.startUrl ? { currentUrl: intent.startUrl } : {}),
      });
      await this.host.startRecording({
        leaseId: lease.leaseId,
        ...(started.startUrl ? { startUrl: started.startUrl } : {}),
        maxSteps: BROWSER_RECORDING_MAX_STEPS,
        onMutation: (mutation) => this.enqueueMutation(started.id, mutation),
        onStopRequested: () => {
          void this.runStop(started.id, {
            status: 'stopped',
            stopReason: 'user',
          });
        },
        onTerminated: (reason) => {
          void this.handleHostTermination(started.id, reason);
        },
      });
      return toPublicRecording(this.requireRecording(started.id));
    } catch (error) {
      const code = errorCode(error, 'browser.recording-start-failed');
      try {
        this.store.beginRecordingStop(intent.id, { stopReason: 'start_failed' });
        if (lease) {
          await this.host.stopRecording?.(lease.leaseId).catch(() => undefined);
          await this.host.releaseLease(lease.leaseId, { closePage: true });
        }
        this.store.finishRecording(intent.id, {
          status: 'failed',
          stopReason: 'start_failed',
          errorCode: code,
        });
      } catch (cleanupError) {
        throw new RuntimeBrowserRecordingError(
          code,
          'Browser recording failed to start and cleanup is pending.',
          { cause: cleanupError },
        );
      }
      throw new RuntimeBrowserRecordingError(code, 'Browser recording failed to start.', {
        cause: error,
      });
    }
  }

  stopRecording(input: { recordingId: string }): Promise<BrowserRecordingSummary> {
    return this.runStop(input.recordingId, {
      status: 'stopped',
      stopReason: 'user',
    });
  }

  async recoverInterruptedRecordings(): Promise<{
    interruptedRecordingIds: string[];
    failedRecordingIds: string[];
  }> {
    const interruptedRecordingIds: string[] = [];
    const failedRecordingIds: string[] = [];
    for (const recording of this.store.listActiveRecordings()) {
      try {
        this.store.beginRecordingStop(recording.id, { stopReason: 'runtime_restarted' });
        await this.cleanupRecordingResources(recording, true);
        this.store.finishRecording(recording.id, {
          status: 'interrupted',
          stopReason: 'runtime_restarted',
          errorCode: 'browser.recording-runtime-restarted',
        });
        interruptedRecordingIds.push(recording.id);
      } catch {
        failedRecordingIds.push(recording.id);
      }
    }
    return { interruptedRecordingIds, failedRecordingIds };
  }

  private enqueueMutation(recordingId: string, mutation: BrowserRecordingMutation): Promise<void> {
    const previous = this.mutationTails.get(recordingId) ?? Promise.resolve();
    const current = previous.then(() => {
      if (mutation.type === 'replace-last') {
        this.store.replaceLastRecordingStep({ recordingId, step: mutation.step });
      } else {
        this.store.appendRecordingStep({ recordingId, step: mutation.step });
      }
    });
    const settled = current.then(
      () => undefined,
      () => undefined,
    );
    this.mutationTails.set(recordingId, settled);
    void settled.finally(() => {
      if (this.mutationTails.get(recordingId) === settled) {
        this.mutationTails.delete(recordingId);
      }
    });
    return current;
  }

  private runStop(
    recordingId: string,
    terminal: {
      status: 'stopped' | 'failed' | 'interrupted';
      stopReason: 'user' | 'step_limit' | 'page_closed' | 'browser_closed' | 'capture_failed';
      errorCode?: string;
    },
  ): Promise<BrowserRecordingSummary> {
    const existing = this.stopOperations.get(recordingId);
    if (existing) return existing;
    const operation = this.stopRecordingInternal(recordingId, terminal);
    this.stopOperations.set(recordingId, operation);
    void operation
      .finally(() => {
        if (this.stopOperations.get(recordingId) === operation) {
          this.stopOperations.delete(recordingId);
        }
      })
      .catch(() => undefined);
    return operation;
  }

  private async stopRecordingInternal(
    recordingId: string,
    terminal: {
      status: 'stopped' | 'failed' | 'interrupted';
      stopReason: 'user' | 'step_limit' | 'page_closed' | 'browser_closed' | 'capture_failed';
      errorCode?: string;
    },
  ): Promise<BrowserRecordingSummary> {
    let recording = this.requireRecording(recordingId);
    if (isTerminal(recording.status)) return toPublicRecording(recording);
    recording = this.store.beginRecordingStop(recording.id, {
      stopReason: terminal.stopReason,
    });
    await this.cleanupRecordingResources(recording, false);
    await this.mutationTails.get(recording.id);
    const finished = this.store.finishRecording(recording.id, terminal);
    return toPublicRecording(finished);
  }

  private async cleanupRecordingResources(
    recording: BrowserRecordingRecord,
    recoverLease: boolean,
  ): Promise<void> {
    if (!recording.leaseId || !recording.pageId) {
      await this.host.closeProfileSession?.(recording.profileId);
      return;
    }
    if (recoverLease && this.host.recoverLease) {
      try {
        await this.host.recoverLease({
          leaseId: recording.leaseId,
          pageId: recording.pageId,
          profileId: recording.profileId,
          ownerId: recording.ownerId,
        });
      } catch (error) {
        if (!isMissingLeaseError(error)) throw error;
        await this.host.closeProfileSession?.(recording.profileId);
        return;
      }
    }
    await this.host.stopRecording?.(recording.leaseId);
    await this.host.releaseLease(recording.leaseId, { closePage: true });
  }

  private async handleHostTermination(
    recordingId: string,
    reason: BrowserRecordingTerminationReason,
  ): Promise<void> {
    const terminal =
      reason === 'step_limit'
        ? ({ status: 'stopped', stopReason: 'step_limit' } as const)
        : reason === 'capture_failed'
          ? ({
              status: 'failed',
              stopReason: 'capture_failed',
              errorCode: 'browser.recording-capture-failed',
            } as const)
          : ({
              status: 'interrupted',
              stopReason: reason,
              errorCode: `browser.recording-${reason.replace('_', '-')}`,
            } as const);
    await this.runStop(recordingId, terminal).catch(() => undefined);
  }

  private requireRecording(recordingId: string): BrowserRecordingRecord {
    const recording = this.store.getRecording(recordingId);
    if (!recording) {
      throw new RuntimeBrowserRecordingError(
        'browser.recording-not-found',
        'The requested Browser recording does not exist.',
      );
    }
    return recording;
  }
}

function toPublicRecording(recording: BrowserRecordingRecord): BrowserRecordingSummary {
  return {
    id: recording.id,
    profileId: recording.profileId,
    status: recording.status,
    revision: recording.revision,
    stepCount: recording.stepCount,
    ...(recording.startUrl ? { startUrl: recording.startUrl } : {}),
    ...(recording.currentUrl ? { currentUrl: recording.currentUrl } : {}),
    ...(recording.stopReason ? { stopReason: recording.stopReason } : {}),
    ...(recording.errorCode ? { errorCode: recording.errorCode } : {}),
    createdAt: recording.createdAt,
    ...(recording.startedAt ? { startedAt: recording.startedAt } : {}),
    ...(recording.stoppedAt ? { stoppedAt: recording.stoppedAt } : {}),
    updatedAt: recording.updatedAt,
  };
}

function isTerminal(status: BrowserRecordingRecord['status']): boolean {
  return status === 'stopped' || status === 'failed' || status === 'interrupted';
}

function errorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '').trim();
    if (/^browser\.[a-z0-9._-]{1,120}$/u.test(code)) return code;
  }
  if (error instanceof Error) {
    const code = /^(browser\.[a-z0-9._-]{1,120})(?::|$)/u.exec(error.message.trim())?.[1];
    if (code) return code;
  }
  return fallback;
}

function isMissingLeaseError(error: unknown): boolean {
  return (
    errorCode(error, '') === 'browser.lease-not-found' ||
    String((error as Error | undefined)?.message ?? '').includes('browser.lease-not-found')
  );
}
