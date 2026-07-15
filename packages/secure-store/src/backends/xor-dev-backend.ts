import type { SecureStoreBackend } from '../types.js';

// DEV ONLY XorDevBackend. Uses AES-256-GCM via node:crypto for tests and the
// pure-Node Runtime. The key is derived from a file on disk kept at a
// user-only-readable path; plaintext never leaves the backend once stored.
// Phase 0: validate roundtrip; production replaces with the Electron main's
// DPAPI safeStorage-backed variant secured over the named-pipe broker.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const ALGO = 'aes-256-gcm';

export class XorDevBackend implements SecureStoreBackend {
  name = 'xor-dev';
  private readonly keyPath: string;
  private cachedKey: Buffer | null = null;

  constructor(keyPath?: string) {
    this.keyPath =
      keyPath ?? join(homedir(), '.sync-think', 'dev-secure-store.key');
  }

  async isAvailable(): Promise<boolean> {
    return true; // dev key is auto-generated on first use
  }

  private ensureKey(): Buffer {
    if (this.cachedKey) return this.cachedKey;
    if (existsSync(this.keyPath)) {
      const raw = readFileSync(this.keyPath);
      this.cachedKey = scryptSync(raw, 'sync-think-dev-salt', 32);
      return this.cachedKey;
    }
    const seed = randomBytes(32);
    mkdirSync(dirname(this.keyPath), { recursive: true });
    writeFileSync(this.keyPath, seed, { mode: 0o600 });
    try {
      chmodSync(this.keyPath, 0o600);
    } catch {
      // Windows ignores posix mode; that's accepted for dev only.
    }
    this.cachedKey = scryptSync(seed, 'sync-think-dev-salt', 32);
    return this.cachedKey;
  }

  private vaultPath(handle: string): string {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(handle)) {
      throw new Error('invalid storeHandle');
    }
    return join(dirname(this.keyPath), 'vault', `${handle}.bin`);
  }

  async store(handle: string, plaintext: string): Promise<void> {
    const key = this.ensureKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // File layout: iv(12) | tag(16) | ct
    const out = Buffer.concat([iv, tag, ct]);
    const path = this.vaultPath(handle);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, out, { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      /* windows */
    }
  }

  async retrieve(handle: string): Promise<string> {
    const key = this.ensureKey();
    const path = this.vaultPath(handle);
    if (!existsSync(path)) {
      throw Object.assign(new Error('secret not found'), { code: 'SECRET_NOT_FOUND' });
    }
    const data = readFileSync(path);
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const ct = data.subarray(28);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }

  async remove(handle: string): Promise<void> {
    const path = this.vaultPath(handle);
    if (existsSync(path)) {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(path);
    }
  }
}
