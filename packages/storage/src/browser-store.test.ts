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
  raw: Awaited<ReturnType<typeof openDatabaseAsync>>['raw'];
  close(): void;
}> {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-store-'));
  tempDirs.push(root);
  const path = join(root, 'sync-think.db');
  await runMigrations(path);
  const connection = await openDatabaseAsync({ path });
  return {
    store: new SqliteBrowserStore(connection.raw),
    raw: connection.raw,
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

function createStoppedRecording(
  store: SqliteBrowserStore,
  input: {
    id: string;
    profileId?: string;
    startUrl?: string;
    now: string;
  },
) {
  const profileId = input.profileId ?? 'default';
  const recording = store.createRecording({
    id: input.id,
    profileId,
    ownerId: `recording:${input.id}`,
    expectedProfileRevision: store.getProfile(profileId)?.revision ?? 1,
    startUrl: input.startUrl ?? 'https://example.test/start',
    now: input.now,
  });
  store.markRecordingStarted({
    id: recording.id,
    leaseId: `lease-${input.id}`,
    pageId: `page-${input.id}`,
    currentUrl: input.startUrl ?? 'https://example.test/start',
    now: input.now,
  });
  store.appendRecordingStep({
    recordingId: recording.id,
    step: { kind: 'navigate', url: input.startUrl ?? 'https://example.test/start' },
    recordedAt: input.now,
  });
  store.appendRecordingStep({
    recordingId: recording.id,
    step: {
      kind: 'click',
      locator: { strategy: 'role', role: 'button', name: 'Continue' },
    },
    recordedAt: input.now,
  });
  store.beginRecordingStop(recording.id, { stopReason: 'user', now: input.now });
  return store.finishRecording(recording.id, {
    status: 'stopped',
    stopReason: 'user',
    now: input.now,
  });
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

describe('SqliteBrowserStore Browser automation workflow lifecycle', () => {
  it('creates searchable manual and AI task drafts with profile and status filters', async () => {
    const fixture = await openStore();
    try {
      const workProfile = fixture.store.createProfile({
        id: 'profile-workflow',
        name: 'Workflow profile',
        now: '2026-08-05T04:00:00.000Z',
      });
      const manual = fixture.store.createAutomationTaskDraft({
        id: 'browser-task-manual',
        draftId: 'browser-draft-manual',
        profileId: 'default',
        name: 'Publish weekly report',
        instruction: 'Open the report page and publish the newest draft.',
        startUrl: 'https://reports.example.test/drafts',
        source: 'manual',
        now: '2026-08-05T04:01:00.000Z',
      });
      fixture.store.createAutomationTaskDraft({
        id: 'browser-task-ai',
        draftId: 'browser-draft-ai',
        profileId: workProfile.id,
        name: 'Check support inbox',
        instruction: 'Review the support inbox and open urgent conversations.',
        startUrl: 'https://support.example.test/inbox',
        source: 'ai',
        now: '2026-08-05T04:02:00.000Z',
      });

      expect(manual).toMatchObject({
        task: {
          id: 'browser-task-manual',
          currentDraftId: 'browser-draft-manual',
          status: 'draft',
          source: 'manual',
        },
        draft: {
          id: 'browser-draft-manual',
          taskId: 'browser-task-manual',
          status: 'editing',
          stepCount: 0,
          steps: [],
        },
      });
      expect(fixture.store.listAutomationTasks({ query: 'support' })).toMatchObject([
        { id: 'browser-task-ai', profileId: workProfile.id },
      ]);
      expect(
        fixture.store.listAutomationTasks({ profileId: 'default', status: 'draft' }),
      ).toMatchObject([{ id: 'browser-task-manual' }]);
      expect(fixture.store.getAutomationTask('browser-task-manual')).toEqual(manual.task);
      expect(fixture.store.getWorkflowDraft('browser-draft-manual')).toEqual(manual.draft);
    } finally {
      fixture.close();
    }
  });

  it('freezes stopped recording steps for review, supports rework, and publishes one immutable version', async () => {
    const fixture = await openStore();
    try {
      const created = fixture.store.createAutomationTaskDraft({
        id: 'browser-task-review',
        draftId: 'browser-draft-review',
        profileId: 'default',
        name: 'Submit expense form',
        instruction: 'Open the expense form, fill the approved values, and submit it.',
        startUrl: 'https://expenses.example.test/new',
        source: 'ai',
        now: '2026-08-05T05:00:00.000Z',
      });
      const recording = createStoppedRecording(fixture.store, {
        id: 'recording-workflow-review',
        startUrl: created.task.startUrl,
        now: '2026-08-05T05:01:00.000Z',
      });
      expect(
        fixture.store.attachWorkflowDraftRecording({
          draftId: created.draft.id,
          recordingId: recording.id,
          now: '2026-08-05T05:01:30.000Z',
        }),
      ).toMatchObject({
        recordingId: recording.id,
        status: 'editing',
        stepCount: 0,
      });

      const submitted = fixture.store.submitWorkflowDraft({
        draftId: created.draft.id,
        recordingId: recording.id,
        now: '2026-08-05T05:02:00.000Z',
      });
      expect(submitted).toMatchObject({
        task: { status: 'pending_review' },
        draft: {
          status: 'pending_review',
          recordingId: recording.id,
          stepCount: 2,
        },
      });
      expect(
        fixture.store.submitWorkflowDraft({
          draftId: created.draft.id,
          recordingId: recording.id,
          now: '2026-08-05T05:02:30.000Z',
        }),
      ).toEqual(submitted);

      const rejected = fixture.store.reviewWorkflowDraft({
        draftId: created.draft.id,
        decision: 'reject',
        note: 'Use the final submit button rather than the preview action.',
        now: '2026-08-05T05:03:00.000Z',
      });
      expect(rejected).toMatchObject({
        task: { status: 'draft' },
        draft: { status: 'rejected' },
      });

      expect(() =>
        fixture.store.submitWorkflowDraft({
          draftId: created.draft.id,
          recordingId: recording.id,
          now: '2026-08-05T05:03:30.000Z',
        }),
      ).toThrow('browser.workflow_draft_state_conflict');

      const rerecording = createStoppedRecording(fixture.store, {
        id: 'recording-workflow-review-rework',
        startUrl: created.task.startUrl,
        now: '2026-08-05T05:04:00.000Z',
      });
      const reboundDraft = fixture.store.attachWorkflowDraftRecording({
        draftId: created.draft.id,
        recordingId: rerecording.id,
        now: '2026-08-05T05:04:30.000Z',
      });
      expect(reboundDraft).toMatchObject({
        recordingId: rerecording.id,
        status: 'editing',
        stepCount: 0,
      });
      expect(reboundDraft).not.toHaveProperty('submittedAt');
      expect(reboundDraft).not.toHaveProperty('reviewedAt');
      const resubmitted = fixture.store.submitWorkflowDraft({
        draftId: created.draft.id,
        recordingId: rerecording.id,
        now: '2026-08-05T05:05:00.000Z',
      });
      expect(resubmitted.draft.status).toBe('pending_review');

      const approved = fixture.store.reviewWorkflowDraft({
        draftId: created.draft.id,
        decision: 'approve',
        note: 'Approved after rework.',
        now: '2026-08-05T05:06:00.000Z',
      });
      expect(approved).toMatchObject({
        task: {
          status: 'enabled',
          publishedVersionId: expect.stringMatching(/^browser-version-/),
        },
        draft: { status: 'approved', stepCount: 2 },
        version: {
          taskId: created.task.id,
          draftId: created.draft.id,
          versionNumber: 1,
          stepCount: 2,
        },
      });
      expect(
        fixture.store.reviewWorkflowDraft({
          draftId: created.draft.id,
          decision: 'approve',
          now: '2026-08-05T05:07:00.000Z',
        }),
      ).toEqual(approved);
      expect(fixture.store.getWorkflowVersion(approved.version!.id)).toEqual(approved.version);
      expect(() =>
        fixture.raw
          .prepare('UPDATE browser_workflow_version SET step_count = 1 WHERE id = ?')
          .run(approved.version!.id),
      ).toThrow('browser.workflow-version-immutable');
      expect(() =>
        fixture.raw
          .prepare('DELETE FROM browser_workflow_version WHERE id = ?')
          .run(approved.version!.id),
      ).toThrow('browser.workflow-version-immutable');
    } finally {
      fixture.close();
    }
  });

  it('rejects submission until the recording has stopped and contains durable steps', async () => {
    const fixture = await openStore();
    try {
      const created = fixture.store.createAutomationTaskDraft({
        id: 'browser-task-active-recording',
        draftId: 'browser-draft-active-recording',
        profileId: 'default',
        name: 'Active recording guard',
        instruction: 'Capture the browser flow after it has completed.',
        startUrl: 'https://example.test/active',
        source: 'manual',
      });
      const recording = fixture.store.createRecording({
        id: 'recording-active-workflow',
        profileId: 'default',
        ownerId: 'recording:recording-active-workflow',
        expectedProfileRevision: 1,
        startUrl: created.task.startUrl,
      });
      fixture.store.markRecordingStarted({
        id: recording.id,
        leaseId: 'lease-active-workflow',
        pageId: 'page-active-workflow',
      });
      fixture.store.appendRecordingStep({
        recordingId: recording.id,
        step: { kind: 'navigate', url: created.task.startUrl },
      });
      fixture.store.attachWorkflowDraftRecording({
        draftId: created.draft.id,
        recordingId: recording.id,
      });

      expect(() =>
        fixture.store.submitWorkflowDraft({
          draftId: created.draft.id,
          recordingId: recording.id,
        }),
      ).toThrow('browser.workflow_recording_not_stopped');
      expect(fixture.store.getWorkflowDraft(created.draft.id)).toMatchObject({
        status: 'editing',
        stepCount: 0,
      });
    } finally {
      fixture.close();
    }
  });

  it('binds only matching recordings to editable drafts and blocks rebinding terminal review states', async () => {
    const fixture = await openStore();
    try {
      const created = fixture.store.createAutomationTaskDraft({
        id: 'browser-task-recording-binding',
        draftId: 'browser-draft-recording-binding',
        profileId: 'default',
        name: 'Recording binding guard',
        instruction: 'Bind only the recording started for this exact workflow draft.',
        startUrl: 'https://example.test/binding',
        source: 'manual',
      });
      const otherProfile = fixture.store.createProfile({
        id: 'browser-profile-other',
        name: 'Other Profile',
      });
      const wrongProfileRecording = fixture.store.createRecording({
        id: 'recording-wrong-profile',
        profileId: otherProfile.id,
        ownerId: 'recording:recording-wrong-profile',
        expectedProfileRevision: otherProfile.revision,
      });
      expect(() =>
        fixture.store.attachWorkflowDraftRecording({
          draftId: created.draft.id,
          recordingId: wrongProfileRecording.id,
        }),
      ).toThrow('browser.workflow_recording_profile_mismatch');

      const recording = createStoppedRecording(fixture.store, {
        id: 'recording-binding-review',
        startUrl: created.task.startUrl,
        now: '2026-08-05T06:00:00.000Z',
      });
      fixture.store.attachWorkflowDraftRecording({
        draftId: created.draft.id,
        recordingId: recording.id,
      });
      expect(() =>
        fixture.store.submitWorkflowDraft({
          draftId: created.draft.id,
          recordingId: wrongProfileRecording.id,
        }),
      ).toThrow('browser.workflow_recording_mismatch');
      fixture.store.submitWorkflowDraft({
        draftId: created.draft.id,
        recordingId: recording.id,
      });
      expect(() =>
        fixture.store.attachWorkflowDraftRecording({
          draftId: created.draft.id,
          recordingId: recording.id,
        }),
      ).toThrow('browser.workflow_draft_state_conflict');

      fixture.store.reviewWorkflowDraft({
        draftId: created.draft.id,
        decision: 'approve',
      });
      expect(() =>
        fixture.store.attachWorkflowDraftRecording({
          draftId: created.draft.id,
          recordingId: recording.id,
        }),
      ).toThrow('browser.workflow_draft_state_conflict');
    } finally {
      fixture.close();
    }
  });
});
