import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { XorDevBackend } from './xor-dev-backend.js';
import { ElectronSafeStorageBackend } from './electron-safe-storage-backend.js';
import {
  WindowsDpapiBackend,
  createPowerShellDpapiBridge,
  type DpapiBridge,
} from './windows-dpapi-backend.js';

const HANDLE = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

function reversibleTestBridge(): DpapiBridge {
  return {
    async protect(plaintext) {
      return Buffer.from([...plaintext].reverse()).toString('base64');
    },
    async unprotect(ciphertext) {
      return Buffer.from(ciphertext, 'base64').reverse();
    },
  };
}

describe('WindowsDpapiBackend', () => {
  it('persists only protected bytes and survives backend recreation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-dpapi-persist-'));
    const secret = 'sk-DPAPI_PERSISTENCE_CANARY_123456789';
    const bridge = reversibleTestBridge();
    const first = new WindowsDpapiBackend({ vaultDirectory: dir, bridge });

    await first.store(HANDLE, secret);

    const ciphertextPath = join(dir, `${HANDLE}.dpapi`);
    expect(existsSync(ciphertextPath)).toBe(true);
    expect(readFileSync(ciphertextPath).toString('utf8')).not.toContain(secret);

    const reopened = new WindowsDpapiBackend({ vaultDirectory: dir, bridge });
    await expect(reopened.retrieve(HANDLE)).resolves.toBe(secret);
  });

  it('migrates a legacy development vault entry after its first successful read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-dpapi-migrate-'));
    const legacyKeyPath = join(dir, 'dev-key.bin');
    const legacy = new XorDevBackend(legacyKeyPath);
    const secret = 'sk-LEGACY_MIGRATION_CANARY_123456789';
    await legacy.store(HANDLE, secret);
    const oldPath = join(dir, 'vault', `${HANDLE}.bin`);
    expect(existsSync(oldPath)).toBe(true);

    const backend = new WindowsDpapiBackend({
      vaultDirectory: join(dir, 'dpapi-vault'),
      bridge: reversibleTestBridge(),
      legacyBackend: legacy,
    });

    await expect(backend.retrieve(HANDLE)).resolves.toBe(secret);
    expect(existsSync(join(dir, 'dpapi-vault', `${HANDLE}.dpapi`))).toBe(true);
    expect(existsSync(oldPath)).toBe(false);
  });

  it.runIf(process.platform === 'win32')(
    'round-trips through Windows CurrentUser DPAPI without putting plaintext on argv',
    async () => {
      const bridge = createPowerShellDpapiBridge({ timeoutMs: 10_000 });
      const plaintext = Buffer.from('sync-think-real-dpapi-probe', 'utf8');
      const ciphertext = await bridge.protect(plaintext);

      expect(ciphertext).not.toContain(plaintext.toString('base64'));
      await expect(bridge.unprotect(ciphertext)).resolves.toEqual(plaintext);
    },
    20_000,
  );
});

describe('ElectronSafeStorageBackend', () => {
  it('persists safeStorage ciphertext across backend recreation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-electron-safe-storage-'));
    const bridge = {
      encrypt: (plain: string) => Buffer.from(plain, 'utf8').toString('base64'),
      decrypt: (cipher: string) => Buffer.from(cipher, 'base64').toString('utf8'),
    };
    const first = new ElectronSafeStorageBackend(bridge, dir);
    await first.store(HANDLE, 'electron-safe-storage-secret');

    const reopened = new ElectronSafeStorageBackend(bridge, dir);
    await expect(reopened.retrieve(HANDLE)).resolves.toBe('electron-safe-storage-secret');
  });
});
