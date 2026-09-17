/**
 * 视觉能力判定 —— 逐字对齐 NewMax `settingsStore` 里的同名实现。
 *
 * NewMax 从不把视觉支持存成一个裸布尔。能力挂在
 * `provider.modelCapabilities[modelId] = { image, document, video, reasons, manualOverrides }`，
 * 由 `getModelCapabilities` 读取并**每次重放** `manualOverrides`，再交给
 * `getReliableImageCapability` 得出唯一可信的答案。
 *
 * `resolveVisionState` 的回答是三态 `supported` / `unsupported` / `unknown`，
 * 而两种失败模式被刻意分开：
 *
 *   - 模型确实拒答图片（读了探针图但明确说看不见）  -> unsupported
 *   - 请求根本没打到模型（鉴权/限流/超时/网络/HTTP 拒绝）-> unknown
 *
 * 把第二种当 `unsupported`，正是「把好端端的多模态模型静默降级到 Windows OCR」
 * 的元凶。`getReliableImageCapability` 存在的唯一理由就是挡掉它：负向答案只有在
 * 说的是模型、而不是线路时，才被采信。
 *
 * 判定顺序（逐字对齐 NewMax `resolveVisionState`）：
 *   1. `getReliableImageCapability` 为 true  -> supported
 *   2. `getReliableImageCapability` 为 false -> unsupported
 *   3. `getKnownVisionSupport` 为 true       -> supported
 *   4. `getKnownVisionSupport` 为 false      -> unsupported
 *   5. 内置 Claude 通道（`default`）          -> supported
 *   6. 其余                                   -> unknown
 */

/** Three-state vision answer. `unknown` is a real answer, not a failure. */
export type VisionState = 'supported' | 'unsupported' | 'unknown';

/**
 * NewMax `manualOverrides`：用户在设置里手写的答案，优先级压倒一切探测结果。
 * 它随 provider 持久保存，每次读取时重放，所以重新扫描也冲不掉。
 */
export interface ModelCapabilityOverrides {
  image?: boolean;
  document?: boolean;
  video?: boolean;
  thinking?: boolean;
  reasoning?: boolean;
  contextWindow?: number;
}

/**
 * NewMax `provider.modelCapabilities[modelId]` 的形态。
 * `image` 是探测/测试写入的结论，`reasons.image` 是结论的理由（失败原因）。
 */
export interface ModelCapabilities {
  image?: boolean;
  document?: boolean;
  video?: boolean;
  thinking?: boolean;
  reasoning?: boolean;
  contextWindow?: number;
  /** 每个能力维度的失败原因（探测/模型测试写入）。 */
  reasons?: Record<string, string>;
  manualOverrides?: ModelCapabilityOverrides;
}

