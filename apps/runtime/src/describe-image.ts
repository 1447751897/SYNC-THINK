/**
 * Vision fallback for kernels / models without image input support.
 *
 * Strategy (NewMax-style "vision fallback"):
 *   - If the running model is vision-capable, images are forwarded as-is.
 *   - If the model is likely text-only (e.g. deepseek), the host calls the
 *     configured vision model, then up to two verified candidates, to describe
 *     each image and injects the description as text.
 *   - Capability tags are authoritative when confirmed; model-name heuristics
 *     cover catalog entries that have not been confirmed yet.
 *
 * Everything here is pure and unit-testable; the runtime supplies the actual
 * provider call (`describeImages` deps) and the model catalog.
 */

import {
  getKnownModelVisionSupport,
  resolveVerifiedFallbackVisionState,
  resolveVisionState,
  type ModelCapabilities,
  type CapabilityProviderLike,
  type VisionState,
} from '@sync-think/core';
import type { ModelRecord } from '@sync-think/storage';

export type { VisionState };

export interface DescribeImageInput {
  name: string;
  mimeType: string;
  dataUrl: string;
}

/**
 * App-level KV key for the Settings > Models > 图片识别 Fallback option.
 * Value shape: `{ enabled, providerId, modelId }`. The provider id is stored
 * with the model so identical provider-facing ids cannot select the wrong key.
 * Legacy values without providerId remain readable during migration.
 */
export const VISION_FALLBACK_SETTING_KEY = 'vision-fallback';

/** Runtime-side parsed shape of the vision-fallback setting. */
export interface VisionFallbackSetting {
  enabled: boolean;
  providerId: string | null;
  modelId: string | null;
}

export interface ImageToolGuidanceOptions {
  /** Legacy boolean input; callers should pass the full three-state answer. */
  visionCapable?: boolean;
  visionState?: VisionState;
  visionFallbackEnabled: boolean;
  /** External kernels expose image tools through namespaced MCP servers. */
  externalKernel: boolean;
}

/**
 * Keep image-tool prompting out of native multimodal turns. OCR and visual
 * fallback are recovery paths for text-only models, not a prerequisite for a
 * model that can consume the original pixels.
 */
export function buildImageToolGuidance(options: ImageToolGuidanceOptions): string[] {
  const state = options.visionState ?? (options.visionCapable ? 'supported' : 'unsupported');
  if (state === 'supported') return [];
  if (state === 'unknown') {
    return [
      '当前模型未确认支持识图，发送时会先尝试当前模型的原生图片输入；也可去模型设置重新检测。',
    ];
  }

  const ocrTool = options.externalKernel
    ? '`mcp__windows-ocr__ocr_image`（Claude Code）或 `mcp__sync-think-platform__ocr_image`（Codex / Pi）'
    : '`ocr_image`';
  const guidance = [
    [
      '## 图片文字识别（Windows OCR）',
      `当前模型不支持直接读取图片。只在需要提取工作区图片中的文字时调用 ${ocrTool}，并传入图片路径作为 \`path\`。`,
      'OCR 只提取可辨认文字，不代表完整画面；不要读取图片二进制后猜测内容。',
    ].join('\n'),
  ];

  if (options.visionFallbackEnabled) {
    const describeTool = options.externalKernel
      ? '`mcp__vision-fallback__describe_image`'
      : '`describe_image`';
    guidance.push(
      [
        '## 图像理解（vision fallback）',
        `需要理解工作区图片中的画面、物体或布局时，调用 ${describeTool} 并传入图片路径作为 \`path\`。`,
        '宿主会使用设置中选定的视觉模型返回描述。',
      ].join('\n'),
    );
  }

  return guidance;
}

export function parseVisionFallbackSetting(raw: unknown): VisionFallbackSetting {
  // NewMax keeps the Fallback switch enabled by default; the selected model is
  // a separate requirement and is checked by the runtime before use.
  if (!raw || typeof raw !== 'object') return { enabled: true, providerId: null, modelId: null };
  const record = raw as Record<string, unknown>;
  return {
    enabled: record.enabled !== false,
    providerId:
      typeof record.providerId === 'string' && record.providerId.trim() ? record.providerId.trim() : null,
    modelId: typeof record.modelId === 'string' && record.modelId.trim() ? record.modelId : null,
  };
}

