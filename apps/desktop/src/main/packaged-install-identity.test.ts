import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  describeDesktopRuntimeIdentity,
  resolveDesktopRuntimeIdentity,
  runtimeIdentityMetadataPath,
  type IdentitySecretStore,
} from './packaged-install-identity.js';

const HANDLE = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

class FileIdentitySecretStore implements IdentitySecretStore {
  storeCalls = 0;
  retrieveCalls = 0;
  failRetrieve = false;

  constructor(private readonly directory: string) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async storeSecret(plaintext: string): Promise<string> {
    this.storeCalls++;
    await writeFile(join(this.directory, `${HANDLE}.cipher`), encodeSecret(plaintext), 'utf8');
    return HANDLE;
  }

  async retrieveSecret(handle: string): Promise<string> {
    this.retrieveCalls++;
    if (this.failRetrieve) throw new Error('ciphertext rejected');
    return decodeSecret(await readFile(join(this.directory, `${handle}.cipher`), 'utf8'));
  }

  async removeSecret(handle: string): Promise<void> {
    await writeFile(join(this.directory, `${handle}.removed`), '1', 'utf8');
  }
}

function encodeSecret(plaintext: string): string {
  return Buffer.from([...plaintext].reverse().join(''), 'utf8').toString('base64');
}

function decodeSecret(ciphertext: string): string {
  return [...Buffer.from(ciphertext, 'base64').toString('utf8')].reverse().join('');
}

async function createFixture() {
  const userDataPath = await mkdtemp(join(tmpdir(), 'sync-think-runtime-identity-'));
  const secretStore = new FileIdentitySecretStore(userDataPath);
  return { userDataPath, secretStore };
}

describe('resolveDesktopRuntimeIdentity', () => {
  it('creates a packaged install id and high-entropy pipe secret on first launch', async () => {
    const fixture = await createFixture();

    const identity = await resolveDesktopRuntimeIdentity({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      secretStore: fixture.secretStore,
      generateInstallId: () => 'install-11111111-2222-4333-8444-555555555555',
      generatePipeSecret: () => 'generated-pipe-secret-with-at-least-32-bytes',
    });

    expect(identity).toEqual({
      installId: 'install-11111111-2222-4333-8444-555555555555',
      pipeSecret: 'generated-pipe-secret-with-at-least-32-bytes',
      allowNoToken: false,
      source: 'packaged-store',
    });
    expect(fixture.secretStore.storeCalls).toBe(1);
  });

  it('reuses exactly the same packaged identity after restart', async () => {
    const fixture = await createFixture();
    const options = {
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      secretStore: fixture.secretStore,
      generateInstallId: () => 'install-persistent',
      generatePipeSecret: () => 'persistent-pipe-secret-with-32-plus-bytes',
    } as const;

    const first = await resolveDesktopRuntimeIdentity(options);
    const second = await resolveDesktopRuntimeIdentity({
      ...options,
      generateInstallId: () => 'install-must-not-rotate',
      generatePipeSecret: () => 'pipe-secret-must-not-rotate-xxxxxxxx',
    });

    expect(second).toEqual(first);
    expect(fixture.secretStore.storeCalls).toBe(1);
    expect(fixture.secretStore.retrieveCalls).toBe(1);
  });

  it('serializes concurrent first-launch initialization into one stable identity', async () => {
    const fixture = await createFixture();
    let installCounter = 0;
    let secretCounter = 0;
    const options = {
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      secretStore: fixture.secretStore,
      generateInstallId: () => `install-concurrent-${++installCounter}`,
      generatePipeSecret: () => `concurrent-pipe-secret-${++secretCounter}-xxxxxxxxxxxxxxxx`,
    } as const;

    const [first, second] = await Promise.all([
      resolveDesktopRuntimeIdentity(options),
      resolveDesktopRuntimeIdentity(options),
    ]);

    expect(second).toEqual(first);
    expect(fixture.secretStore.storeCalls).toBe(1);
  });

  it('keeps development environment overrides in memory without creating packaged files', async () => {
    const fixture = await createFixture();

    const identity = await resolveDesktopRuntimeIdentity({
      isPackaged: false,
      userDataPath: fixture.userDataPath,
      environment: {
        SYNC_THINK_INSTALL_ID: 'dev-custom',
        SYNC_THINK_PIPE_SECRET: 'dev-secret',
        SYNC_THINK_DEV_NO_TOKEN: '1',
      },
    });

    expect(identity).toEqual({
      installId: 'dev-custom',
      pipeSecret: 'dev-secret',
      allowNoToken: true,
      source: 'environment',
    });
    await expect(readFile(runtimeIdentityMetadataPath(fixture.userDataPath), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('never enables no-token authentication for a packaged identity', async () => {
    const fixture = await createFixture();

    const identity = await resolveDesktopRuntimeIdentity({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      environment: { SYNC_THINK_DEV_NO_TOKEN: '1' },
      secretStore: fixture.secretStore,
      generateInstallId: () => 'install-authenticated',
      generatePipeSecret: () => 'authenticated-pipe-secret-xxxxxxxxxxxx',
    });

    expect(identity.allowNoToken).toBe(false);
    expect(identity.pipeSecret).toBeTruthy();
  });

  it('persists only an opaque secret handle and ciphertext, never the plaintext secret', async () => {
    const fixture = await createFixture();
    const plaintext = 'plaintext-pipe-secret-that-must-not-leak';

    await resolveDesktopRuntimeIdentity({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      secretStore: fixture.secretStore,
      generateInstallId: () => 'install-encrypted',
      generatePipeSecret: () => plaintext,
    });

    const metadata = await readFile(runtimeIdentityMetadataPath(fixture.userDataPath), 'utf8');
    const ciphertext = await readFile(join(fixture.userDataPath, `${HANDLE}.cipher`), 'utf8');
    expect(metadata).toContain(HANDLE);
    expect(metadata).not.toContain(plaintext);
    expect(ciphertext).not.toContain(plaintext);
  });

  it('fails closed when the persisted secret can no longer be decrypted', async () => {
    const fixture = await createFixture();
    const options = {
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      secretStore: fixture.secretStore,
      generateInstallId: () => 'install-corrupt',
      generatePipeSecret: () => 'original-pipe-secret-xxxxxxxxxxxxxxxx',
    } as const;
    await resolveDesktopRuntimeIdentity(options);
    fixture.secretStore.failRetrieve = true;

    await expect(resolveDesktopRuntimeIdentity(options)).rejects.toMatchObject({
      code: 'DESKTOP_RUNTIME_IDENTITY_DECRYPT_FAILED',
    });
    expect(fixture.secretStore.storeCalls).toBe(1);
  });

  it('exposes a log-safe projection without the pipe secret', async () => {
    const fixture = await createFixture();
    const identity = await resolveDesktopRuntimeIdentity({
      isPackaged: true,
      userDataPath: fixture.userDataPath,
      secretStore: fixture.secretStore,
      generateInstallId: () => 'install-log-safe',
      generatePipeSecret: () => 'log-safe-pipe-secret-xxxxxxxxxxxxxxxx',
    });

    const projection = describeDesktopRuntimeIdentity(identity);
    expect(projection).toEqual({
      installId: 'install-log-safe',
      allowNoToken: false,
      source: 'packaged-store',
      pipeSecretConfigured: true,
    });
    expect(JSON.stringify(projection)).not.toContain(identity.pipeSecret);
  });
});