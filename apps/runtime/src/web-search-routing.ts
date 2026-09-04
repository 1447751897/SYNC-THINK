import type { CapabilityTag, ProtocolFamily } from '@sync-think/shared';

export type WebSearchMode = 'disabled' | 'native' | 'external' | 'fetch-only';

export interface ResolveWebSearchModeInput {
  networkEnabled: boolean;
  kernelId?: string;
  protocol: ProtocolFamily;
  baseUrl?: string;
  capabilities: readonly CapabilityTag[];
  capabilitiesConfirmed?: boolean;
  externalProviderConfigured: boolean;
}

export function resolveWebSearchMode(input: ResolveWebSearchModeInput): WebSearchMode {
  if (!input.networkEnabled) return 'disabled';
  if (supportsNativeSearch(input)) return 'native';
  if (input.externalProviderConfigured) return 'external';
  return 'fetch-only';
}

function supportsNativeSearch(input: ResolveWebSearchModeInput): boolean {
  if (!input.capabilities.includes('web-search')) return false;
  const kernelId = input.kernelId ?? 'native';
  const harnessSupportsHostedSearch =
    (kernelId === 'codex' && input.protocol === 'openai-responses') ||
    (kernelId === 'claude-code' && input.protocol === 'anthropic-messages') ||
    (kernelId === 'native' && input.protocol === 'openai-responses');
  if (!harnessSupportsHostedSearch) return false;

  // A confirmed capability is an explicit user/provider assertion. For
  // heuristic capabilities, only enable hosted search on the vendor endpoint;
  // OpenAI-compatible relays often accept Responses but reject hosted tools.
  if (input.capabilitiesConfirmed) return true;
  // Official Codex / Claude Code login routes do not carry a custom base URL.
  // Their harness owns authentication and hosted-tool transport, so absence
  // of an override is the vendor-native route rather than an unknown relay.
  if (!input.baseUrl?.trim() && (kernelId === 'codex' || kernelId === 'claude-code')) {
    return true;
  }
  const host = endpointHost(input.baseUrl);
  if (input.protocol === 'openai-responses') return host === 'api.openai.com';
  return host === 'api.anthropic.com';
}

function endpointHost(value: string | undefined): string {
  try {
    return new URL(value ?? '').hostname.toLowerCase();
  } catch {
    return '';
  }
}
