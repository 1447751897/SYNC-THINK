import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecureStore, makeCredentialRef } from './store.js';
import { XorDevBackend } from './backends/xor-dev-backend.js';
import { scrubSecrets } from './scrub.js';

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

describe('secure-store roundtrip', () => {
  let dir: string;
  let store: SecureStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'st-ss-'));
    store = new SecureStore(new XorDevBackend(join(dir, 'key.bin')));
  });

  it('stores and retrieves the same plaintext', async () => {
    const h = await store.storeSecret('sk-test-1234567890ABCDEFGH');
    const got = await store.retrieveSecret(h);
    expect(got).toBe('sk-test-1234567890ABCDEFGH');
  });

  it('never writes plaintext to disk under vault dir', async () => {
    const secret = 'sk-SECRET1234567890ABCDEFGHIJ';
    const h = await store.storeSecret(secret);
    await store.retrieveSecret(h);
    // Walk every file under the temp dir; plaintext must never appear.
    const entries: string[] = [];
    for (const f of readdirSync(dir, { recursive: true } as never)) {
      const s = String(f);
      if (existsSync(join(dir, s)) && !isDir(join(dir, s))) entries.push(s);
    }
    expect(entries.length).toBeGreaterThan(0);
    for (const f of entries) {
      const text = readFileSync(join(dir, f)).toString('utf8');
      expect(text).not.toContain(secret);
      expect(text).not.toContain('sk-SECRET');
    }
  });

  it('removes secrets on removeSecret', async () => {
    const h = await store.storeSecret('sk-removable-XYZ123456789QRS');
    await store.removeSecret(h);
    await expect(store.retrieveSecret(h)).rejects.toMatchObject({ code: 'SECRET_NOT_FOUND' });
  });

  it('allocates distinct handles for distinct secrets', async () => {
    const a = await store.storeSecret('sk-a');
    const b = await store.storeSecret('sk-b');
    expect(a).not.toBe(b);
  });
});

describe('credential ref construction', () => {
  it('builds a ref without plaintext', () => {
    const ref = makeCredentialRef({
      credentialGroupId: 'cg-1' as never,
      label: 'main',
      kind: 'api-key',
      storeHandle: 'XYZ',
    });
    expect(ref.storeHandle).toBe('XYZ');
    expect(ref.kind).toBe('api-key');
    expect(JSON.stringify(ref)).not.toContain('plaintext');
  });
});

describe('scrubSecrets', () => {
  it('redacts sk- prefixed tokens', () => {
    const dirty = 'used key sk-1234567890ABCDEFGHIJKLMN to call api';
    const clean = scrubSecrets(dirty);
    expect(clean).not.toContain('sk-1234567890ABCDEFGHIJKLMN');
    expect(clean).toContain('[REDACTED]');
  });

  it('leaves non-secret text intact', () => {
    expect(scrubSecrets('hello world')).toBe('hello world');
  });
});
