import type { CapabilityTag, ModelId, ProtocolFamily } from '@sync-think/shared';

/** All capability tags defined by product design §7.2 / shared enums. */
export const CAPABILITY_TAGS: readonly CapabilityTag[] = [
  'text',
  'vision',
  'tool-calling',
  'image-generation',
  'embeddings',
] as const;

const KNOWN = new Set<string>(CAPABILITY_TAGS);

export interface CapabilitySuggestionInput {
  /** Optional stable model row id when probing an existing catalog entry. */
  modelId?: ModelId;
  /** Provider-side model id, e.g. gpt-4o-mini. */
  providerModelId: string;
  protocol: ProtocolFamily;
  /** Existing tags (e.g. from discovery); merged with heuristics. */
  existing?: readonly CapabilityTag[];
}

export interface CapabilitySuggestion {
  modelId?: ModelId;
  providerModelId: string;
  protocol: ProtocolFamily;
  /** Suggested tags — never auto-confirmed. */
  capabilities: CapabilityTag[];
  /** Partial map used by CapabilityProbeResult.results. */
  results: Partial<Record<CapabilityTag, boolean>>;
  capabilitiesConfirmed: false;
  source: 'heuristic';
  confidence: 'low' | 'medium';
  /** Human-readable reasons for UI observability (no secrets). */
  reasons: string[];
}

/**
 * Normalize user/probe capability lists: drop unknowns, preserve catalog order, dedupe.
 */
export function normalizeCapabilities(
  values: readonly string[] | undefined | null,
): CapabilityTag[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<CapabilityTag>();
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim() as CapabilityTag;
    if (!KNOWN.has(tag)) continue;
    seen.add(tag);
  }
  return CAPABILITY_TAGS.filter((tag) => seen.has(tag));
}

/**
 * Union existing tags with suggestions, still catalog-ordered.
 */
export function mergeCapabilitySuggestions(
  existing: readonly CapabilityTag[] | undefined,
  suggested: readonly CapabilityTag[] | undefined,
): CapabilityTag[] {
  return normalizeCapabilities([...(existing ?? []), ...(suggested ?? [])]);
}

function isEmbeddingModelId(id: string): boolean {
  return (
    /\bembed(ding)?s?\b/.test(id) || id.includes('text-embedding') || id.includes('embedding-')
  );
}

function isGeneratedMediaModelId(id: string): boolean {
  return (
    /\bdall-?e\b/.test(id) ||
    id.includes('flux') ||
    id.includes('imagen') ||
    id.includes('midjourney') ||
    id.includes('stable-diffusion') ||
    id.includes('sdxl') ||
    id.includes('imagine-image') ||
    id.includes('imagine-video') ||
    id.includes('image-generation') ||
    id.includes('video-generation') ||
    /\bimage[-_]?gen/.test(id) ||
    /\bvideo[-_]?gen/.test(id)
  );
}

function isAudioOnlyModelId(id: string): boolean {
  return (
    /(?:^|[-_/])(tts|whisper|transcribe|transcriber|transcribing|transcription)(?:$|[-_/])/.test(
      id,
    ) ||
    id.includes('text-to-speech') ||
    id.includes('speech-generation') ||
    id.includes('audio-only')
  );
}

export interface TextFallbackCompatibilityInput {
  providerModelId: string;
  protocol: ProtocolFamily;
  capabilities?: readonly CapabilityTag[];
}

/**
 * Conservative guard for chat fallback walks. It deliberately distrusts stale
 * catalog tags when the protocol/model id clearly identifies a non-text model.
 */
export function isTextFallbackCompatibleModel(input: TextFallbackCompatibilityInput): boolean {
  const id = input.providerModelId.trim().toLowerCase();
  const capabilities = normalizeCapabilities(input.capabilities);
  if (input.protocol === 'openai-images') return false;
  if (capabilities.includes('image-generation') || capabilities.includes('embeddings')) {
    return false;
  }
  if (isEmbeddingModelId(id) || isGeneratedMediaModelId(id) || isAudioOnlyModelId(id)) {
    return false;
  }
  if (capabilities.length > 0 && !capabilities.includes('text')) return false;
  return (
    input.protocol === 'openai-chat' ||
    input.protocol === 'openai-responses' ||
    input.protocol === 'anthropic-messages'
  );
}

/**
 * Local heuristic capability probe suggestions (product §7.2).
 *
 * Probe results are suggestions, never immutable facts — caller must leave
 * `capabilitiesConfirmed` false until the user confirms or edits tags.
 */
export function suggestCapabilities(input: CapabilitySuggestionInput): CapabilitySuggestion {
  const providerModelId = input.providerModelId.trim();
  const id = providerModelId.toLowerCase();
  const protocol = input.protocol;
  const reasons: string[] = [];
  const flags: Partial<Record<CapabilityTag, boolean>> = {};

  const isImageProtocol = protocol === 'openai-images';
  const isEmbedding = isEmbeddingModelId(id);
  const isImageGen = isGeneratedMediaModelId(id) || isImageProtocol;
  const isVision =
    !isEmbedding &&
    !isImageGen &&
    (/\bgpt-4o\b/.test(id) ||
      id.includes('vision') ||
      id.includes('gpt-4-turbo') ||
      /\bclaude-3/.test(id) ||
      id.includes('gemini') ||
      id.includes('llava') ||
      id.includes('qwen-vl') ||
      id.includes('pixtral') ||
      id.includes('multimodal'));
  const isTool =
    !isEmbedding &&
    !isImageGen &&
    (protocol === 'openai-chat' ||
      protocol === 'openai-responses' ||
      protocol === 'anthropic-messages') &&
    (id.includes('gpt-4') ||
      id.includes('gpt-3.5') ||
      id.includes('o1') ||
      id.includes('o3') ||
      id.includes('o4') ||
      id.includes('claude') ||
      id.includes('gemini') ||
      id.includes('mistral') ||
      id.includes('command-r') ||
      id.includes('deepseek') ||
      id.includes('qwen') ||
      id.includes('tool') ||
      id.includes('function'));

  if (isEmbedding) {
    flags.embeddings = true;
    reasons.push('model id looks like an embedding model');
  } else if (isImageGen) {
    flags['image-generation'] = true;
    reasons.push(
      isImageProtocol ? 'openai-images protocol' : 'model id looks like image generation',
    );
  } else {
    flags.text = true;
    reasons.push('chat/messages protocol defaults to text');
    if (isVision) {
      flags.vision = true;
      reasons.push('model id suggests multimodal / vision');
    }
    if (isTool) {
      flags['tool-calling'] = true;
      reasons.push('modern chat model id suggests tool calling');
    }
  }

  if (protocol === 'openai-images') {
    flags['image-generation'] = true;
  }
  if (
    (protocol === 'openai-chat' ||
      protocol === 'openai-responses' ||
      protocol === 'anthropic-messages') &&
    !isEmbedding &&
    !isImageGen
  ) {
    flags.text = true;
  }

  const suggested = CAPABILITY_TAGS.filter((tag) => flags[tag] === true);
  const capabilities = mergeCapabilitySuggestions(input.existing, suggested);
  const results: Partial<Record<CapabilityTag, boolean>> = {};
  for (const tag of capabilities) {
    results[tag] = true;
  }

  const confidence: CapabilitySuggestion['confidence'] =
    suggested.length > 1 || isEmbedding || isImageGen || isVision ? 'medium' : 'low';

  return {
    modelId: input.modelId,
    providerModelId,
    protocol,
    capabilities,
    results,
    capabilitiesConfirmed: false,
    source: 'heuristic',
    confidence,
    reasons,
  };
}
