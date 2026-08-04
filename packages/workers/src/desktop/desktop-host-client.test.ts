import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DesktopHostClient, DesktopHostError } from './desktop-host-client.js';

const fixtures = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const HOST_FIXTURE_TEST_TIMEOUT_MS = 15_000;
const token = (overrides: Record<string, unknown> = {}) => ({
  token: 'desktop-capability',
  allowedRoot: process.cwd(),
  timeoutMs: 10_000,
  maxOutputBytes: 32 * 1024,
  ...overrides,
});

describe('DesktopHostClient', () => {
  it(
    'validates the ready handshake and returns a structured response',
    async () => {
      const client = new DesktopHostClient({ hostEntryPath: fixtures('desktop-host-success.mjs') });
      await expect(client.execute({ kind: 'probe' }, process.cwd(), token())).resolves.toMatchObject({
        kind: 'probe',
        backend: 'uia-com',
        rootAvailable: true,
      });
    },
    HOST_FIXTURE_TEST_TIMEOUT_MS,
  );

  it('hard-stops a host that exceeds the capability timeout', async () => {
    const client = new DesktopHostClient({ hostEntryPath: fixtures('desktop-host-hang.mjs') });
    await expect(
      client.execute({ kind: 'probe' }, process.cwd(), token({ timeoutMs: 20 })),
    ).rejects.toMatchObject({ code: 'desktop.timeout', failureClass: 'timeout' });
  });

  it(
    'classifies malformed output as a handshake failure',
    async () => {
      const client = new DesktopHostClient({ hostEntryPath: fixtures('desktop-host-malformed.mjs') });
      await expect(client.execute({ kind: 'probe' }, process.cwd(), token())).rejects.toMatchObject({
        code: 'desktop.host-handshake-failed',
        failureClass: 'crashed',
      });
    },
    HOST_FIXTURE_TEST_TIMEOUT_MS,
  );

  it('rejects a denied durable start fence before spawning the host', async () => {
    const client = new DesktopHostClient({ hostEntryPath: fixtures('desktop-host-success.mjs') });
    await expect(
      client.execute({ kind: 'probe' }, process.cwd(), token({ beforeStart: () => false })),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DesktopHostError>>({
        code: 'desktop.permission-denied',
        failureClass: 'permission',
      }),
    );
  });
});
