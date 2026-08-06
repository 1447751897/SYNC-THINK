import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteBrowserStore } from '@sync-think/storage';
import type {
  BrowserHostLike,
  BrowserProfileSiteClearResult,
  BrowserProfileSiteDataSnapshot,
} from '@sync-think/workers';
import type { BrowserProfileOperationGate } from './runtime-browser-profile-gate.js';
import { RuntimeBrowserProfileService } from './runtime-browser-profile-service.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createTestProfileOperationGate(): BrowserProfileOperationGate {
  const tails = new Map<string, Promise<void>>();
  return {
    isBusy(profileId: string) {
      return tails.has(profileId);
    },
    assertAvailable(profileId: string) {
      if (tails.has(profileId)) throw new Error('browser.profile_in_use');
    },
    async runExclusive<T>(profileId: string, operation: () => T | Promise<T>): Promise<T> {
      const previous = tails.get(profileId) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const marker = previous.then(() => current);
      tails.set(profileId, marker);
      await previous;
      try {
        return await operation();
      } finally {
        release();
        if (tails.get(profileId) === marker) tails.delete(profileId);
      }
    },
  };
}

async function fixture(options: { profileGate?: BrowserProfileOperationGate } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-profile-service-'));
  tempDirs.push(root);
  const databasePath = join(root, 'sync-think.db');
  await runMigrations(databasePath);
  const connection = await openDatabaseAsync({ path: databasePath });
  const store = new SqliteBrowserStore(connection.raw);
  const listProfileSiteData = vi.fn<
    (input: {
      profileId: string;
      knownOrigins?: readonly string[];
    }) => Promise<BrowserProfileSiteDataSnapshot>
  >(async () => ({
    profileId: 'default',
    checkedAt: '2026-08-05T04:00:00.000Z',
    sites: [
      {
        siteKey: 'example.com',
        origins: ['https://app.example.com'],
        cookieCount: 2,
        storageBytes: 512,
        storageTypes: ['cookies', 'indexed_db'],
      },
    ],
  }));
  const clearProfileSiteData = vi.fn<
    (input: {
      profileId: string;
      siteKey: string;
      knownOrigins?: readonly string[];
    }) => Promise<BrowserProfileSiteClearResult>
  >(async () => ({
    profileId: 'default',
    siteKey: 'example.com',
    clearedOrigins: ['https://app.example.com'],
    deletedCookieCount: 2,
    checkedAt: '2026-08-05T04:01:00.000Z',
  }));
  const host: BrowserHostLike = {
    acquireLease: vi.fn(async () => {
      throw new Error('not used');
    }),
    inspectLease: vi.fn(async () => {
      throw new Error('not used');
    }),
    execute: vi.fn(async () => {
      throw new Error('not used');
    }),
    releaseLease: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    listProfileSiteData,
    clearProfileSiteData,
    deleteProfileData: vi.fn(async () => undefined),
    hasActiveProfileLeases: vi.fn(() => false),
  };
  return {
    connection,
    store,
    host,
    listProfileSiteData,
    clearProfileSiteData,
    service: new RuntimeBrowserProfileService({
      store,
      host,
      ...(options.profileGate ? { profileGate: options.profileGate } : {}),
    }),
  };
}

