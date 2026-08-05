import { mkdtempSync, rmSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFrames, encodeFrame, pipePathPortable, type Frame } from '@sync-think/protocol';
import { openDatabaseAsync, runMigrations, SqliteBrowserStore } from '@sync-think/storage';
import type { BrowserHostLike } from '@sync-think/workers';
import { Runtime } from '../src/runtime.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connectRuntime(installId: string): Promise<Socket> {
  const socket = connect(pipePathPortable(installId));
  await new Promise<void>((resolveConnect, reject) => {
    socket.once('connect', resolveConnect);
    socket.once('error', reject);
  });
  return socket;
}

function createFrameInbox(socket: Socket) {
  const waiters = new Map<string, (frame: Frame) => void>();
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    const decoded = decodeFrames(Buffer.concat([pending, chunk]));
    pending = decoded.remaining;
    for (const frame of decoded.frames) {
      const waiter = waiters.get(frame.id);
      if (!waiter) continue;
      waiters.delete(frame.id);
      waiter(frame);
    }
  });
  return {
    send(frame: Frame): Promise<Frame> {
      const response = new Promise<Frame>((resolveResponse) =>
        waiters.set(frame.id, resolveResponse),
      );
      socket.write(encodeFrame(frame));
      return response;
    },
  };
}

describe('Runtime Browser Profile commands', () => {
  it('routes Profile CRUD and sanitized site-session commands over the local pipe', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-profile-runtime-'));
    tempDirs.push(root);
    const databasePath = join(root, 'sync-think.db');
    await runMigrations(databasePath);
    const connection = await openDatabaseAsync({ path: databasePath });
    const browserStore = new SqliteBrowserStore(connection.raw);
    const deleteProfileData = vi.fn(async () => undefined);
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
      hasActiveProfileLeases: vi.fn(() => false),
      listProfileSiteData: vi.fn(async (input) => ({
        profileId: input.profileId,
        checkedAt: '2026-08-05T05:00:00.000Z',
        sites: [
          {
            siteKey: 'example.com',
            origins: ['https://app.example.com'],
            cookieCount: 2,
            storageBytes: 1024,
            storageTypes: ['cookies', 'local_storage'],
          },
        ],
      })),
      clearProfileSiteData: vi.fn(async (input) => ({
        profileId: input.profileId,
        siteKey: input.siteKey,
        clearedOrigins: ['https://app.example.com'],
        deletedCookieCount: 2,
        checkedAt: '2026-08-05T05:01:00.000Z',
      })),
      deleteProfileData,
    };
    const installId = `browser-profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const runtime = new Runtime({ installId, allowNoToken: true, browserStore, browserHost: host });
    await runtime.start();
    const socket = await connectRuntime(installId);
    const inbox = createFrameInbox(socket);
    let requestSequence = 0;
    const request = (type: Frame['type'], payload: unknown) =>
      inbox.send({
        id: `browser-profile-request-${++requestSequence}`,
        kind: 'request',
        type,
        payload,
      });
    try {
      await request('__hello', {
        protocolVersion: 2,
        appVersion: '0.0.1',
        installId,
        nonce: 'browser-profile-runtime',
        features: [],
      });

      const listed = await request('browser.profile.list', {});
      expect(listed.error).toBeUndefined();
      expect(listed.payload).toMatchObject({
        profiles: [{ id: 'default', isDefault: true, inUse: false }],
      });

      const created = await request('browser.profile.create', { name: 'Work' });
      expect(created.error).toBeUndefined();
      const profile = (created.payload as { profile: { id: string; revision: number } }).profile;

      const sessions = await request('browser.profile.listSiteSessions', {
        profileId: profile.id,
        refresh: true,
      });
      expect(sessions.payload).toMatchObject({
        refreshed: true,
        sessions: [
          {
            siteKey: 'example.com',
            cookieCount: 2,
            storageTypes: ['cookies', 'local_storage'],
          },
        ],
      });
      expect(JSON.stringify(sessions.payload)).not.toContain('token');

      const cleared = await request('browser.profile.clearSiteSession', {
        profileId: profile.id,
        siteKey: 'example.com',
      });
      expect(cleared.payload).toMatchObject({ siteKey: 'example.com', deletedCookieCount: 2 });

      const renamed = await request('browser.profile.rename', {
        profileId: profile.id,
        name: 'Operations',
        expectedRevision: profile.revision,
      });
      const renamedProfile = (
        renamed.payload as { profile: { id: string; revision: number; name: string } }
      ).profile;
      expect(renamedProfile.name).toBe('Operations');

      const deleted = await request('browser.profile.delete', {
        profileId: renamedProfile.id,
        expectedRevision: renamedProfile.revision,
      });
      expect(deleted.payload).toEqual({ profileId: renamedProfile.id, deleted: true });
      expect(deleteProfileData).toHaveBeenCalledWith(renamedProfile.id);

      const defaultDelete = await request('browser.profile.delete', {
        profileId: 'default',
        expectedRevision: 1,
      });
      expect(defaultDelete.error?.code).toBe('browser.default-profile-immutable');
    } finally {
      socket.destroy();
      await runtime.stop();
      connection.raw.close();
    }
  });
});
