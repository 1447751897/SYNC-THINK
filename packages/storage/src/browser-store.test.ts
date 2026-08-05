import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabaseAsync } from './connection.js';
import { SqliteBrowserStore } from './browser-store.js';
import { runMigrations } from './scripts/migrate.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function openStore(): Promise<{
  store: SqliteBrowserStore;
  close(): void;
}> {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-store-'));
  tempDirs.push(root);
  const path = join(root, 'sync-think.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  return {
    store: new SqliteBrowserStore(connection.raw),
    close: () => connection.raw.close(),
  };
}

function reserveCompletedBrowserCommand(store: SqliteBrowserStore) {
  const command = store.reserveCommand({
    id: 'browser-command-open',
    idempotencyKey: 'browser:run-1:step-1:open',
    workspaceId: 'workspace-1',
    runId: 'run-1',
    ownerId: 'step:step-1:agent-version-1',
    profileId: 'default',
    toolName: 'browser_open',
    action: 'navigate',
    targetOrigin: 'https://example.test',
    sanitizedArgs: { url: 'https://example.test/login' },
    now: '2026-07-31T00:00:00.000Z',
  });
  store.markApproved(command.id, '2026-07-31T00:00:01.000Z');
  store.markRunning(command.id, '2026-07-31T00:00:02.000Z');
  return store.completeCommand(
    command.id,
    { ok: true, url: 'https://example.test/login' },
    { leaseId: 'lease-1', pageId: 'page-1' },
    '2026-07-31T00:00:03.000Z',
  );
}

describe('SqliteBrowserStore durable human handoff', () => {
  it('finds the latest completed Page lease for the exact Run owner and Profile', async () => {
    const fixture = await openStore();
    try {
      const completed = reserveCompletedBrowserCommand(fixture.store);

      expect(
        fixture.store.getLastCompletedCommand({
          workspaceId: 'workspace-1',
          runId: 'run-1',
          ownerId: 'step:step-1:agent-version-1',
          profileId: 'default',
        }),
      ).toEqual(completed);
      expect(
        fixture.store.getLastCompletedCommand({
          workspaceId: 'workspace-1',
          runId: 'run-other',
          ownerId: 'step:step-1:agent-version-1',
          profileId: 'default',
        }),
      ).toBeUndefined();
    } finally {
      fixture.close();
    }
  });

  it('persists a waiting handoff with lease identity and lists it after reopening', async () => {
    const fixture = await openStore();
    const rawPath = fixture.store;
    try {
      reserveCompletedBrowserCommand(fixture.store);
      const handoff = fixture.store.reserveCommand({
        id: 'browser-command-handoff',
        idempotencyKey: 'browser:run-1:step-1:handoff',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        ownerId: 'step:step-1:agent-version-1',
        profileId: 'default',
        leaseId: 'lease-1',
        pageId: 'page-1',
        toolName: 'browser_handoff',
        action: 'handoff',
        targetOrigin: 'https://example.test',
        sanitizedArgs: {
          reason: 'login',
          requestedOutcome: 'Complete sign-in and return to the dashboard.',
          onCancel: 'keep-open',
          stepId: 'step-1',
          agentVersionId: 'agent-version-1',
        },
        now: '2026-07-31T00:00:04.000Z',
      });

      const waiting = fixture.store.markHandoffWaiting(
        handoff.id,
        { leaseId: 'lease-1', pageId: 'page-1' },
        '2026-07-31T00:00:05.000Z',
      );
      expect(waiting).toMatchObject({
        state: 'waiting_user',
        leaseId: 'lease-1',
        pageId: 'page-1',
        errorCode: 'browser.handoff-required',
      });
      expect(
        fixture.store.listWaitingHandoffs({ workspaceId: 'workspace-1', runId: 'run-1' }),
      ).toEqual([waiting]);
      expect(
        fixture.store.listWaitingHandoffs({ workspaceId: 'workspace-1', runId: 'run-other' }),
      ).toEqual([]);
      expect(rawPath).toBe(fixture.store);
    } finally {
      fixture.close();
    }
  });

  it('replays the same handoff transition but rejects lease identity replacement', async () => {
    const fixture = await openStore();
    try {
      const handoff = fixture.store.reserveCommand({
        id: 'browser-command-handoff-replay',
        idempotencyKey: 'browser:run-1:step-1:handoff-replay',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        ownerId: 'step:step-1:agent-version-1',
        profileId: 'default',
        leaseId: 'lease-1',
        pageId: 'page-1',
        toolName: 'browser_handoff',
        action: 'handoff',
        targetOrigin: 'https://example.test',
        sanitizedArgs: {
          reason: 'manual',
          requestedOutcome: 'Confirm completion.',
          onCancel: 'close-page',
        },
      });
      const first = fixture.store.markHandoffWaiting(handoff.id, {
        leaseId: 'lease-1',
        pageId: 'page-1',
      });
      expect(
        fixture.store.markHandoffWaiting(handoff.id, {
          leaseId: 'lease-1',
          pageId: 'page-1',
        }),
      ).toEqual(first);
      expect(() =>
        fixture.store.markHandoffWaiting(handoff.id, {
          leaseId: 'lease-other',
          pageId: 'page-1',
        }),
      ).toThrow('browser.handoff_lease_mismatch');
    } finally {
      fixture.close();
    }
  });
});

