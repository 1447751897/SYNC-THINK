import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteBrowserStore } from '@sync-think/storage';
import type {
  BrowserHostLike,
  BrowserLeaseInfo,
  BrowserRecordingMutation,
  BrowserRecordingTerminationReason,
} from '@sync-think/workers';
import { RuntimeBrowserRecordingService } from './runtime-browser-recording-service.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-recording-service-'));
  tempDirs.push(root);
  const databasePath = join(root, 'sync-think.db');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  const store = new SqliteBrowserStore(connection.raw);
  const lease: BrowserLeaseInfo = {
    leaseId: 'lease-recording-1',
    pageId: 'page-recording-1',
    profileId: 'default',
    ownerId: 'recording:pending',
  };
  let onMutation: ((mutation: BrowserRecordingMutation) => void | Promise<void>) | undefined;
  let onStopRequested: (() => void | Promise<void>) | undefined;
  let onTerminated:
    ((reason: BrowserRecordingTerminationReason) => void | Promise<void>) | undefined;
  const host: BrowserHostLike = {
    acquireLease: vi.fn(async ({ profileId, ownerId, mode }) => {
      expect(mode).toBe('recording');
      expect(store.hasActiveProfileRecording(profileId)).toBe(true);
      return { ...lease, profileId, ownerId };
    }),
    inspectLease: vi.fn(async () => lease),
    recoverLease: vi.fn(async (input) => input),
    execute: vi.fn(async () => {
      throw new Error('not used');
    }),
    startRecording: vi.fn(async (input) => {
      onMutation = input.onMutation;
      onStopRequested = input.onStopRequested;
      onTerminated = input.onTerminated;
    }),
    stopRecording: vi.fn(async () => undefined),
    releaseLease: vi.fn(async () => undefined),
    closeProfileSession: vi.fn(async () => undefined),
    hasActiveProfileLeases: vi.fn(() => false),
    shutdown: vi.fn(async () => undefined),
  };
  const service = new RuntimeBrowserRecordingService({ store, host });
  return {
    connection,
    store,
    host,
    service,
    lease,
    emit: async (mutation: BrowserRecordingMutation) => onMutation?.(mutation),
    requestStop: async () => onStopRequested?.(),
    terminate: async (reason: BrowserRecordingTerminationReason) => onTerminated?.(reason),
  };
}