describe('RuntimeBrowserProfileService', () => {
  it('owns Profile CRUD in Runtime storage with optimistic revisions', async () => {
    const f = await fixture();
    try {
      expect(f.service.listProfiles()).toMatchObject([
        { id: 'default', name: '默认浏览器', revision: 1, isDefault: true },
      ]);
      const profile = f.service.createProfile({ name: '工作号' });
      expect(profile.id).toMatch(/^profile-/);
      const renamed = f.service.renameProfile({
        profileId: profile.id,
        name: '运营号',
        expectedRevision: profile.revision,
      });
      expect(renamed).toMatchObject({ name: '运营号', revision: 2 });
    } finally {
      f.connection.raw.close();
    }
  });

  it('refreshes a sanitized site-session snapshot and preserves a verified login timestamp', async () => {
    const f = await fixture();
    try {
      f.service.markLoginVerified({
        profileId: 'default',
        origin: 'https://app.example.com',
        verifiedAt: '2026-08-05T03:59:00.000Z',
      });
      const response = await f.service.listSiteSessions({ profileId: 'default', refresh: true });
      expect(response.refreshed).toBe(true);
      expect(response.profile).toMatchObject({ id: 'default', inUse: false });
      expect(response.sessions).toEqual([
        expect.objectContaining({
          siteKey: 'example.com',
          state: 'verified',
          cookieCount: 2,
          storageTypes: ['cookies', 'indexed_db'],
          lastVerifiedAt: '2026-08-05T03:59:00.000Z',
        }),
      ]);
      expect(JSON.stringify(response)).not.toContain('token');
      expect(f.listProfileSiteData).toHaveBeenCalledWith({
        profileId: 'default',
        knownOrigins: ['https://app.example.com'],
      });
    } finally {
      f.connection.raw.close();
    }
  });

  it('clears one site, retains the Profile, and rejects active command or lease races', async () => {
    const f = await fixture();
    try {
      await f.service.listSiteSessions({ profileId: 'default', refresh: true });
      const cleared = await f.service.clearSiteSession({
        profileId: 'default',
        siteKey: 'example.com',
      });
      expect(cleared).toMatchObject({ siteKey: 'example.com', deletedCookieCount: 2 });
      expect(f.store.listSiteSessions('default')).toEqual([]);

      f.store.reserveCommand({
        id: 'active-profile-command',
        idempotencyKey: 'browser:active-profile-command',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        ownerId: 'owner-1',
        profileId: 'default',
        toolName: 'browser_open',
        action: 'navigate',
        targetOrigin: 'https://example.com',
        sanitizedArgs: {},
      });
      await expect(
        f.service.clearSiteSession({ profileId: 'default', siteKey: 'example.com' }),
      ).rejects.toMatchObject({ code: 'browser.profile_in_use' });
      expect(f.clearProfileSiteData).toHaveBeenCalledTimes(1);
    } finally {
      f.connection.raw.close();
    }
  });

  it('rejects a live site refresh while the Profile has an active command', async () => {
    const f = await fixture();
    try {
      f.store.reserveCommand({
        id: 'active-profile-refresh-command',
        idempotencyKey: 'browser:active-profile-refresh-command',
        workspaceId: 'workspace-1',
        runId: 'run-1',
        ownerId: 'owner-1',
        profileId: 'default',
        toolName: 'browser_open',
        action: 'navigate',
        targetOrigin: 'https://example.com',
        sanitizedArgs: {},
      });

      await expect(
        f.service.listSiteSessions({ profileId: 'default', refresh: true }),
      ).rejects.toMatchObject({ code: 'browser.profile_in_use' });
      expect(f.listProfileSiteData).not.toHaveBeenCalled();
    } finally {
      f.connection.raw.close();
    }
  });

  it('rejects a live site refresh while the Profile has an active Page lease', async () => {
    const f = await fixture();
    try {
      f.host.hasActiveProfileLeases = vi.fn(() => true);

      await expect(
        f.service.listSiteSessions({ profileId: 'default', refresh: true }),
      ).rejects.toMatchObject({ code: 'browser.profile_in_use' });
      expect(f.listProfileSiteData).not.toHaveBeenCalled();
    } finally {
      f.connection.raw.close();
    }
  });

  it('treats a durable active recording as Profile use for maintenance and summaries', async () => {
    const f = await fixture();
    try {
      f.store.createRecording({
        id: 'profile-service-recording',
        profileId: 'default',
        ownerId: 'recording:profile-service-recording',
        expectedProfileRevision: 1,
      });

      expect(f.service.listProfiles()).toMatchObject([{ id: 'default', inUse: true }]);
      await expect(
        f.service.listSiteSessions({ profileId: 'default', refresh: true }),
      ).rejects.toMatchObject({ code: 'browser.profile_in_use' });
      expect(f.listProfileSiteData).not.toHaveBeenCalled();
    } finally {
      f.connection.raw.close();
    }
  });

  it('rejects Profile deletion while automation tasks still reference it', async () => {
    const f = await fixture();
    try {
      const profile = f.service.createProfile({ name: '自动化账号' });
      f.store.createAutomationTaskDraft({
        profileId: profile.id,
        name: 'Keep this Profile',
        instruction: 'Keep the Profile available for this workflow.',
        startUrl: 'https://example.test/profile-guard',
        source: 'manual',
      });

      await expect(
        f.service.deleteProfile({
          profileId: profile.id,
          expectedRevision: profile.revision,
        }),
      ).rejects.toMatchObject({ code: 'browser.profile_has_workflows' });
      expect(f.store.getProfile(profile.id)).toMatchObject({
        id: profile.id,
        name: profile.name,
        revision: profile.revision,
      });
      expect(f.host.deleteProfileData).not.toHaveBeenCalled();
    } finally {
      f.connection.raw.close();
    }
  });

  it('keeps a new command reservation behind Profile deletion', async () => {
    const profileGate = createTestProfileOperationGate();
    const f = await fixture({ profileGate });
    try {
      const profile = f.service.createProfile({ name: '临时账号' });
      let markDeleteStarted!: () => void;
      const deleteStarted = new Promise<void>((resolve) => {
        markDeleteStarted = resolve;
      });
      let finishDelete!: () => void;
      const deleteGate = new Promise<void>((resolve) => {
        finishDelete = resolve;
      });
      f.host.deleteProfileData = vi.fn(async () => {
        markDeleteStarted();
        await deleteGate;
      });

      const deletion = f.service.deleteProfile({
        profileId: profile.id,
        expectedRevision: profile.revision,
      });
      await deleteStarted;

      let reservationStarted = false;
      const reservation = profileGate.runExclusive(profile.id, async () => {
        reservationStarted = true;
        return f.store.reserveCommand({
          id: 'profile-delete-race-command',
          idempotencyKey: 'browser:profile-delete-race-command',
          workspaceId: 'workspace-1',
          runId: 'run-1',
          ownerId: 'owner-1',
          profileId: profile.id,
          toolName: 'browser_open',
          action: 'navigate',
          targetOrigin: 'https://example.com',
          sanitizedArgs: {},
        });
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(reservationStarted).toBe(false);

      finishDelete();
      await expect(deletion).resolves.toMatchObject({
        id: profile.id,
        deletedAt: expect.any(String),
      });
      expect(f.store.getProfile(profile.id)).toBeUndefined();
      await expect(reservation).rejects.toThrow('browser.profile_not_found');
      expect(reservationStarted).toBe(true);
      expect(f.host.deleteProfileData).toHaveBeenCalledTimes(1);
    } finally {
      f.connection.raw.close();
    }
  });

  it('tombstones a Profile before physical cleanup and reconciles an interrupted delete', async () => {
    const f = await fixture();
    try {
      const profile = f.service.createProfile({ name: '待清理账号' });
      f.host.deleteProfileData = vi.fn(async (profileId) => {
        expect(f.store.getProfile(profileId)).toBeUndefined();
        throw new Error('simulated cleanup interruption');
      });

      await expect(
        f.service.deleteProfile({
          profileId: profile.id,
          expectedRevision: profile.revision,
        }),
      ).rejects.toThrow('simulated cleanup interruption');
      expect(f.store.listProfiles().map((candidate) => candidate.id)).not.toContain(profile.id);
      expect(f.store.listDeletedProfiles()).toEqual([
        expect.objectContaining({ id: profile.id, deletedAt: expect.any(String) }),
      ]);

      f.host.deleteProfileData = vi.fn(async () => undefined);
      await expect(f.service.reconcileDeletedProfiles()).resolves.toEqual({
        purgedProfileIds: [profile.id],
        failedProfileIds: [],
      });
      expect(f.host.deleteProfileData).toHaveBeenCalledWith(profile.id);
    } finally {
      f.connection.raw.close();
    }
  });
});