/** Provider-facing model id strings that are known text-only. */
const NON_VISION_MODEL_PATTERNS: RegExp[] = [
  /deepseek/i,
  /^(?!qwen[0-9.]*-vl)qwen[0-9.]*/i,
  /\btext-[a-z0-9.]+/i,
  /^gemma-?\d/i,
];

/** Provider-facing model id strings that advertise image input. */
const VISION_MODEL_PATTERNS: RegExp[] = [
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-[5-9]/i,
  /\bo[34]\b/i,
  /\bo[45]-/i,
  /grok/i,
  /gemini/i,
  /claude/i,
  /-vl\b/i,
  /\/vl\d/i,
  /vision/i,
  /pixtral/i,
  /llava/i,
  /internvl/i,
];

/**
 * Decide whether an unconfirmed provider model id should be treated as
 * vision-capable. The NewMax known-support table answers first (it pins ids
 * such as `gpt-6-astra` by name); the legacy patterns remain a safety net for
 * families the table does not list. Ids nothing recognises stay `false` here —
 * callers that need the third answer use {@link catalogEntryVisionState}.
 */
export function isModelVisionCapable(providerModelId: string): boolean {
  const id = providerModelId.trim();
  if (!id) return false;
  const known = getKnownModelVisionSupport(id);
  if (known !== null) return known;
  // Explicit multimodal markers win over a text-only family marker, e.g.
  // `deepseek-vision-exp` and `qwen2.5-vl`.
  if (VISION_MODEL_PATTERNS.some((pattern) => pattern.test(id))) return true;
  if (NON_VISION_MODEL_PATTERNS.some((pattern) => pattern.test(id))) return false;
  return false;
}

export interface CatalogModelEntry {
  modelId: string;
  providerModelId: string;
  protocol: string;
  /** Owning provider id; scopes the per-provider vision tables. */
  providerId?: string;
  /** Confirmed capability tags when the host probed/catalogued them. */
  capabilities?: string[];
  /** Whether `capabilities` is authoritative (probed) rather than best-effort. */
  capabilitiesConfirmed?: boolean;
  /** Probe failure reason for the image capability, when one was recorded. */
  probeReason?: string;
  /** Persisted NewMax-style image probe result, when present. */
  visionCapability?: boolean;
  /**
   * 用户手写的图片能力答案（NewMax `manualOverrides.image`）。**优先于探针**，
   * 是探针跑不通时唯一能把模型认定为「能看图」的通道。
   */
  visionManualOverride?: boolean;
  /** Provider entry enabled (false = hidden from pickers/execution). */
  enabled?: boolean;
}

/**
 * Project a persisted model onto the catalog entry the vision helpers read.
 *
 * This is the **only** place that builds a {@link CatalogModelEntry} from a
 * `ModelRecord`. Hand-built partial entries are how the user's manual image
 * answer silently disappeared: `visionManualOverride` is the easiest field to
 * forget, and dropping it makes {@link catalogEntryVisionCapable} answer from
 * the probe alone. That is not a cosmetic loss — it filtered a hand-marked
 * image model out of the fallback chain (so a run paused instead of switching),
 * and it let an image reach a model the user had explicitly marked text-only.
 */
export function toCatalogModelEntry(
  model: ModelRecord,
  options: { enabled?: boolean } = {},
): CatalogModelEntry {
  return {
    modelId: model.id,
    providerModelId: model.providerModelId,
    providerId: model.providerId,
    protocol: model.protocol,
    capabilities: model.capabilities,
    capabilitiesConfirmed: model.capabilitiesConfirmed,
    visionCapability: model.visionCapability,
    visionManualOverride: model.visionManualOverride,
    probeReason: model.visionProbeReason,
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
  };
}

