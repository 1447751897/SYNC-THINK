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
  getReliableImageCapability,
  resolveVisionState,
  type ModelVisionFacts,
  type VisionState,
} from '@sync-think/core';

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
  /** Provider entry enabled (false = hidden from pickers/execution). */
  enabled?: boolean;
}

/**
 * Three-state vision answer for a catalog entry.
 *
 * A confirmed tag list that merely lacks `vision` is NOT the same as "the model
 * refuses images": when the probe never reached the provider, NewMax keeps the
 * answer `unknown` and lets the known-support table decide. Collapsing that to
 * `unsupported` is what sent multimodal models to Windows OCR.
 */
export function catalogEntryVisionState(entry: CatalogModelEntry): VisionState {
  const facts: ModelVisionFacts = {
    providerId: entry.providerId,
    providerModelId: entry.providerModelId,
    capabilities: entry.capabilities,
    capabilitiesConfirmed: entry.capabilitiesConfirmed,
    probeReason: entry.probeReason,
    visionCapability: entry.visionCapability,
  };
  return resolveVisionState(facts);
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
    getReliableImageCapability({
      providerId: entry.providerId,
      providerModelId: entry.providerModelId,
      capabilities: entry.capabilities,
      capabilitiesConfirmed: entry.capabilitiesConfirmed,
      probeReason: entry.probeReason,
      visionCapability: entry.visionCapability,
    }) === true
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

export function buildImageDescriptionPrompt(
  image: DescribeImageInput,
  index: number,
  total: number,
): string {
  return `请用中文详细描述这张图片（第 ${index}/${total} 张，文件名：${image.name}）。描述时请按顺序说明：内容主体、场景/背景、可辨认的文字、颜色与风格。如果图片无法识别，请明确说明无法识别。`;
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