describe('RuntimeBrowserRecordingService', () => {
  it('binds a new recording to its workflow draft before acquiring the browser lease', async () => {
    const f = await fixture();
    try {
      const workflow = f.store.createAutomationTaskDraft({
        id: 'browser-task-runtime-binding',
        draftId: 'browser-draft-runtime-binding',
        profileId: 'default',
        name: 'Runtime binding',
        instruction: 'Bind the recording intent before Chrome starts.',
        startUrl: 'https://example.test/runtime-binding',
        source: 'manual',
      });
      const recording = await f.service.startRecording({
        profileId: 'default',
        expectedProfileRevision: 1,
        startUrl: workflow.task.startUrl,
        draftId: workflow.draft.id,
      });

      expect(f.store.getWorkflowDraft(workflow.draft.id)).toMatchObject({
        recordingId: recording.id,
        status: 'editing',
        stepCount: 0,
      });
      expect(f.host.acquireLease).toHaveBeenCalledTimes(1);
    } finally {
      f.connection.raw.close();
    }
  });

  it('persists intent before the browser lease and returns only a sanitized public summary', async () => {
    const f = await fixture();
    try {
      const recording = await f.service.startRecording({
        profileId: 'default',
        expectedProfileRevision: 1,
        startUrl: 'https://example.test/start?token=secret#fragment',
      });
      expect(recording).toMatchObject({
        profileId: 'default',
        status: 'recording',
        revision: 2,
        startUrl: 'https://example.test/start',
        stepCount: 0,
      });
      expect(recording).not.toHaveProperty('ownerId');
      expect(recording).not.toHaveProperty('leaseId');
      expect(recording).not.toHaveProperty('pageId');
      expect(f.host.acquireLease).toHaveBeenCalledWith({
        profileId: 'default',
        ownerId: `recording:${recording.id}`,
        mode: 'recording',
      });
      expect(f.host.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          leaseId: f.lease.leaseId,
          startUrl: 'https://example.test/start',
          maxSteps: 200,
        }),
      );
    } finally {
      f.connection.raw.close();
    }
  });

  it('persists append/replace mutations in order and drains the last mutation before stop', async () => {
    const f = await fixture();
    try {
      const recording = await f.service.startRecording({
        profileId: 'default',
        expectedProfileRevision: 1,
      });
      await f.emit({
        type: 'append',
        step: {
          kind: 'fill',
          locator: { strategy: 'label', value: 'Search' },
          value: { kind: 'literal', value: 'sync' },
        },
      });
      await f.emit({
        type: 'replace-last',
        step: {
          kind: 'fill',
          locator: { strategy: 'label', value: 'Search' },
          value: { kind: 'literal', value: 'sync-think' },
        },
      });
      f.host.stopRecording = vi.fn(async () => {
        expect(f.store.getRecording(recording.id)?.status).toBe('stopping');
        await f.emit({
          type: 'append',
          step: { kind: 'navigate', url: 'https://example.test/done?secret=hidden' },
        });
      });

      const stopped = await f.service.stopRecording({ recordingId: recording.id });
      expect(stopped).toMatchObject({ status: 'stopped', stopReason: 'user', stepCount: 2 });
      expect(f.host.releaseLease).toHaveBeenCalledWith(f.lease.leaseId, { closePage: true });
      await expect(f.service.getRecording({ recordingId: recording.id })).resolves.toMatchObject({
        recording: { status: 'stopped', stepCount: 2 },
        steps: [
          {
            sequence: 1,
            step: { kind: 'fill', value: { kind: 'literal', value: 'sync-think' } },
          },
          { sequence: 2, step: { kind: 'navigate', url: 'https://example.test/done' } },
        ],
      });
    } finally {
      f.connection.raw.close();
    }
  });

  it('stops with the user reason when the in-page recording overlay requests it', async () => {
    const f = await fixture();
    try {
      const recording = await f.service.startRecording({
        profileId: 'default',
        expectedProfileRevision: 1,
      });
      await f.requestStop();
      await vi.waitFor(() =>
        expect(f.store.getRecording(recording.id)).toMatchObject({
          status: 'stopped',
          stopReason: 'user',
        }),
      );
      expect(f.host.stopRecording).toHaveBeenCalledWith(f.lease.leaseId);
      expect(f.host.releaseLease).toHaveBeenCalledWith(f.lease.leaseId, { closePage: true });
    } finally {
      f.connection.raw.close();
    }
  });

  it('marks the draft interrupted and releases resources when the user closes the Page', async () => {
    const f = await fixture();
    try {
      const recording = await f.service.startRecording({
        profileId: 'default',
        expectedProfileRevision: 1,
      });
      await f.terminate('page_closed');
      await vi.waitFor(() =>
        expect(f.store.getRecording(recording.id)).toMatchObject({
          status: 'interrupted',
          stopReason: 'page_closed',
        }),
      );
      expect(f.host.releaseLease).toHaveBeenCalledWith(f.lease.leaseId, { closePage: true });
    } finally {
      f.connection.raw.close();
    }
  });

  it('clears a failed stop operation so the same recording can be retried', async () => {
    const f = await fixture();
    try {
      const recording = await f.service.startRecording({
        profileId: 'default',
        expectedProfileRevision: 1,
      });
      f.host.stopRecording = vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary stop failure'))
        .mockResolvedValueOnce(undefined);

      await expect(f.service.stopRecording({ recordingId: recording.id })).rejects.toThrow(
        'temporary stop failure',
      );
      await expect(f.service.stopRecording({ recordingId: recording.id })).resolves.toMatchObject({
        status: 'stopped',
        stopReason: 'user',
      });
      expect(f.host.stopRecording).toHaveBeenCalledTimes(2);
    } finally {
      f.connection.raw.close();
    }
  });

  it('compensates a Host start failure without leaving the Profile claimed', async () => {
    const f = await fixture();
    try {
      const workflow = f.store.createAutomationTaskDraft({
        id: 'browser-task-start-failure',
        draftId: 'browser-draft-start-failure',
        profileId: 'default',
        name: 'Start failure',
        instruction: 'Keep the failed recording bound for durable reconciliation.',
        startUrl: 'https://example.test/start-failure',
        source: 'manual',
      });
      f.host.startRecording = vi.fn(async () => {
        throw Object.assign(new Error('driver unavailable'), {
          code: 'browser.recording-unsupported',
        });
      });
      await expect(
        f.service.startRecording({
          profileId: 'default',
          expectedProfileRevision: 1,
          draftId: workflow.draft.id,
        }),
      ).rejects.toThrow('browser.recording-unsupported');
      expect(f.store.hasActiveProfileRecording('default')).toBe(false);
      expect(f.store.listRecordings('default')).toMatchObject([
        { status: 'failed', stopReason: 'start_failed' },
      ]);
      const failed = f.store.listRecordings('default')[0]!;
      expect(f.store.getWorkflowDraft(workflow.draft.id)).toMatchObject({
        recordingId: failed.id,
        status: 'editing',
      });
      expect(f.host.releaseLease).toHaveBeenCalledWith(f.lease.leaseId, { closePage: true });
    } finally {
      f.connection.raw.close();
    }
  });

  it('compensates a workflow/Profile binding mismatch before the Host is touched', async () => {
    const f = await fixture();
    try {
      const workflow = f.store.createAutomationTaskDraft({
        id: 'browser-task-profile-mismatch',
        draftId: 'browser-draft-profile-mismatch',
        profileId: 'default',
        name: 'Profile mismatch',
        instruction: 'Reject recordings created from another browser profile.',
        startUrl: 'https://example.test/profile-mismatch',
        source: 'manual',
      });
      const otherProfile = f.store.createProfile({
        id: 'profile-runtime-other',
        name: 'Runtime Other',
      });

      await expect(
        f.service.startRecording({
          profileId: otherProfile.id,
          expectedProfileRevision: otherProfile.revision,
          draftId: workflow.draft.id,
        }),
      ).rejects.toThrow('browser.workflow_recording_profile_mismatch');

      expect(f.host.acquireLease).not.toHaveBeenCalled();
      expect(f.store.listRecordings(otherProfile.id)).toMatchObject([
        {
          status: 'failed',
          stopReason: 'start_failed',
          errorCode: 'browser.workflow_recording_profile_mismatch',
        },
      ]);
      const unchangedDraft = f.store.getWorkflowDraft(workflow.draft.id);
      expect(unchangedDraft).toMatchObject({ status: 'editing' });
      expect(unchangedDraft).not.toHaveProperty('recordingId');
    } finally {
      f.connection.raw.close();
    }
  });

  it('does not close an unrelated Profile session when lease acquisition is rejected', async () => {
    const f = await fixture();
    try {
      f.host.acquireLease = vi.fn(async () => {
        throw Object.assign(new Error('existing Page lease'), {
          code: 'browser.profile-in-use',
        });
      });
      f.host.closeProfileSession = vi.fn(async () => {
        throw Object.assign(new Error('unrelated Page is active'), {
          code: 'browser.profile-in-use',
        });
      });

      await expect(
        f.service.startRecording({ profileId: 'default', expectedProfileRevision: 1 }),
      ).rejects.toThrow('browser.profile-in-use');

      expect(f.host.closeProfileSession).not.toHaveBeenCalled();
      expect(f.store.hasActiveProfileRecording('default')).toBe(false);
      expect(f.store.listRecordings('default')).toMatchObject([
        {
          status: 'failed',
          stopReason: 'start_failed',
          errorCode: 'browser.profile-in-use',
        },
      ]);
    } finally {
      f.connection.raw.close();
    }
  });

  it('interrupts cold-start leftovers, recovering exact leases or closing orphan sessions', async () => {
    const f = await fixture();
    try {
      const withLease = f.store.createRecording({
        id: 'recording-recover-lease',
        profileId: 'default',
        ownerId: 'recording:recording-recover-lease',
        expectedProfileRevision: 1,
      });
      f.store.markRecordingStarted({
        id: withLease.id,
        leaseId: 'lease-recover',
        pageId: 'page-recover',
      });
      const otherProfile = f.store.createProfile({ id: 'profile-orphan', name: 'Orphan' });
      f.store.createRecording({
        id: 'recording-recover-orphan',
        profileId: otherProfile.id,
        ownerId: 'recording:recording-recover-orphan',
        expectedProfileRevision: otherProfile.revision,
      });

      await expect(f.service.recoverInterruptedRecordings()).resolves.toEqual({
        interruptedRecordingIds: ['recording-recover-lease', 'recording-recover-orphan'],
        failedRecordingIds: [],
      });
      expect(f.host.recoverLease).toHaveBeenCalledWith({
        leaseId: 'lease-recover',
        pageId: 'page-recover',
        profileId: 'default',
        ownerId: 'recording:recording-recover-lease',
      });
      expect(f.host.closeProfileSession).toHaveBeenCalledWith('profile-orphan');
      expect(f.store.listActiveRecordings()).toEqual([]);
      expect(f.store.getRecording(withLease.id)).toMatchObject({
        status: 'interrupted',
        stopReason: 'runtime_restarted',
      });
    } finally {
      f.connection.raw.close();
    }
  });
});
