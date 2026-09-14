/**
 * Vision capability resolution — a port of NewMax's three-state model.
 *
 * NewMax never stores vision support as a bare boolean. `resolveVisionState`
 * answers `supported` / `unsupported` / `unknown`, and the two failure modes of
 * a live probe are deliberately kept apart:
 *
 *   - the model genuinely refuses image input      -> unsupported
 *   - the probe never reached the model (auth,     -> unknown
 *     rate limit, timeout, network, HTTP rejection)
 *
 * Treating the second kind as "unsupported" is what silently downgrades a
 * perfectly multimodal model to Windows OCR. `getReliableImageCapability`
 * exists precisely to stop that: it only trusts a negative answer when the
 * probe reason is about the model, not about the wire.
 *
 * Resolution order (mirrors NewMax `resolveVisionState`):
 *   1. manual override            (authoritative, user said so)
 *   2. reliable probe/catalog tag
 *   3. known vision-support table (per-provider sets + model-name patterns)
 *   4. unknown
 */

/** Three-state vision answer. `unknown` is a real answer, not a failure. */
export type VisionState = 'supported' | 'unsupported' | 'unknown';

export interface ModelVisionFacts {
  /** Catalog provider id; may be a built-in preset id or a user-created id. */
  providerId?: string;
  /** Provider-facing model id, e.g. `gpt-6-astra`. */
  providerModelId: string;
  /** Confirmed/suggested capability tags for this model. */
  capabilities?: readonly string[];
  /** Whether `capabilities` was user-confirmed rather than probe-suggested. */
  capabilitiesConfirmed?: boolean;
  /** User's explicit yes/no, which outranks every probe (NewMax `manualOverrides.image`). */
  manualOverride?: boolean;
  /** Probe failure reason for the image capability (NewMax `reasons.image`). */
  probeReason?: string;
  /** Persisted direct image-probe result (`image` in NewMax modelCapabilities). */
  visionCapability?: boolean;
}

/** Verified subscription models that natively accept images. */
const VERIFIED_GROK_MODELS: Record<string, { image: boolean }> = {
  'grok-4.6': { image: true },
  'grok-4.5': { image: true },
};

