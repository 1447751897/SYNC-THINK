import type { SecureStoreBackend } from '../types.js';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ElectronSafeStorageBackend stub — wired when Electron main is plumbed:
//   - main process exposes safeStorage.encryptString / decryptString
//   - Runtime reaches secrets via the named-pipe secret-broker method
//     (TD-005 fallback: "通过仅 main 可访问的 secret broker IPC/pipe 方法取用")
// The class shape is here so the storage pipeline can be built against it now;
// the actual DPAPI wiring is wired in apps/desktop main-secrets-broker in M2/3.

export class ElectronSafeStorageBackend implements SecureStoreBackend {
  name = 'electron-safe-storage';
  /**
   * Inject the safeStorage bridge before use. Two functions:
   *   encrypt(plaintext): string   (ciphertext, safe to persist)
   *   decrypt(ciphertext): string  (plaintext)
   * The bridge lives in Electron main; Runtime fetches it over the pipe.
   */
  constructor(
    private readonly bridge: {
      encrypt: (plain: string) => string;
      decrypt: (cipher: string) => string;
    },
    private readonly vaultDirectory: string,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      // round-trip probe
      const probe = this.bridge.encrypt('ping');
      return this.bridge.decrypt(probe) === 'ping';
    } catch {
      return false;
    }
  }

  async store(handle: string, plaintext: string): Promise<void> {
    const cipher = this.bridge.encrypt(plaintext);
    const path = this.vaultPath(handle);
    await mkdir(this.vaultDirectory, { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temporaryPath, cipher, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temporaryPath, path);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async retrieve(handle: string): Promise<string> {
    try {
      return this.bridge.decrypt(await readFile(this.vaultPath(handle), 'utf8'));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        throw Object.assign(new Error('secret not found'), { code: 'SECRET_NOT_FOUND' });
      }
      throw error;
    }
  }

  async remove(handle: string): Promise<void> {
    await rm(this.vaultPath(handle), { force: true });
  }

  private vaultPath(handle: string): string {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(handle)) throw new Error('invalid storeHandle');
    return join(this.vaultDirectory, `${handle}.safe-storage`);
  }
}
