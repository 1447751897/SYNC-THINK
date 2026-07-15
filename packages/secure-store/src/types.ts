import type { CredentialRefId, CredentialGroupId } from '@sync-think/shared';

// CredentialRef — record persisted in SQLite (NOT the secret).
// holds a storeHandle: opaque reference into a SecureStore implementation.
export interface CredentialRefRecord {
  id: CredentialRefId;
  credentialGroupId: CredentialGroupId;
  label: string;
  kind: 'api-key' | 'bearer-token' | 'oauth-token-ref';
  /** Opaque reference into the secure store; never the secret itself. */
  storeHandle: string;
  createdAt: string;
  updatedAt: string;
}

// What the store needs to write/read. The secret is never persisted in DB.
export interface SecretEnvelope {
  label: string;
  kind: 'api-key' | 'bearer-token' | 'oauth-token-ref';
  /** Plaintext secret available only in memory; cleared after use. */
  plaintext: string;
}

// Backend agnostic store interface (TD-005).
export interface SecureStoreBackend {
  name: string;
  /** Encrypt+persist; returns an opaque handle. */
  store(handle: string, plaintext: string): Promise<void>;
  /** Decrypt and return plaintext; caller MUST clear after use. */
  retrieve(handle: string): Promise<string>;
  /** Forget the ciphertext keyed by handle. */
  remove(handle: string): Promise<void>;
  /** Heuristic only: symmetric encryption backing. */
  isAvailable(): Promise<boolean>;
}

// Factory signature — electron/main ships ElectronSafeStorageBackend via
// runtime secret-broker pipe; pure-node ships XorDevBackend for tests.
export type SecureStoreBackendFactory = () => SecureStoreBackend;
