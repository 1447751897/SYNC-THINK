import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BrowserHost } from './browser-host.js';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe('system browser CDP smoke', () => {
  it.runIf(process.env.SYNC_THINK_BROWSER_SMOKE === '1')(
    'drives a visible local page through a dedicated Profile',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-smoke-'));
      roots.push(root);
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html>
          <html>
            <body>
              <label>Name <input id="name" /></label>
              <button id="submit" onclick="document.querySelector('#result').textContent = document.querySelector('#name').value">Submit</button>
              <main id="result"></main>
            </body>
          </html>`);
      });
      await new Promise<void>((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolveListen);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('smoke server has no port');
      const origin = `http://127.0.0.1:${address.port}`;
      const host = new BrowserHost({ profileRoot: join(root, 'profiles') });
      try {
        const lease = await host.acquireLease({
          profileId: 'smoke',
          ownerId: 'smoke:conversation',
        });
        await host.execute({
          leaseId: lease.leaseId,
          action: { kind: 'navigate', url: `${origin}/fixture` },
          allowedSites: [origin],
          timeoutMs: 15_000,
        });
        await host.execute({
          leaseId: lease.leaseId,
          action: { kind: 'fill', selector: '#name', text: 'Sync-Think' },
          allowedSites: [origin],
          timeoutMs: 5_000,
        });
        await host.execute({
          leaseId: lease.leaseId,
          action: { kind: 'click', selector: '#submit' },
          allowedSites: [origin],
          timeoutMs: 5_000,
        });
        await host.execute({
          leaseId: lease.leaseId,
          action: { kind: 'wait', selector: '#result', state: 'visible' },
          allowedSites: [origin],
          timeoutMs: 5_000,
        });
        const read = await host.execute({
          leaseId: lease.leaseId,
          action: { kind: 'read', selector: '#result' },
          allowedSites: [origin],
          timeoutMs: 5_000,
        });
        expect(read.text).toContain('Sync-Think');

        const screenshot = await host.execute({
          leaseId: lease.leaseId,
          action: { kind: 'screenshot', fileName: 'smoke.png' },
          allowedSites: [origin],
          timeoutMs: 10_000,
          projectRoot: root,
        });
        expect(screenshot.absolutePath).toBeTruthy();
        expect(existsSync(screenshot.absolutePath!)).toBe(true);
      } finally {
        await host.shutdown();
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      }
    },
    60_000,
  );

  it.runIf(process.env.SYNC_THINK_BROWSER_SMOKE === '1')(
    'reattaches to the same system browser target and recovers a durable lease after Host restart',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-recovery-smoke-'));
      roots.push(root);
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<html><body><main id="checkpoint">before restart</main></body></html>');
      });
      await new Promise<void>((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolveListen);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('smoke server has no port');
      const origin = `http://127.0.0.1:${address.port}`;
      const profileRoot = join(root, 'profiles');
      const firstHost = new BrowserHost({ profileRoot });
      let secondHost: BrowserHost | undefined;
      try {
        const checkpoint = await firstHost.acquireLease({
          profileId: 'recovery-smoke',
          ownerId: 'smoke:recovery',
        });
        await firstHost.execute({
          leaseId: checkpoint.leaseId,
          action: { kind: 'navigate', url: `${origin}/checkpoint` },
          allowedSites: [origin],
          timeoutMs: 15_000,
        });
        await firstHost.shutdown({ preserveSessions: true });

        secondHost = new BrowserHost({ profileRoot });
        await expect(secondHost.inspectLease(checkpoint.leaseId)).rejects.toMatchObject({
          code: 'browser.lease-not-found',
        });
        await expect(secondHost.recoverLease(checkpoint)).resolves.toEqual(checkpoint);
        const read = await secondHost.execute({
          leaseId: checkpoint.leaseId,
          action: { kind: 'read', selector: '#checkpoint' },
          allowedSites: [origin],
          timeoutMs: 10_000,
        });
        expect(read.text).toContain('before restart');
        expect(read.pageId).toBe(checkpoint.pageId);
      } finally {
        if (secondHost) await secondHost.shutdown();
        else await firstHost.shutdown();
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      }
    },
    60_000,
  );

  it.runIf(process.env.SYNC_THINK_BROWSER_SMOKE === '1')(
    'blocks redirects and popup navigations before a denied origin receives a request',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-policy-smoke-'));
      roots.push(root);
      const deniedHits: string[] = [];
      const deniedServer = createServer((request, response) => {
        deniedHits.push(request.url ?? '/');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<html><body>denied origin received request</body></html>');
      });
      await new Promise<void>((resolveListen, reject) => {
        deniedServer.once('error', reject);
        deniedServer.listen(0, '127.0.0.1', resolveListen);
      });
      const deniedAddress = deniedServer.address();
      if (!deniedAddress || typeof deniedAddress === 'string') {
        throw new Error('denied smoke server has no port');
      }
      const deniedOrigin = `http://127.0.0.1:${deniedAddress.port}`;

      const allowedServer = createServer((request, response) => {
        if (request.url === '/redirect') {
          response.writeHead(302, { location: `${deniedOrigin}/redirect-hit?token=secret` });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          `<html><body><a id="popup" target="_blank" href="${deniedOrigin}/popup-hit?token=secret">Open popup</a></body></html>`,
        );
      });
      await new Promise<void>((resolveListen, reject) => {
        allowedServer.once('error', reject);
        allowedServer.listen(0, '127.0.0.1', resolveListen);
      });
      const allowedAddress = allowedServer.address();
      if (!allowedAddress || typeof allowedAddress === 'string') {
        throw new Error('allowed smoke server has no port');
      }
      const allowedOrigin = `http://127.0.0.1:${allowedAddress.port}`;
      const host = new BrowserHost({ profileRoot: join(root, 'profiles') });
      try {
        const lease = await host.acquireLease({
          profileId: 'policy-smoke',
          ownerId: 'smoke:policy',
        });
        await expect(
          host.execute({
            leaseId: lease.leaseId,
            action: { kind: 'navigate', url: `${allowedOrigin}/redirect` },
            allowedSites: [allowedOrigin],
            timeoutMs: 10_000,
          }),
        ).rejects.toMatchObject({ code: 'browser.origin-denied' });
        expect(deniedHits).toEqual([]);

        await host.execute({
          leaseId: lease.leaseId,
          action: { kind: 'navigate', url: `${allowedOrigin}/popup` },
          allowedSites: [allowedOrigin],
          timeoutMs: 10_000,
        });
        await expect(
          host.execute({
            leaseId: lease.leaseId,
            action: { kind: 'click', selector: '#popup' },
            allowedSites: [allowedOrigin],
            timeoutMs: 5_000,
          }),
        ).rejects.toMatchObject({ code: 'browser.origin-denied' });
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
        expect(deniedHits).toEqual([]);
      } finally {
        await host.shutdown();
        await Promise.all([
          new Promise<void>((resolveClose) => allowedServer.close(() => resolveClose())),
          new Promise<void>((resolveClose) => deniedServer.close(() => resolveClose())),
        ]);
      }
    },
    60_000,
  );
});
