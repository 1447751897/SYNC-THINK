import type { ProviderCallRequest } from '../types.js';

function openAIModelName(request: ProviderCallRequest): string {
  return (request.modelId.split('/').pop() ?? request.modelId).toLowerCase();
}

export function usesOpenAIModernPromptCaching(request: ProviderCallRequest): boolean {
  if (!request.promptCache?.key?.trim()) return false;
  const model = openAIModelName(request);
  const match = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 6);
}

export function supportsOpenAIExtendedPromptCacheRetention(request: ProviderCallRequest): boolean {
  const model = openAIModelName(request);
  if (/^gpt-(?:5\.5|5\.4|5\.2|5\.1)(?:$|-)/.test(model)) return true;
  if (/^gpt-5-codex(?:$|-)/.test(model)) return true;
  if (/^gpt-5(?:$|-(?!mini(?:$|-)|nano(?:$|-)|chat(?:$|-)))/.test(model)) return true;
  return /^gpt-4\.1(?:$|-(?!mini(?:$|-)|nano(?:$|-)))/.test(model);
}

export function openAIPromptCacheBodyFields(request: ProviderCallRequest): Record<string, unknown> {
  const key = request.promptCache?.key?.trim();
  if (!key) return {};
  // prompt_cache_* is an OpenAI-native concept; third-party relays (glm/grok/
  // qwen etc.) reject it with 400 "Unsupported parameter(s)". Only send for
  // OpenAI gpt models — other models skip caching fields entirely.
  if (!/^gpt-/.test(openAIModelName(request))) return {};
  if (usesOpenAIModernPromptCaching(request)) {
    return {
      prompt_cache_key: key,
      prompt_cache_options: { mode: 'implicit', ttl: '30m' },
    };
  }
  return {
    prompt_cache_key: key,
    ...(request.promptCache?.retention && supportsOpenAIExtendedPromptCacheRetention(request)
      ? { prompt_cache_retention: request.promptCache.retention }
      : {}),
  };
}
