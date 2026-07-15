import type { ProtocolFamily, ProviderSurface } from './types/enums.js';

const SURFACES = new Set<ProviderSurface>(['claude', 'codex', 'gemini', 'kiro', 'generic']);

/** Display order aligned with CC Switch: Codex → Claude Code → Kiro → Gemini → 其他. */
export const PROVIDER_SURFACE_ORDER: readonly ProviderSurface[] = [
  'codex',
  'claude',
  'kiro',
  'gemini',
  'generic',
] as const;

export const PROVIDER_SURFACE_LABELS: Record<ProviderSurface, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  kiro: 'Kiro',
  gemini: 'Gemini',
  generic: '其他',
};

export function isProviderSurface(value: unknown): value is ProviderSurface {
  return typeof value === 'string' && SURFACES.has(value as ProviderSurface);
}

export function normalizeProviderSurface(value: unknown, fallback: ProviderSurface = 'generic'): ProviderSurface {
  return isProviderSurface(value) ? value : fallback;
}

/** Map CC Switch app_type → surface. */
export function surfaceFromCcSwitchAppType(appType: string | null | undefined): ProviderSurface {
  const app = String(appType ?? '').trim().toLowerCase();
  if (app === 'claude' || app === 'anthropic' || app === 'claude-desktop' || app === 'claude-code') {
    return 'claude';
  }
  if (app === 'codex' || app === 'openai') return 'codex';
  if (app === 'gemini') return 'gemini';
  if (app === 'kiro') return 'kiro';
  return 'generic';
}

/**
 * Infer surface from protocol / name / app_type.
 * Stored `generic` is treated as "unknown" and re-inferred (migration/import defaults).
 * Explicit non-generic surfaces are trusted.
 */
export function inferProviderSurface(input: {
  surface?: string | null;
  protocol?: string | ProtocolFamily | null;
  appType?: string | null;
  name?: string | null;
}): ProviderSurface {
  if (isProviderSurface(input.surface) && input.surface !== 'generic') {
    return input.surface;
  }

  const fromApp = surfaceFromCcSwitchAppType(input.appType);
  if (fromApp !== 'generic') return fromApp;

  const name = String(input.name ?? '').toLowerCase();
  if (name.includes('kiro')) return 'kiro';
  if (name.includes('claude') || name.includes('anthropic')) return 'claude';
  if (name.includes('codex')) return 'codex';
  if (name.includes('gemini')) return 'gemini';

  const protocol = String(input.protocol ?? '');
  if (protocol === 'anthropic-messages') return 'claude';
  // OpenAI Responses is the primary Codex protocol in CC Switch imports.
  if (protocol === 'openai-responses') return 'codex';
  if (protocol === 'openai-chat' || protocol === 'openai-images') {
    if (
      name.includes('gpt') ||
      name.includes('openai') ||
      /\bo[1-9]\b/.test(name) ||
      name.includes('o1') ||
      name.includes('o3') ||
      name.includes('o4')
    ) {
      return 'codex';
    }
  }

  return 'generic';
}

/** Default surface when user creates a provider with a protocol. */
export function defaultSurfaceForProtocol(protocol: ProtocolFamily | string): ProviderSurface {
  return inferProviderSurface({ protocol });
}