describe('SqliteBrowserStore Browser Profile metadata and site-session projections', () => {
  it('seeds the default Profile and applies revision-fenced create, rename, and soft delete', async () => {
    const fixture = await openStore();
    try {
      expect(fixture.store.listProfiles()).toMatchObject([
        { id: 'default', name: '默认浏览器', revision: 1, isDefault: true },
      ]);

      const created = fixture.store.createProfile({
        id: 'profile-work',
        name: '工作号',
        now: '2026-08-05T00:00:00.000Z',
      });
      expect(created).toMatchObject({
        id: 'profile-work',
        name: '工作号',
        revision: 1,
        isDefault: false,
      });

      const renamed = fixture.store.renameProfile({
        id: created.id,
        name: '运营工作号',
        expectedRevision: created.revision,
        now: '2026-08-05T00:01:00.000Z',
      });
      expect(renamed).toMatchObject({ name: '运营工作号', revision: 2 });
      expect(() =>
        fixture.store.renameProfile({
          id: created.id,
          name: '过期修改',
          expectedRevision: 1,
        }),
      ).toThrow('browser.profile_revision_conflict');

      const deleted = fixture.store.softDeleteProfile({
        id: created.id,
        expectedRevision: renamed.revision,
        now: '2026-08-05T00:02:00.000Z',
      });
      expect(deleted.deletedAt).toBe('2026-08-05T00:02:00.000Z');
      expect(fixture.store.listProfiles().map((profile) => profile.id)).toEqual(['default']);
      expect(() => fixture.store.softDeleteProfile({ id: 'default', expectedRevision: 1 })).toThrow(
        'browser.default_profile_immutable',
      );
    } finally {
      fixture.close();
    }
  });

  it('stores only bounded site-session summaries and replaces a refreshed Profile snapshot', async () => {
    const fixture = await openStore();
    try {
      fixture.store.replaceSiteSessions({
        profileId: 'default',
        checkedAt: '2026-08-05T01:00:00.000Z',
        sessions: [
          {
            siteKey: 'example.com',
            origins: ['https://app.example.com'],
            state: 'data_present',
            cookieCount: 3,
            storageBytes: 2048,
            storageTypes: ['cookies', 'local_storage'],
            lastSeenAt: '2026-08-05T00:59:00.000Z',
          },
        ],
      });

      expect(fixture.store.listSiteSessions('default')).toEqual([
        expect.objectContaining({
          profileId: 'default',
          siteKey: 'example.com',
          origins: ['https://app.example.com'],
          state: 'data_present',
          cookieCount: 3,
          storageBytes: 2048,
          storageTypes: ['cookies', 'local_storage'],
          lastCheckedAt: '2026-08-05T01:00:00.000Z',
        }),
      ]);

      fixture.store.replaceSiteSessions({
        profileId: 'default',
        checkedAt: '2026-08-05T01:10:00.000Z',
        sessions: [],
      });
      expect(fixture.store.listSiteSessions('default')).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  it('lists known origins and detects every non-terminal command for Profile deletion fences', async () => {
    const fixture = await openStore();
    try {
      const command = fixture.store.reserveCommand({
        id: 'profile-active-command',
        idempotencyKey: 'browser:profile-active-command',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        ownerId: 'owner-1',
        profileId: 'default',
        toolName: 'browser_open',
        action: 'navigate',
        targetOrigin: 'https://app.example.com',
        sanitizedArgs: { url: 'https://app.example.com/' },
        now: '2026-08-05T02:00:00.000Z',
      });
      expect(fixture.store.hasActiveProfileCommands('default')).toBe(true);
      expect(fixture.store.listKnownOrigins('default')).toEqual([
        { origin: 'https://app.example.com', lastSeenAt: '2026-08-05T02:00:00.000Z' },
      ]);

      fixture.store.markApproved(command.id, '2026-08-05T02:01:00.000Z');
      fixture.store.markRunning(command.id, '2026-08-05T02:02:00.000Z');
      fixture.store.completeCommand(
        command.id,
        { ok: true },
        undefined,
        '2026-08-05T02:03:00.000Z',
      );
      expect(fixture.store.hasActiveProfileCommands('default')).toBe(false);
    } finally {
      fixture.close();
    }
  });

  it('expires all active commands for one historical Run while preserving audit rows', async () => {
    const fixture = await openStore();
    try {
      const reserve = (suffix: string) =>
        fixture.store.reserveCommand({
          id: `expired-${suffix}`,
          idempotencyKey: `browser:expired-run:${suffix}`,
          workspaceId: 'workspace-1',
          runId: 'run-expired',
          ownerId: 'owner-1',
          profileId: 'default',
          toolName: 'browser_open',
          action: 'navigate',
          targetOrigin: 'https://example.com',
          sanitizedArgs: { url: 'https://example.com/' },
          now: '2026-08-05T02:20:00.000Z',
        });
      const requested = reserve('requested');
      const approved = reserve('approved');
      fixture.store.markApproved(approved.id, '2026-08-05T02:20:01.000Z');
      const running = reserve('running');
      fixture.store.markApproved(running.id, '2026-08-05T02:20:01.000Z');
      fixture.store.markRunning(running.id, '2026-08-05T02:20:02.000Z');
      const waiting = reserve('waiting');
      fixture.store.markApproved(waiting.id, '2026-08-05T02:20:01.000Z');
      fixture.store.markRunning(waiting.id, '2026-08-05T02:20:02.000Z');
      fixture.store.markWaitingUser(
        waiting.id,
        'browser.command-inspection-required',
        '2026-08-05T02:20:03.000Z',
      );
      const completed = reserve('completed');
      fixture.store.markApproved(completed.id, '2026-08-05T02:20:01.000Z');
      fixture.store.markRunning(completed.id, '2026-08-05T02:20:02.000Z');
      fixture.store.completeCommand(
        completed.id,
        { ok: true },
        undefined,
        '2026-08-05T02:20:03.000Z',
      );
      const otherRun = fixture.store.reserveCommand({
        id: 'other-run-command',
        idempotencyKey: 'browser:other-run-command',
        workspaceId: 'workspace-1',
        runId: 'run-other',
        ownerId: 'owner-1',
        profileId: 'default',
        toolName: 'browser_open',
        action: 'navigate',
        targetOrigin: 'https://example.com',
        sanitizedArgs: { url: 'https://example.com/' },
      });

      expect(
        fixture.store.failActiveCommandsForRun(
          'run-expired',
          'browser.command-recovery-expired',
          '2026-08-05T02:21:00.000Z',
        ),
      ).toBe(4);
      for (const command of [requested, approved, running, waiting]) {
        expect(fixture.store.getCommand(command.id)).toMatchObject({
          state: 'failed',
          errorCode: 'browser.command-recovery-expired',
          failureClass: 'acceptance',
          completedAt: '2026-08-05T02:21:00.000Z',
        });
      }
      expect(fixture.store.getCommand(completed.id)).toMatchObject({ state: 'completed' });
      expect(fixture.store.getCommand(otherRun.id)).toMatchObject({ state: 'requested' });
      expect(fixture.store.failActiveCommandsForRun('run-expired')).toBe(0);
      expect(fixture.store.hasActiveProfileCommands('default')).toBe(true);
    } finally {
      fixture.close();
    }
  });

  it('rejects new Browser commands for a soft-deleted Profile', async () => {
    const fixture = await openStore();
    try {
      const profile = fixture.store.createProfile({
        id: 'profile-expired',
        name: '过期账号',
        now: '2026-08-05T02:10:00.000Z',
      });
      fixture.store.softDeleteProfile({
        id: profile.id,
        expectedRevision: profile.revision,
        now: '2026-08-05T02:11:00.000Z',
      });
      expect(() =>
        fixture.store.reserveCommand({
          id: 'profile-expired-command',
          idempotencyKey: 'browser:profile-expired-command',
          workspaceId: 'workspace-1',
          runId: 'run-1',
          ownerId: 'owner-1',
          profileId: profile.id,
          toolName: 'browser_open',
          action: 'navigate',
          targetOrigin: 'https://example.com',
          sanitizedArgs: {},
        }),
      ).toThrow('browser.profile_not_found');
    } finally {
      fixture.close();
    }
  });
});

describe('SqliteBrowserStore durable Browser recordings', () => {
  it('claims one Profile, persists ordered semantic steps, and releases the claim on stop', async () => {
    const fixture = await openStore();
    try {
      const recording = fixture.store.createRecording({
        id: 'recording-1',
        profileId: 'default',
        ownerId: 'recording:recording-1',
        expectedProfileRevision: 1,
        startUrl: 'https://user:pass@example.test/start?token=secret#fragment',
        now: '2026-08-05T03:00:00.000Z',
      });
      expect(recording).toMatchObject({
        id: 'recording-1',
        profileId: 'default',
        status: 'starting',
        revision: 1,
        stepCount: 0,
        startUrl: 'https://example.test/start',
      });
      expect(fixture.store.hasActiveProfileRecording('default')).toBe(true);
      expect(() =>
        fixture.store.createRecording({
          id: 'recording-2',
          profileId: 'default',
          ownerId: 'recording:recording-2',
          expectedProfileRevision: 1,
        }),
      ).toThrow('browser.recording_profile_in_use');
      expect(() =>
        fixture.store.reserveCommand({
          id: 'command-during-recording',
          idempotencyKey: 'browser:command-during-recording',
          workspaceId: 'workspace-1',
          runId: 'run-1',
          ownerId: 'owner-1',
          profileId: 'default',
          toolName: 'browser_open',
          action: 'navigate',
          targetOrigin: 'https://example.test',
          sanitizedArgs: {},
        }),
      ).toThrow('browser.profile_in_use');

      const started = fixture.store.markRecordingStarted({
        id: recording.id,
        leaseId: 'lease-recording-1',
        pageId: 'page-recording-1',
        currentUrl: 'https://example.test/start',
        now: '2026-08-05T03:00:01.000Z',
      });
      expect(started).toMatchObject({ status: 'recording', revision: 2 });

      const navigate = fixture.store.appendRecordingStep({
        recordingId: recording.id,
        step: { kind: 'navigate', url: 'https://example.test/start' },
        recordedAt: '2026-08-05T03:00:02.000Z',
      });
      const fill = fixture.store.appendRecordingStep({
        recordingId: recording.id,
        step: {
          kind: 'fill',
          locator: { strategy: 'label', value: 'Search' },
          value: { kind: 'literal', value: 'sync think' },
        },
        recordedAt: '2026-08-05T03:00:03.000Z',
      });
      expect([navigate.sequence, fill.sequence]).toEqual([1, 2]);
      expect(fixture.store.listRecordingSteps(recording.id)).toMatchObject([
        { sequence: 1, step: { kind: 'navigate', url: 'https://example.test/start' } },
        {
          sequence: 2,
          step: {
            kind: 'fill',
            locator: { strategy: 'label', value: 'Search' },
            value: { kind: 'literal', value: 'sync think' },
          },
        },
      ]);

      const replaced = fixture.store.replaceLastRecordingStep({
        recordingId: recording.id,
        step: {
          kind: 'fill',
          locator: { strategy: 'label', value: 'Search' },
          value: { kind: 'literal', value: 'sync-think' },
        },
        recordedAt: '2026-08-05T03:00:04.000Z',
      });
      expect(replaced).toMatchObject({
        sequence: 2,
        step: { value: { kind: 'literal', value: 'sync-think' } },
      });
      expect(fixture.store.getRecording(recording.id)).toMatchObject({ stepCount: 2 });

      const stopping = fixture.store.beginRecordingStop(recording.id, {
        stopReason: 'user',
        now: '2026-08-05T03:00:05.000Z',
      });
      expect(stopping.status).toBe('stopping');
      const stopped = fixture.store.finishRecording(recording.id, {
        status: 'stopped',
        stopReason: 'user',
        now: '2026-08-05T03:00:06.000Z',
      });
      expect(stopped).toMatchObject({ status: 'stopped', stopReason: 'user', stepCount: 2 });
      expect(fixture.store.hasActiveProfileRecording('default')).toBe(false);
      expect(fixture.store.listActiveRecordings()).toEqual([]);

      const command = fixture.store.reserveCommand({
        id: 'command-after-recording',
        idempotencyKey: 'browser:command-after-recording',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        ownerId: 'owner-1',
        profileId: 'default',
        toolName: 'browser_open',
        action: 'navigate',
        targetOrigin: 'https://example.test',
        sanitizedArgs: {},
      });
      expect(command.state).toBe('requested');
    } finally {
      fixture.close();
    }
  });

  it('keeps secret input bodies out of the persisted step and enforces the 200 step limit', async () => {
    const fixture = await openStore();
    try {
      const recording = fixture.store.createRecording({
        id: 'recording-limit',
        profileId: 'default',
        ownerId: 'recording:recording-limit',
        expectedProfileRevision: 1,
      });
      fixture.store.markRecordingStarted({
        id: recording.id,
        leaseId: 'lease-recording-limit',
        pageId: 'page-recording-limit',
      });
      const secret = fixture.store.appendRecordingStep({
        recordingId: recording.id,
        step: {
          kind: 'fill',
          locator: { strategy: 'id', value: 'otp' },
          value: { kind: 'secret' },
        },
      });
      expect(JSON.stringify(secret)).not.toContain('123456');

      for (let index = 2; index <= 200; index += 1) {
        fixture.store.appendRecordingStep({
          recordingId: recording.id,
          step: { kind: 'navigate', url: `https://example.test/step-${index}` },
        });
      }
      expect(fixture.store.getRecording(recording.id)).toMatchObject({ stepCount: 200 });
      expect(() =>
        fixture.store.appendRecordingStep({
          recordingId: recording.id,
          step: { kind: 'navigate', url: 'https://example.test/overflow' },
        }),
      ).toThrow('browser.recording_step_limit_reached');
    } finally {
      fixture.close();
    }
  });

  it('lists non-terminal recordings for cold-start interruption and blocks Profile deletion', async () => {
    const fixture = await openStore();
    try {
      const profile = fixture.store.createProfile({ id: 'profile-recording', name: '录制账号' });
      const recording = fixture.store.createRecording({
        id: 'recording-recovery',
        profileId: profile.id,
        ownerId: 'recording:recording-recovery',
        expectedProfileRevision: profile.revision,
      });
      fixture.store.markRecordingStarted({
        id: recording.id,
        leaseId: 'lease-recovery',
        pageId: 'page-recovery',
      });

      expect(fixture.store.listActiveRecordings()).toMatchObject([
        {
          id: recording.id,
          profileId: profile.id,
          leaseId: 'lease-recovery',
          pageId: 'page-recovery',
          status: 'recording',
        },
      ]);
      expect(() =>
        fixture.store.softDeleteProfile({ id: profile.id, expectedRevision: profile.revision }),
      ).toThrow('browser.profile_in_use');

      const interrupted = fixture.store.finishRecording(recording.id, {
        status: 'interrupted',
        stopReason: 'runtime_restarted',
        errorCode: 'browser.recording-runtime-restarted',
      });
      expect(interrupted).toMatchObject({
        status: 'interrupted',
        stopReason: 'runtime_restarted',
        errorCode: 'browser.recording-runtime-restarted',
      });
      expect(
        fixture.store.listRecordingSteps(recording.id, { afterSequence: 0, limit: 200 }),
      ).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});