function getVerifiedGrokModel(modelId: string): { image: boolean } | undefined {
  const model = modelId.trim().toLowerCase().replace(/^x-ai\//, '');
  return Object.entries(VERIFIED_GROK_MODELS).find(
    ([id]) => model === id || model.startsWith(`${id}-`),
  )?.[1];
}

/** `gpt-6-astra` is multimodal; NewMax pins it by name rather than by probe. */
export function isGpt6AstraModel(modelId: string): boolean {
  return /^(?:openai\/)?gpt-6-astra(?:$|[-_.])/i.test(modelId.trim());
}

/**
 * Per-provider vision allow-lists. NewMax keeps these because some channels
 * (OAuth/subscription endpoints) physically cannot be probed, and because a
 * blanket allow-list previously mislabelled text-only models as confirmed.
 */
const KNOWN_VISION_MODELS: Record<string, ReadonlySet<string>> = {
  // DeepSeek 官方 API 的 V4 Flash Vision 实验模型原生支持 Anthropic / OpenAI 图片块。
  deepseek: new Set(['deepseek-v4-flash-vision-exp']),
  // xAI OAuth 走非标准端点，probe 打不通；当前订阅目录保留 4.6 与 4.5。
  'grok-oauth': new Set(
    Object.keys(VERIFIED_GROK_MODELS).filter((id) => VERIFIED_GROK_MODELS[id]?.image),
  ),
  // Antigravity 订阅（Google 自家协议，标准 probe 打不通）：只登记实测能识图的模型，
  // 未登记的自动 fallback 到 unknown，避免 GPT-OSS / extra-low effort 被误标"已确认"。
  'antigravity-oauth': new Set([
    'gemini-3.5-flash-low',
    'gemini-3-flash-agent',
    'gemini-3.1-pro-low',
    'gemini-pro-agent',
    'claude-sonnet-4-6',
    'claude-opus-4-6-thinking',
  ]),
  // openai-oauth = OpenAI 官方 OAuth 端点（非第三方中转）：probe 物理上跑不通
  // （Responses API 强制 stream，probe 走非流式会被直接拒绝），静态表才是正确做法。
  'openai-oauth': new Set([
    'gpt-6-astra',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.5',
    'gpt-5.5-pro',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.2',
  ]),
};

/** NewMax's built-in Claude provider accepts image input without probing. */
const VISION_NATIVE_PROVIDERS = new Set(['default']);

/**
 * Per-provider text-only denials. These exist to stop `unknown` from letting a
 * raw image reach an upstream that answers 400 — the failure NewMax documents
 * for GLM coding models and DeepSeek V4 Pro/Flash.
 */
const KNOWN_NON_VISION_MODELS: Record<string, ReadonlySet<string>> = {
  // 只有 Spark 是纯文本；普通 GPT-5.2/5.3-Codex 支持图片输入。
  'openai-oauth': new Set(['gpt-5.3-codex-spark']),
  'antigravity-oauth': new Set(['gpt-oss-120b-medium', 'gemini-3.5-flash-extra-low']),
  // GLM Coding / OpenCode Go 的编程模型会对 image 块返回 "Model only support text input"；
  // DeepSeek V4 Pro / Flash 同为纯文本，视觉输入只由独立的 deepseek-v4-flash-vision-exp 提供。
  'opencode-go': new Set(['glm-5.3', 'glm-5.2', 'glm-5.1', 'deepseek-v4-pro', 'deepseek-v4-flash']),
  deepseek: new Set(['deepseek-v4-pro', 'deepseek-v4-flash']),
  zhipu: new Set(['glm-5.3[1m]', 'glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7']),
  zai: new Set(['glm-5.3[1m]', 'glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-5-turbo', 'glm-4.7']),
};

/** Text-only model ids that carry no provider context. */
const KNOWN_TEXT_ONLY_MODEL_IDS: ReadonlySet<string> = new Set([
  'qianfan-ipcharacter',
  'longcat-2.0',
  'longcat-2.0-int8',
  'longcat-2.0-fp8',
  'longcat-flash-chat',
  'longcat-flash-chat-fp8',
  'longcat-flash-thinking',
  'longcat-flash-thinking-fp8',
  'longcat-flash-thinking-2601',
  'longcat-flash-thinking-2601-fp8',
  'longcat-flash-thinking-zigzag',
  'longcat-flash-lite',
  'longcat-flash-lite-fp8',
  'longcat-flash-lite-sparse',
  'longcat-flash-prover',
  'longcat-heavymode-summary',
]);

/**
 * Model-name classification, independent of provider. Returns `null` when the
 * name carries no signal — callers must then fall through to `unknown` rather
 * than assuming text-only.
 */
export function getKnownModelVisionSupport(modelId: string): boolean | null {
  const normalized = modelId.trim().toLowerCase();
  const model = normalized.split('/').filter(Boolean).at(-1) ?? normalized;

  if (
    /^gpt-5\.3-codex-spark(?:$|[._-])/.test(model) ||
    /^gpt-5\.3-codex(?:$|[._-])/.test(model) ||
    /^gpt-oss(?:$|[._-])/.test(model) ||
    /^gemini-.*extra-low(?:$|[._-])/.test(model)
  ) {
    return false;
  }

  if (
    /^deepseek-v4-flash-vision-exp(?:$|[._-])/.test(model) ||
    getVerifiedGrokModel(model)?.image === true ||
    /^gpt-5(?:$|[._-])/.test(model) ||
    isGpt6AstraModel(model) ||
    /^claude-(?:opus|sonnet|haiku)(?:$|[._-])/.test(model) ||
    /^gemini-(?:\d|pro-agent)/.test(model) ||
    /^glm-(?:4\.6v|5v-turbo|5\.3-flash)(?:$|-)/.test(model) ||
    /^qwen3\.(?:[567]-(?:plus|flash)|8-(?:max|flash))(?:$|-)/.test(model) ||
    model === 'qwen3.7-max-2026-06-08' ||
    /^qwen3\.5-(?:35b-a3b|397b-a17b|122b-a10b|27b|omni-(?:plus|flash))(?:$|-)/.test(model) ||
    /^qwen3\.6-35b-a3b(?:$|-)/.test(model) ||
    /^qwen3-vl(?:$|-)/.test(model) ||
    /^kimi-(?:k3|k2\.[56]|k2\.7-code)(?:$|-)/.test(model) ||
    /^minimax-m3(?:$|-)/.test(model) ||
    /^(?:doubao-)?seed-2[.-][01](?:$|[._-])/.test(model) ||
    /^(?:doubao-)?seed-evolving(?:$|[._-])/.test(model) ||
    /^step-3\.7(?:$|-)/.test(model) ||
    /^mimo-v2\.5(?:$|-)/.test(model) ||
    /^hy3(?:$|-)/.test(model) ||
    /^longcat-(?:flash-omni|next)(?:$|-)/.test(model) ||
    /^qianfan-vl-(?:3b|8b|70b)(?:$|-)/.test(model)
  ) {
    return true;
  }

  if (
    /^deepseek-/.test(model) ||
    /^glm-(?:5(?:$|-)|5\.[123](?:$|[-[])|4\.7(?:$|-)|4\.5-air(?:$|-))/.test(model) ||
    /^qwen3(?:\.6-max|[-.]max)(?:$|-)/.test(model) ||
    /^minimax-m2(?:$|[.-])/.test(model) ||
    /^step-3\.5(?:$|-)/.test(model) ||
    KNOWN_TEXT_ONLY_MODEL_IDS.has(model)
  ) {
    return false;
  }

  return null;
}

/**
 * Combine the per-provider tables with the model-name classification.
 * Returns `null` for "no idea" so the caller can answer `unknown`.
 */
export function getKnownVisionSupport(
  providerId: string | undefined,
  modelId: string,
): boolean | null {
  if (providerId) {
    if (KNOWN_NON_VISION_MODELS[providerId]?.has(modelId)) return false;
    if (KNOWN_VISION_MODELS[providerId]?.has(modelId)) return true;
  }
  const modelSupport = getKnownModelVisionSupport(modelId);
  if (modelSupport !== null) return modelSupport;
  if (providerId === 'antigravity-oauth') {
    if (/^gemini-/i.test(modelId)) return !/extra-low/i.test(modelId);
    if (/^claude-/i.test(modelId)) return true;
  }
  return null;
}

/**
 * True when a probe failure says nothing about the model's abilities — the
 * request never got a verdict (auth, quota, timeout, transport, HTTP reject).
 * Ported verbatim from NewMax `getReliableImageCapability`.
 */
export function isVisionProbeFailureEnvironmental(reason: string): boolean {
  const text = reason.trim();
  if (!text) return false;
  return (
    /^(?:探测请求被拒绝|Probe request was rejected) \(HTTP \d{3}\)$/i.test(text) ||
    /API 密钥无效|鉴权失败|未授权|限流|请求超时|连接超时|网络异常|网络错误|服务器错误|服务异常|连接被拒绝|网络不可达|API key.{0,24}invalid|authentication failed|unauthori[sz]ed|rate limit|timed? out|timeout|network error|server error|fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up|aborted/i.test(
      text,
    )
  );
}

/**
 * Provider-agnostic alias of {@link isVisionProbeFailureEnvironmental}.
 *
 * The predicate itself says nothing about vision — it answers "did this probe
 * ever reach the model?". Every probe dimension (text, tools, thinking,
 * hosted search, image generation) needs that same answer, so use this name
 * outside the image path to keep the intent readable.
 */
export const isEnvironmentalProbeFailure = isVisionProbeFailureEnvironmental;

/**
 * Coarse failure taxonomy used by the settings UI to pick a tag + colour.
 * Mirrors NewMax `classifyVisionProbeFailure`.
 */
export type VisionProbeFailureKind =
  | 'authentication'
  | 'unsupported'
  | 'rateLimit'
  | 'responseMismatch'
  | 'timeout'
  | 'network'
  | 'unknown';

export function classifyVisionProbeFailure(reason: string): VisionProbeFailureKind {
  const text = reason.trim();
  if (!text) return 'unsupported';
  if (/API 密钥无效|鉴权失败|未授权|authentication failed|unauthori[sz]ed|invalid.{0,24}api key/i.test(text)) {
    return 'authentication';
  }
  if (/限流|rate limit|quota|too many requests|429/i.test(text)) return 'rateLimit';
  if (/请求超时|连接超时|timed? out|timeout/i.test(text)) return 'timeout';
  if (/网络异常|网络错误|服务器错误|服务异常|network error|server error|fetch failed|ECONN|ENOTFOUND|socket/i.test(text)) {
    return 'network';
  }
  if (/校验码|marker|未识别|未返回任何内容|空内容|mismatch|empty/i.test(text)) {
    return 'responseMismatch';
  }
  if (/不支持|not support|unsupported|拒绝|rejected/i.test(text)) return 'unsupported';
  return 'unknown';
}

/**
 * The only capability answer we are willing to act on.
 *
 * Returns:
 *   `true`      — the model takes images
 *   `false`     — the model does not, and we actually know it
 *   `undefined` — the negative answer is untrustworthy; fall through to the
 *                 known-support tables instead of downgrading to OCR
 */
export function getReliableImageCapability(facts: ModelVisionFacts): boolean | undefined {
  if (facts.manualOverride !== undefined) return facts.manualOverride;

  // A probe that failed before reaching the model invalidates any unconfirmed
  // positive suggestion for this dimension. The known-model table below may
  // still provide a separate static answer.
  if (
    facts.visionCapability === undefined &&
    facts.probeReason &&
    isVisionProbeFailureEnvironmental(facts.probeReason) &&
    !facts.capabilitiesConfirmed
  ) {
    return undefined;
  }

  const declared = facts.capabilities?.includes('vision') ?? undefined;

  // A live per-dimension probe result outranks the aggregate capability tags.
  // NewMax stores these independently, so a stale tag set cannot mask a
  // successful image probe.
  if (facts.visionCapability === true) return true;
  if (facts.visionCapability === false) {
    if (facts.probeReason && isVisionProbeFailureEnvironmental(facts.probeReason)) {
      return undefined;
    }
    return false;
  }

  // A confirmed capability edit is the manual answer for this dimension. Keep
  // an environmental failure as unknown, matching NewMax's rule that a failed
  // request must not turn a capable model into an OCR-only model.
  if (facts.capabilitiesConfirmed) {
    if (declared === true) return true;
    if (facts.probeReason && isVisionProbeFailureEnvironmental(facts.probeReason)) {
      return undefined;
    }
    return false;
  }

  // No `vision` tag: distinguish "the model said no" from "nobody ever asked".
  // Unconfirmed tags are probe suggestions, so a missing tag carries no weight.
  if (declared === undefined || !facts.capabilitiesConfirmed) return undefined;
  // Confirmed negative: still refuse to trust it when the probe was an env failure.
  if (facts.probeReason && isVisionProbeFailureEnvironmental(facts.probeReason)) return undefined;
  return false;
}

/**
 * Resolve the three-state vision answer.
 *
 * Unlike the boolean helpers this replaces, `unknown` never collapses into
 * "unsupported" — that collapse is what pushed capable models onto Windows OCR.
 */
export function resolveVisionState(facts: ModelVisionFacts): VisionState {
  const image = getReliableImageCapability(facts);
  if (image === true) return 'supported';
  if (image === false) return 'unsupported';

  const known = getKnownVisionSupport(facts.providerId, facts.providerModelId);
  if (known === true) return 'supported';
  if (known === false) return 'unsupported';
  if (facts.providerId && VISION_NATIVE_PROVIDERS.has(facts.providerId)) return 'supported';

  return 'unknown';
}
