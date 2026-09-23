import type {
  ConfirmCapabilitiesPayload,
  DiscoverModelsPayload,
  ProbeCapabilitiesPayload,
} from '@sync-think/protocol';
import type { RendererCreateProviderPayload } from './provider-catalog-payloads.js';
import { hasOnlyKeys, isRecord, PROVIDER_PROTOCOLS } from './provider-payload-validation.js';

/** Renderer-facing probe payload; Main injects the short-lived clipboard secret. */
export interface RendererProbeModelsPayload {
  baseUrl: string;
  protocol: RendererCreateProviderPayload['protocol'];
}

export function parseProbeModelsPayload(value: unknown): RendererProbeModelsPayload {
  if (!isRecord(value)) throw new Error('Invalid probe-models payload');
  if (
    typeof value.baseUrl !== 'string' ||
    value.baseUrl.trim().length === 0 ||
    value.baseUrl.length > 2048 ||
    typeof value.protocol !== 'string' ||
    !PROVIDER_PROTOCOLS.has(value.protocol) ||
    !hasOnlyKeys(value, ['baseUrl', 'protocol'])
  ) {
    throw new Error('Invalid probe-models payload');
  }
  return {
    baseUrl: value.baseUrl.trim(),
    protocol: value.protocol as RendererProbeModelsPayload['protocol'],
  };
}

export function parseDiscoverModelsPayload(value: unknown): DiscoverModelsPayload {
  if (!isRecord(value)) throw new Error('Invalid discover-models payload');
  if (typeof value.providerId !== 'string' || value.providerId.length === 0) {
    throw new Error('Invalid discover-models payload');
  }
  if (value.credentialRefId !== undefined && typeof value.credentialRefId !== 'string') {
    throw new Error('Invalid discover-models payload');
  }
  if (value.persist !== undefined && typeof value.persist !== 'boolean') {
    throw new Error('Invalid discover-models payload');
  }
  return {
    providerId: value.providerId as DiscoverModelsPayload['providerId'],
    credentialRefId: value.credentialRefId as DiscoverModelsPayload['credentialRefId'],
    persist: value.persist as boolean | undefined,
  };
}

const CAPABILITY_TAG_MAP = {
  text: true,
  vision: true,
  document: true,
  video: true,
  thinking: true,
  'tool-calling': true,
  'web-search': true,
  'image-generation': true,
  embeddings: true,
} satisfies Record<ConfirmCapabilitiesPayload['capabilities'][number], true>;

const CAPABILITY_TAGS: ReadonlySet<string> = new Set(Object.keys(CAPABILITY_TAG_MAP));

export function parseProbeCapabilitiesPayload(value: unknown): ProbeCapabilitiesPayload {
  if (!isRecord(value)) throw new Error('Invalid probe-capabilities payload');
  if (typeof value.providerId !== 'string' || value.providerId.length === 0) {
    throw new Error('Invalid probe-capabilities payload');
  }
  if (
    value.modelId !== undefined &&
    (typeof value.modelId !== 'string' || value.modelId.length === 0)
  ) {
    throw new Error('Invalid probe-capabilities payload');
  }
  return {
    providerId: value.providerId as ProbeCapabilitiesPayload['providerId'],
    modelId: value.modelId as ProbeCapabilitiesPayload['modelId'],
    visionOnly: value.visionOnly === true,
  };
}

export function parseConfirmCapabilitiesPayload(value: unknown): ConfirmCapabilitiesPayload {
  if (!isRecord(value)) throw new Error('Invalid confirm-capabilities payload');
  if (
    typeof value.modelId !== 'string' ||
    value.modelId.length === 0 ||
    !Array.isArray(value.capabilities) ||
    value.capabilities.length === 0 ||
    value.capabilities.length > 16 ||
    !value.capabilities.every((capability) =>
      typeof capability === 'string' ? CAPABILITY_TAGS.has(capability) : false,
    )
  ) {
    throw new Error('Invalid confirm-capabilities payload');
  }
  if (value.confirmed !== undefined && typeof value.confirmed !== 'boolean') {
    throw new Error('Invalid confirm-capabilities payload');
  }
  if (
    value.visionCapabilityOverride !== undefined &&
    value.visionCapabilityOverride !== null &&
    typeof value.visionCapabilityOverride !== 'boolean'
  ) {
    throw new Error('Invalid confirm-capabilities payload');
  }
  return {
    modelId: value.modelId as ConfirmCapabilitiesPayload['modelId'],
    capabilities: value.capabilities as ConfirmCapabilitiesPayload['capabilities'],
    confirmed: value.confirmed as boolean | undefined,
    visionCapabilityOverride: value.visionCapabilityOverride as boolean | null | undefined,
  };
}