/**
 * Project a catalog entry onto NewMax's `provider.modelCapabilities[modelId]`.
 *
 * SYNC-THINK persists the same two facts under different names —
 * `visionCapability` is NewMax's `image`, `probeReason` is `reasons.image` —
 * and stores them in `limits_json` as `_visionCapability` /
 * `_visionProbeReason`. The legacy `capabilities` / `capabilitiesConfirmed`
 * tag list deliberately does **not** take part: NewMax has no such input, and
 * feeding it in would let a mere catalogue tag outrank an actual probe.
 *
 * `visionManualOverride` is the one exception, and it is not a tag: it is the
 * user's own answer to "can this model take images", authored in the capability
 * panel. NewMax replays `manualOverrides` on every read precisely so it outranks
 * probes, which is what makes the vision fallback chain usable at all when a
 * relay station cannot serve the probe PNG.
 */
export function entryModelCapabilities(entry: CatalogModelEntry): ModelCapabilities {
  return {
    image: entry.visionCapability,
    reasons: entry.probeReason ? { image: entry.probeReason } : undefined,
    ...(entry.visionManualOverride !== undefined
      ? { manualOverrides: { image: entry.visionManualOverride } }
      : {}),
  };
}

/**
 * Provider face consumed by `getModelCapabilities` / `resolveVisionState` /
 * `resolveVerifiedFallbackVisionState`.
 *
 * The result must hang off `modelCapabilities[modelId]`, not the provider-level
 * `capabilities`: NewMax's verified-fallback check reads the per-model entry
 * only, and a provider default would silently answer for the wrong model.
 */
function entryCapabilityProvider(entry: CatalogModelEntry): CapabilityProviderLike {
  return {
    id: entry.providerId ?? '',
    modelCapabilities: { [entry.providerModelId]: entryModelCapabilities(entry) },
  };
}

/**
 * Three-state vision answer for a catalog entry.
 *
 * A probe that merely failed to reach the provider is NOT the same as "the
 * model refuses images": NewMax keeps the answer `unknown` there and lets the
 * known-support table decide. Collapsing that to `unsupported` is what sent
 * multimodal models to Windows OCR.
 */
export function catalogEntryVisionState(entry: CatalogModelEntry): VisionState {
  return resolveVisionState(
    entryCapabilityProvider(entry),
    entry.providerId ?? '',
    entry.providerModelId,
  );
}

/**
 * Boolean view used by the fallback-model picker: only a definite `supported`
 * model may serve as the image description model.
 */
export function catalogEntryVisionCapable(entry: CatalogModelEntry): boolean {
  return catalogEntryVisionState(entry) === 'supported';
}

/** NewMax's fallback executor requires a verified positive image result. */
export function catalogEntryVisionVerified(entry: CatalogModelEntry): boolean {
  // NewMax's built-in Claude provider is a trusted native vision channel and
  // does not need a user-run probe before it can serve as fallback.
  if (entry.providerId === 'default' && entry.enabled !== false) return true;
  return (
    resolveVerifiedFallbackVisionState(
      entryCapabilityProvider(entry),
      entry.providerId ?? '',
      entry.providerModelId,
    ) === 'supported'
  );
}

