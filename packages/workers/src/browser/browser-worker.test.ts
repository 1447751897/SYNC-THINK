import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collect } from '../support.js';
import type { BrowserHostLike } from './browser-host.js';
import { PersistentBrowserWorker } from './browser-worker.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fakeHost(): BrowserHostLike & {
  acquireLease: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
} {
  return {
    acquireLease: vi.fn(async () => ({
      leaseId: 'lease-1',
      pageId: 'page-1',
      profileId: 'work',
      ownerId: 'conversation:1',
    })),
    execute: vi.fn(async () => ({
      ok: true,
      message: 'Browser action completed',
      leaseId: 'lease-1',
      pageId: 'page-1',
      profileId: 'work',
      url: 'https://example.test/',
      title: 'Example',
      text: 'visible text',
    })),
    releaseLease: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
  };
}

describe('PersistentBrowserWorker', () => {
  it('acquires an owner lease and emits the structured BrowserHost result', async () => {
    const host = fakeHost();
    const worker = new PersistentBrowserWorker(host);
    const events = await collect(
      worker.exec(
        {
          workingDir: 'D:/project',
          profileId: 'work',
          ownerId: 'conversation:1',
          allowedSites: ['https://example.test'],
          action: { kind: 'navigate', url: 'https://example.test/' },
        },
        { token: 'browser-token', allowedRoot: 'D:/project', timeoutMs: 5_000 },
      ),
    );

    expect(host.acquireLease).toHaveBeenCalledWith({
      profileId: 'work',
      ownerId: 'conversation:1',
    });
    expect(host.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseId: 'lease-1',
        action: { kind: 'navigate', url: 'https://example.test/' },
        allowedSites: ['https://example.test'],
        timeoutMs: 5_000,
      }),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'completed',
      output: { ok: true, profileId: 'work', leaseId: 'lease-1', pageId: 'page-1' },
    });
  });

  it('rejects an invalid capability root and a denied start fence before Host work', async () => {
    const host = fakeHost();
    const worker = new PersistentBrowserWorker(host);
    const escaped = await collect(
      worker.exec(
        {
          workingDir: 'D:/other',
          profileId: 'work',
          ownerId: 'conversation:1',
          allowedSites: ['https://example.test'],
          action: { kind: 'read' },
        },
        { token: 'browser-token', allowedRoot: 'D:/project', timeoutMs: 5_000 },
      ),
    );
    expect(escaped.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'permission',
      error: { code: 'security.path_traversal' },
    });

    const fenced = await collect(
      worker.exec(
        {
          workingDir: 'D:/project',
          profileId: 'work',
          ownerId: 'conversation:1',
          allowedSites: ['https://example.test'],
          action: { kind: 'read' },
        },
        {
          token: 'browser-token',
          allowedRoot: 'D:/project',
          timeoutMs: 5_000,
          beforeStart: () => false,
        },
      ),
    );
    expect(fenced.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'acceptance',
      error: { code: 'worker.fence-rejected' },
    });
    expect(host.acquireLease).not.toHaveBeenCalled();
  });

  it('maps BrowserHost failures to stable Worker failure classes', async () => {
    const host = fakeHost();
    host.execute.mockRejectedValueOnce(
      Object.assign(new Error('Origin is outside the capability grant'), {
        code: 'browser.origin-denied',
        failureClass: 'permission',
      }),
    );
    const events = await collect(
      new PersistentBrowserWorker(host).exec(
        {
          workingDir: 'D:/project',
          profileId: 'work',
          ownerId: 'conversation:1',
          allowedSites: ['https://allowed.test'],
          action: { kind: 'navigate', url: 'https://blocked.test/' },
        },
        { token: 'browser-token', allowedRoot: 'D:/project', timeoutMs: 5_000 },
      ),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'permission',
      error: { code: 'browser.origin-denied' },
    });
  });

  it('rejects a screenshot project root that resolves through a symlink outside allowedRoot', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'sync-think-browser-worker-'));
    roots.push(fixture);
    const allowedRoot = join(fixture, 'allowed');
    const outside = join(fixture, 'outside');
    mkdirSync(allowedRoot);
    mkdirSync(outside);
    const linkedProject = join(allowedRoot, 'linked-project');
    symlinkSync(outside, linkedProject, process.platform === 'win32' ? 'junction' : 'dir');
    const host = fakeHost();

    const events = await collect(
      new PersistentBrowserWorker(host).exec(
        {
          workingDir: linkedProject,
          profileId: 'work',
          ownerId: 'conversation:1',
          allowedSites: ['https://example.test'],
          action: { kind: 'screenshot', fileName: 'proof.png' },
        },
        { token: 'browser-token', allowedRoot, timeoutMs: 5_000 },
      ),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      failureClass: 'permission',
      error: { code: 'security.path_traversal' },
    });
    expect(host.acquireLease).not.toHaveBeenCalled();
  });
});