/** `getModelCapabilities` / `resolveVisionState` 需要的 provider 侧面貌。 */
export interface CapabilityProviderLike {
  id: string;
  capabilities?: ModelCapabilities;
  modelCapabilities?: Record<string, ModelCapabilities>;
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
 *
 * 逐字对齐 NewMax `getKnownModelVisionSupport`。
 */
export function getKnownModelVisionSupport(modelId: string): boolean | null {
  const normalized = modelId.trim().toLowerCase();
  const model = normalized.split('/').filter(Boolean).at(-1) ?? normalized;

  if (
    /^gpt-5\.3-codex-spark(?:$|[._-])/.test(model) ||
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
  if (KNOWN_NON_VISION_MODELS[providerId ?? '']?.has(modelId)) return false;
  if (KNOWN_VISION_MODELS[providerId ?? '']?.has(modelId)) return true;
  const modelSupport = getKnownModelVisionSupport(modelId);
  if (modelSupport !== null) return modelSupport;
  if (providerId === 'antigravity-oauth') {
    if (/^gemini-/i.test(modelId)) return !/extra-low/i.test(modelId);
    if (/^claude-/i.test(modelId)) return true;
  }
  return null;
}

/**
 * 重放 `manualOverrides` 到能力对象上 —— 逐字对齐 NewMax
 * `applyProviderCapabilityManualOverrides`。
 *
 * 覆盖项持久保存在 provider 上，每次读取时重新叠加，所以一次目录刷新 /
 * 重新扫描都冲不掉用户的答案。`contextWindow` 不进能力位，单独由
 * `getEffectiveModelContextWindows` 消费；`thinking: false` 会清掉 `reasoning`。
 */
export function applyProviderCapabilityManualOverrides(
  capabilities: ModelCapabilities | undefined,
): ModelCapabilities | undefined {
  const overrides = capabilities?.manualOverrides;
  if (!capabilities || !overrides) return capabilities;
  const { contextWindow: _contextWindow, ...capabilityOverrides } = overrides;
  const hasManualReasoning = Object.prototype.hasOwnProperty.call(overrides, 'reasoning');
  const reasoning = hasManualReasoning
    ? overrides.reasoning
    : overrides.thinking === false
      ? undefined
      : capabilities.reasoning;
  return { ...capabilities, ...capabilityOverrides, reasoning, manualOverrides: overrides };
}

/**
 * 取某个模型的能力对象 —— 逐字对齐 NewMax `getModelCapabilities`。
 *
 * `grok-oauth` 是特例：非白名单模型直接返回 undefined（该通道走非标准端点，
 * 能力不能按目录默认值推断）。
 */
export function getModelCapabilities(
  provider: CapabilityProviderLike | undefined,
  modelId: string,
): ModelCapabilities | undefined {
  if (!provider) return undefined;
  const perModel = provider.modelCapabilities?.[modelId];
  if (perModel) return applyProviderCapabilityManualOverrides(perModel);
  if (provider.id === 'grok-oauth' && !getVerifiedGrokModel(modelId)) return undefined;
  return applyProviderCapabilityManualOverrides(provider.capabilities);
}

/**
 * 唯一被采信的图片能力答案 —— 逐字对齐 NewMax `getReliableImageCapability`。
 *
 * 返回：
 *   `true`      — 模型能收图
 *   `false`     — 模型不能收图，而且我们确实知道
 *   `undefined` — 这个负向答案不可信；交给已知支持表裁决，**不要**降级到 OCR
 */
export function getReliableImageCapability(
  capabilities: ModelCapabilities | undefined,
): boolean | undefined {
  if (capabilities?.manualOverrides?.image !== undefined) {
    return capabilities.manualOverrides.image;
  }
  if (capabilities?.image !== false) return capabilities?.image;

  const reason = capabilities.reasons?.image?.trim() ?? '';
  if (
    /^(?:探测请求被拒绝|Probe request was rejected) \(HTTP \d{3}\)$/i.test(reason) ||
    /API 密钥无效|鉴权失败|未授权|限流|请求超时|连接超时|网络异常|网络错误|服务器错误|服务异常|API key.{0,24}invalid|authentication failed|unauthori[sz]ed|rate limit|timed? out|timeout|network error|server error/i.test(
      reason,
    )
  ) {
    return undefined;
  }
  return false;
}

/**
 * 三态判定 —— 逐字对齐 NewMax `resolveVisionState`。
 *
 * 与它取代的布尔版不同，`unknown` 永不塌缩成 `unsupported`：
 * 塌缩正是把可用模型推去跑 Windows OCR 的那一步。
 */
export function resolveVisionState(
  provider: CapabilityProviderLike | undefined,
  providerId: string,
  modelId: string,
): VisionState {
  const capabilities = getModelCapabilities(provider, modelId);
  const reliable = getReliableImageCapability(capabilities);
  const known = getKnownVisionSupport(providerId, modelId);

  if (reliable === true) return 'supported';
  if (reliable === false) return 'unsupported';
  if (known === true) return 'supported';
  if (known === false) return 'unsupported';
  if (VISION_NATIVE_PROVIDERS.has(providerId)) return 'supported';
  return 'unknown';
}

/**
 * 备用模型自身的视觉能力 —— 逐字对齐 NewMax `resolveVerifiedFallbackVisionState`。
 *
 * 只认该备用通道**自己的**能力数据（不做已知表兜底），因为我们要回答的是
 * 「这个具体的备用模型能不能看图」，而不是「这个型号通常行不行」。
 */
export function resolveVerifiedFallbackVisionState(
  provider: CapabilityProviderLike | undefined,
  providerId: string,
  modelId: string,
): VisionState {
  if (providerId === 'default') return 'supported';
  const reliable = getReliableImageCapability(provider?.modelCapabilities?.[modelId]);
  if (reliable === true) return 'supported';
  if (reliable === false) return 'unsupported';
  return 'unknown';
}
