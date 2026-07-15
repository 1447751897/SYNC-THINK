import { ulid } from '@sync-think/shared';
import type { CredentialRefRecord, SecureStoreBackend } from './types.js';

// SecureStore coordinates a backend with handle allocation.
// Plaintext is held only briefly in memory during retrieve() and is the
// caller's responsibility to clear (see scrub.clearSecret). The store keeps
// an in-memory map of handle → plaintext BEFORE backend is plumbed.

export class SecureStore {
  private readonly backend: SecureStoreBackend;
  /** In-memory plaintext cache; short-lived; cleared on shutdown(). */
  private readonly cache = new Map<string, string>();

  constructor(backend: SecureStoreBackend) {
    this.backend = backend;
  }

  async storeSecret(plaintext: string): Promise<string> {
    const handle = ulid();
    await this.backend.store(handle, plaintext);
    return handle;
  }

  async retrieveSecret(handle: string): Promise<string> {
    // Do not cache by default — least-risk; retrieves re-fetch every call.
    return this.backend.retrieve(handle);
  }

  async removeSecret(handle: string): Promise<void> {
    await this.backend.remove(handle);
  }

  async isAvailable(): Promise<boolean> {
    return this.backend.isAvailable();
  }

  getBackendName(): string {
    return this.backend.name;
  }

  shutdown(): void {
    // Best-effort: clear cached strings. Strings are immutable in V8; we leave
    // a tear-down note and rely on caller to keep secret lifetime short.
    this.cache.clear();
  }
}

/** Build a CredentialRef-shaped record from a generated handle (caller persists). */
export function makeCredentialRef(
  partial: Pick<CredentialRefRecord, 'credentialGroupId' | 'label' | 'kind' | 'storeHandle'>,
  now: string = new Date().toISOString(),
): CredentialRefRecord {
  return {
    id: ulid() as unknown as CredentialRefRecord['id'],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