/** Build NewMax's bounded chain: configured model first, then two verified candidates. */
export function resolveVisionDescribeModels(
  catalog: readonly CatalogModelEntry[],
  configuredModelId?: string,
  limit = 3,
  configuredProviderId?: string,
): CatalogModelEntry[] {
  if (!configuredModelId || !configuredModelId.trim() || limit <= 0) return [];
  const id = configuredModelId.trim();
  const selected = catalog.find(
    (entry) =>
      (entry.modelId === id || entry.providerModelId === id) &&
      (!configuredProviderId || entry.providerId === configuredProviderId) &&
      entry.enabled !== false &&
      // NewMax only runs a fallback against a positively verified visual
      // model. A user selection that is merely unknown is shown in settings,
      // but it is not allowed to receive images automatically.
      catalogEntryVisionVerified(entry),
  );
  if (!selected) return [];

  const result: CatalogModelEntry[] = [selected];
  const seen = new Set<string>([
    `${selected.providerId ?? ''}\u0000${selected.modelId}\u0000${selected.providerModelId}`,
  ]);
  const appendVerified = (entry: CatalogModelEntry) => {
    if (
      result.length >= limit ||
      entry.enabled === false ||
      entry.providerId === 'default' ||
      !catalogEntryVisionVerified(entry)
    ) {
      return;
    }
    const key = `${entry.providerId ?? ''}\u0000${entry.modelId}\u0000${entry.providerModelId}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  };
  // NewMax tries additional models from the selected provider first, then the
  // first verified model from each other non-default provider.
  for (const entry of catalog) {
    if (entry.providerId === selected.providerId) appendVerified(entry);
  }
  const seenProviders = new Set<string>();
  for (const entry of catalog) {
    if (entry.providerId === selected.providerId || seenProviders.has(entry.providerId ?? '')) continue;
    seenProviders.add(entry.providerId ?? '');
    appendVerified(entry);
  }
  return result;
}

/**
 * Resolve exactly the vision model the user configured in Settings
 * (`vision-fallback` → providerId + modelId). The configured model is the first candidate;
 * NewMax retries at most two other verified candidates if it fails.
 * Matching accepts the catalog model id or the provider-facing id. Returns
 * undefined when the configured id is missing or unknown.
 */
export function resolveVisionDescribeModel(
  catalog: readonly CatalogModelEntry[],
  configuredModelId?: string,
  configuredProviderId?: string,
): CatalogModelEntry | undefined {
  return resolveVisionDescribeModels(catalog, configuredModelId, 1, configuredProviderId)[0];
}

/* -------------------------------------------------------------------------- *
 * NewMax `IMAGE_DESCRIBE_TEXT` — the description-request and failure wording.
 * Migrated verbatim from NewMax's main bundle: the table is keyed by locale
 * (`zh-CN` / `en`) and every entry carries five fields. Nothing here is
 * configurable at runtime; it is a fixed product text.
 * -------------------------------------------------------------------------- */

/** NewMax switches the request text on the purpose. */
export type ImageDescribePurpose = 'describe' | 'document';
export type ImageDescribeLocale = 'zh-CN' | 'en';

export interface ImageDescribeText {
  prompt: string;
  documentPrompt: string;
  refusal: (text: string) => string;
  fallbackNotConfigured: string;
  fallbackProviderNotFound: (providerId: string) => string;
}

/** NewMax `truncateForError`: 200 chars then an ellipsis; `(empty body)` when blank. */
export function truncateForError(text: string): string {
  if (!text) return '(empty body)';
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export const IMAGE_DESCRIBE_TEXT: Record<ImageDescribeLocale, ImageDescribeText> = {
  'zh-CN': {
    prompt:
      '请用中文详细描述这张图,覆盖:\n' +
      '1) 整体内容/主题;\n' +
      '2) 画面中所有可读文字(按位置/层级如实转写,不要省略);\n' +
      '3) 重要视觉元素(人物/物体/图表/UI 元素 等)的位置关系与外观;\n' +
      '4) 风格/氛围/配色等可观察特征。\n' +
      '尽量穷尽细节,后续的对话只能基于你这次的描述来理解这张图。直接输出描述,不要任何客套话或开头/结尾说明。',
    documentPrompt:
      '这是从扫描 PDF 安全渲染出的单页图片。请仅做文档转写：\n' +
      '1) 按阅读顺序逐字转写所有可见文字，保留标题、列表、表格字段和换行层级；\n' +
      '2) 手写或模糊内容无法确认时标记「[无法辨认]」，不要根据上下文补全、猜测或改写；\n' +
      '3) 只输出转写结果，不要客套话、摘要、解释或额外描述。',
    refusal: (text) => `副模型实际看不见图,返回了道歉文本:${truncateForError(text.trim())}`,
    fallbackNotConfigured: '未配置图片识别备用模型',
    fallbackProviderNotFound: (providerId) => `备用模型所属 provider "${providerId}" 未找到`,
  },
  en: {
    prompt:
      'Describe this image in English with as much useful detail as possible. Cover:\n' +
      '1) the overall subject and context;\n' +
      '2) every readable text element, transcribed faithfully with position or hierarchy when relevant;\n' +
      '3) important visual elements, including people, objects, charts, UI elements, layout, and relationships;\n' +
      '4) observable style, mood, colors, and composition.\n' +
      'Be exhaustive enough that the following conversation can rely on this description alone. Output only the description, with no greeting, apology, preface, or closing note.',
    documentPrompt:
      'This is one page safely rendered from a scanned PDF. Perform document transcription only:\n' +
      '1) Transcribe every visible text element verbatim in reading order, preserving headings, lists, table fields, and line hierarchy.\n' +
      '2) Mark uncertain handwriting or blurred content as [illegible]. Do not infer, complete, guess, summarize, or rewrite it from context.\n' +
      '3) Output only the transcription, without greetings, explanations, summaries, or additional visual description.',
    refusal: (text) =>
      `The vision fallback model could not view the image and returned an apology/refusal: ${truncateForError(text.trim())}`,
    fallbackNotConfigured: 'No image understanding fallback model is configured.',
    fallbackProviderNotFound: (providerId) =>
      `The provider for the image fallback model was not found: "${providerId}".`,
  },
};

/** NewMax `getImageDescribeText`: pick the table by locale, defaulting to zh-CN. */
export function getImageDescribeText(locale?: string): ImageDescribeText {
  return locale?.toLowerCase().startsWith('en')
    ? IMAGE_DESCRIBE_TEXT.en
    : IMAGE_DESCRIBE_TEXT['zh-CN'];
}

/**
 * NewMax builds the description request from the purpose — `describe` for an
 * ordinary attachment, `document` for a page rendered from a scanned PDF. The
 * prompt carries no filename and no index: NewMax issues one request per image.
 */
export function buildImageDescriptionPrompt(
  purpose: ImageDescribePurpose = 'describe',
  locale?: string,
): string {
  const text = getImageDescribeText(locale);
  return purpose === 'document' ? text.documentPrompt : text.prompt;
}

/** NewMax `REFUSAL_PATTERNS`: the fallback model admitting it cannot see the image. */
const REFUSAL_PATTERNS: RegExp[] = [
  /(看不到|看不见|未能看到|没看到|无法看到|无法查看|不能查看)[^。.\n]{0,12}图/,
  /(不支持|无法).{0,8}(查看|读取|访问|识别|查看|看)[^。.\n]{0,10}图/,
  /(cannot|can'?t|unable to|not able to)[^.\n]{0,20}(see|view|access|read|process)[^.\n]{0,20}image/i,
  /don'?t have access to[^.\n]{0,30}image/i,
  /(sorry|apologi|抱歉|对不起)[^.\n]{0,30}(image|图片|图像)/i,
];

export function isLikelyRefusalText(text: string): boolean {
  const trimmed = text.trim();
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * NewMax `assertNotRefusal`: a refusal is an error, never a usable description —
 * otherwise the primary model would be handed "抱歉，我看不到图片" as if it
 * were the image content.
 */
export function assertNotRefusal(text: string, locale?: string): string {
  if (isLikelyRefusalText(text)) throw new Error(getImageDescribeText(locale).refusal(text));
  return text;
}

/** NewMax `stripImagePathSection`: drop the "附件图片路径：" block before injecting. */
const IMAGE_PATH_SECTION_PREFIX = '附件图片路径：';
const IMAGE_PATH_SECTION_PREFIX_EN = 'Attached image paths:';

export function stripImagePathSection(content: string): string {
  const pattern = new RegExp(
    `(?:\\n\\n|^)(?:${IMAGE_PATH_SECTION_PREFIX}|${IMAGE_PATH_SECTION_PREFIX_EN})(?:\\n[^\\n]+)+(?=\\n\\n|$)`,
    'g',
  );
  return content.replace(pattern, '');
}

/**
 * NewMax `injectDescriptionsIntoContent`: replace the image-path block with the
 * descriptions the fallback model produced, framed so the primary model knows
 * these are the *only* image information it gets and that reading the original
 * files is futile.
 */
export function injectDescriptionsIntoContent(
  content: string,
  descriptions: ReadonlyArray<{ name: string; text: string }>,
  label: string,
  locale?: string,
): string {
  if (descriptions.length === 0) return content;
  const stripped = stripImagePathSection(content);
  const isEn = Boolean(locale?.toLowerCase().startsWith('en'));
  const header = isEn
    ? `⚠️ The user attached images. A secondary model (${label}) converted them into the text descriptions below.\n` +
      'These descriptions are the **only** image information available. Answer directly from them.\n' +
      '**Do not try to locate or read the original image files with Read, Bash, Glob, Grep, or Find** — the current primary model cannot understand images, and reading PNG/JPG files only returns base64/binary data.'
    : `⚠️ 用户附了图片，已由副模型「${label}」转写成下面的文字描述。\n` +
      '这是这些图的**唯一**信息源，请直接基于描述作答。\n' +
      '**不要尝试用 Read、Bash、Glob、Grep 或 Find 等工具去查找/读取原图文件**——当前主模型不识图，硬读 PNG/JPG 文件只会拿到 base64 二进制，是无效操作还浪费 turn。';
  const body = descriptions
    .map((entry, index) =>
      isEn
        ? `📷 Image ${index + 1} description:\n${entry.text}`
        : `📷 图 ${index + 1} 描述：\n${entry.text}`,
    )
    .join('\n\n');
  const block = `${header}\n\n${body}`;
  return stripped.trim() ? `${stripped}\n\n---\n${block}` : block;
}

/** NewMax `getFallbackLabel`: the name shown in the injected header. */
export function getFallbackLabel(
  settings: { visionFallback?: { providerId?: string | null }; providers?: ReadonlyArray<{ id: string; name?: string }> },
  locale?: string,
): string {
  const providerId = settings.visionFallback?.providerId;
  if (!providerId) {
    return locale?.toLowerCase().startsWith('en') ? 'fallback model' : '备用模型';
  }
  const provider = settings.providers?.find((entry) => entry.id === providerId);
  return provider?.name || (locale?.toLowerCase().startsWith('en') ? 'fallback model' : '备用模型');
}

export type VisionFallbackDecision = {
  state: VisionState;
  unsupported: boolean;
  hasFallback: boolean;
  selfReferencing: boolean;
  fallbackUsable: boolean;
  fallbackState: VisionState;
  fallbackIncompatible: boolean;
  shouldRun: boolean;
};

export interface VisionFallbackDecisionOptions {
  enabled?: boolean;
  setting?: { providerId?: string | null; modelId?: string | null } | null;
  providers?: ReadonlyArray<{ id: string } & CapabilityProviderLike>;
}

/**
 * NewMax `decideVisionFallback`: the single gate that decides whether an image
 * is described by a fallback model before the primary model sees it.
 *
 * `shouldRun` is deliberately strict — the primary model must be *definitely*
 * text-only, a fallback must be configured, and that fallback must not be the
 * primary model describing to itself and must be positively verified.
 */
export function decideVisionFallback(
  provider: CapabilityProviderLike | undefined,
  providerId: string,
  modelId: string,
  options: VisionFallbackDecisionOptions = {},
): VisionFallbackDecision {
  const state = resolveVisionState(provider, providerId, modelId);
  const fallback = options.setting;
  const enabled = options.enabled !== false;
  const hasFallback = enabled && Boolean(fallback?.providerId) && Boolean(fallback?.modelId);
  const selfReferencing = Boolean(
    fallback && fallback.providerId === providerId && fallback.modelId === modelId,
  );
  let fallbackState: VisionState = 'unknown';
  if (fallback && !selfReferencing) {
    if (fallback.providerId === 'default') {
      fallbackState = 'supported';
    } else {
      const fallbackProviderId = fallback.providerId;
      const fallbackModelId = fallback.modelId;
      if (fallbackProviderId && fallbackModelId) {
        const fallbackProvider = options.providers?.find(
          (entry) => entry.id === fallbackProviderId,
        );
        if (fallbackProvider) {
          fallbackState = resolveVerifiedFallbackVisionState(
            fallbackProvider,
            fallbackProviderId,
            fallbackModelId,
          );
        }
      }
    }
  }
  const fallbackUsable = hasFallback && !selfReferencing && fallbackState === 'supported';
  const fallbackIncompatible = hasFallback && !selfReferencing && fallbackState !== 'supported';
  const shouldRun = state === 'unsupported' && hasFallback && !selfReferencing && fallbackUsable;
  return {
    state,
    unsupported: state === 'unsupported',
    hasFallback,
    selfReferencing,
    fallbackUsable,
    fallbackState,
    fallbackIncompatible,
    shouldRun,
  };
}

/**
 * NewMax `decideVisionFallback`, resolved from this app's model catalog.
 *
 * NewMax hands the gate a provider plus a provider-facing model id; here the
 * primary and the fallback are both catalog entries whose host id differs from
 * the provider-facing id. Both sides are therefore projected onto their own
 * per-model capability face before the gate runs, so each answers from its own
 * probe result instead of a provider default, and the known-support table still
 * sees the provider-facing id it is keyed by.
 */
export function decideCatalogVisionFallback(
  primary: CatalogModelEntry | undefined,
  setting: VisionFallbackSetting,
  catalog: readonly CatalogModelEntry[],
): VisionFallbackDecision {
  const fallbackEntry =
    setting.providerId && setting.modelId
      ? catalog.find(
          (entry) =>
            entry.modelId === setting.modelId &&
            (!setting.providerId || entry.providerId === setting.providerId),
        )
      : undefined;
  return decideVisionFallback(
    primary ? entryCapabilityProvider(primary) : undefined,
    primary?.providerId ?? '',
    primary?.providerModelId ?? '',
    {
      enabled: setting.enabled,
      setting: {
        providerId: fallbackEntry?.providerId ?? setting.providerId,
        modelId: fallbackEntry?.providerModelId ?? setting.modelId,
      },
      providers: fallbackEntry ? [entryCapabilityProvider(fallbackEntry)] : [],
    },
  );
}

/**
 * Assemble the text injected into the user message when images are replaced
 * by descriptions. The model reads this prose in place of the actual image.
 */
export function buildDescriptionSuffix(
  descriptions: ReadonlyArray<{ name: string; text: string }>,
  degraded: boolean,
): string {
  const lines = descriptions.map(
    (entry, index) => `【图片 ${index + 1} · ${entry.name}】${entry.text.trim()}`,
  );
  const preamble = degraded
    ? '（当前模型不含图像输入能力，以下为视觉模型对附件的文字描述：）'
    : '（附件的文字描述：）';
  return `\n\n${preamble}\n${lines.join('\n\n')}`;
}

export interface WindowsOcrDescription {
  name: string;
  text: string;
  language: string;
}

/** Text injected when a non-vision model receives host-side Windows OCR. */
export function buildWindowsOcrSuffix(descriptions: ReadonlyArray<WindowsOcrDescription>): string {
  const lines = descriptions.map(
    (entry, index) =>
      `【图片 ${index + 1} · ${entry.name} · OCR ${entry.language}】${entry.text.trim()}`,
  );
  return `\n\n（当前模型不含图像输入能力，以下为 Windows OCR 从附件中自动提取的文字。OCR 只包含可识别文字，不代表完整画面内容：）\n${lines.join('\n\n')}`;
}

/** Keep a failed text-only turn explicit without forwarding unreadable raw images. */
export function buildImageHandlingFailureSuffix(): string {
  return '\n\n（图片转写失败：已配置的视觉模型未返回可用描述，原图未发送给当前文本模型。请检查图片识别 Fallback 的模型配置后重试。）';
}

/**
 * NewMax-style guidance injected into the user message when the attachments
 * were materialized into the workspace: the (non-vision) model reads the
 * paths and calls `describe_image` itself instead of guessing from binaries.
 */
export function buildAttachmentGuidance(
  written: ReadonlyArray<{ name: string; relativePath: string }>,
  options: { visionFallbackEnabled?: boolean } = {},
): string {
  const lines = written.map(
    (entry, index) => `${index + 1}. ${entry.relativePath}（${entry.name}）`,
  );
  const visualFallback = options.visionFallbackEnabled
    ? '\n需要理解画面、物体或布局时，可调用 `describe_image`（ClaudeCode：`mcp__vision-fallback__describe_image`；GPT / Pi：`mcp__sync-think-platform__describe_image`）。'
    : '';
  return `\n\n（当前模型不支持图片输入。你本次消息附带的图片已保存到工作区：\n${lines.join('\n')}\n需要提取图片文字时，调用 \`ocr_image\`（ClaudeCode：\`mcp__windows-ocr__ocr_image\`；GPT / Pi：\`mcp__sync-think-platform__ocr_image\`）并传入对应路径作为 \`path\` 参数。${visualFallback}\n不要读取图片二进制后猜测内容。）`;
}
