import type { ProviderId, CredentialGroupId, CredentialRefId, ModelId } from './ids.js';
import type { CapabilityTag, ProtocolFamily, ProviderSurface } from './enums.js';

export interface Provider {
  id: ProviderId;
  name: string;
  /** Canonical base URL, e.g. https://gateway.example.com/v1. */
  baseUrl: string;
  /** Discovery of model list may be available or manual. */
  supportsModelDiscovery: boolean;
  createdAt: string;
  updatedAt: string;
  /** Optional importer provenance (e.g. 'ccswitch@1.2'); secrets always move into secure store. */
  importedFrom?: string;
  /** App surface for Claude/Codex/Gemini-style picker (optional legacy). */
  surface?: ProviderSurface;
}

export interface CredentialGroup {
  id: CredentialGroupId;
  providerId: ProviderId;
  name: string;
  /** Model IDs known to be usable through this group's credentials. */
  modelIds: ModelId[];
  createdAt: string;
}

// CredentialRef 鈥?never stores plaintext. Only a reference into secure store.
export interface CredentialRef {
  id: CredentialRefId;
  credentialGroupId: CredentialGroupId;
  label: string;
  /** Type of secret stored; not the secret itself. */
  kind: 'api-key' | 'bearer-token' | 'oauth-token-ref';
  /** Opaque handle into the secure store (e.g. DPAPI-safeStorage key). */
  storeHandle: string;
  createdAt: string;
}

export interface Model {
  id: ModelId;
  providerId: ProviderId;
  /** Provider-side model ID string, e.g. 'gpt-4o-mini' or 'claude-3-5-sonnet'. */
  providerModelId: string;
  displayName: string;
  protocol: ProtocolFamily;
  capabilities: CapabilityTag[];
  /** Known limits, where available. Probe results are suggestions, not facts. */
  limits?: ModelLimits;
  /** Whether capability tags were user-confirmed or only probe-suggested. */
  capabilitiesConfirmed: boolean;
}

export interface ModelLimits {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsStreaming?: boolean;
  supportsTemperature?: boolean;
}

// Human-only verified probe result (搂7.2). Suggestions, never immutable facts.
export interface CapabilityProbeResult {
  modelId: ModelId;
  probedAt: string;
  results: Partial<Record<CapabilityTag, boolean>>;
}

