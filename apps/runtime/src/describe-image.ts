/**
 * Vision fallback for kernels / models without image input support.
 *
 * Strategy (NewMax-style "vision fallback"):
 *   - If the running model is vision-capable, images are forwarded as-is.
 *   - If the model is likely text-only (e.g. deepseek), the host calls a
 *     vision-capable model ONCE to describe each image and injects the
 *     description as text — the kernel/model then reads "the image" from prose.
 *   - Capability tags are authoritative when confirmed; model-name heuristics
 *     cover catalog entries that have not been confirmed yet.
 *
 * Everything here is pure and unit-testable; the runtime supplies the actual
 * provider call (`describeImages` deps) and the model catalog.
 */

export interface DescribeImageInput {
  name: string;
  mimeType: string;
  dataUrl: string;
}

/**
 * App-level KV key for the Settings > Models > 图片识别 Fallback option.
 * Value shape: `{ enabled: boolean; modelId: string | null }` — the model id
 * is the user's explicit choice and the only model used to read images.
 */
export const VISION_FALLBACK_SETTING_KEY = 'vision-fallback';

/** Runtime-side parsed shape of the vision-fallback setting. */
export interface VisionFallbackSetting {
  enabled: boolean;
  modelId: string | null;
}

export function parseVisionFallbackSetting(raw: unknown): VisionFallbackSetting {
  if (!raw || typeof raw !== 'object') return { enabled: false, modelId: null };
  const record = raw as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
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
  /gpt-5/i,
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
 * vision-capable. Unknown ids default to `false`; users can make vision support
 * authoritative by confirming the catalog `vision` capability.
 */
export function isModelVisionCapable(providerModelId: string): boolean {
  const id = providerModelId.trim();
  if (!id) return false;
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
  /** Confirmed capability tags when the host probed/catalogued them. */
  capabilities?: string[];
  /** Whether `capabilities` is authoritative (probed) rather than best-effort. */
  capabilitiesConfirmed?: boolean;
  /** Provider entry enabled (false = hidden from pickers/execution). */
  enabled?: boolean;
}

/**
 * Vision capability of a catalog entry: the confirmed `vision` tag wins, a
 * confirmed text-only tag vetoes, unknown ids fall back to the name heuristic.
 */
export function catalogEntryVisionCapable(entry: CatalogModelEntry): boolean {
  const capabilities = entry.capabilities ?? [];
  if (entry.capabilitiesConfirmed) return capabilities.includes('vision');
  if (capabilities.includes('vision')) return true;
  return isModelVisionCapable(entry.providerModelId);
}

/**
 * Resolve exactly the vision model the user configured in Settings
 * (`vision-fallback` → modelId). The call is authoritative: no automatic
 * candidate fallback — if the configured model fails, the description fails.
 * Matching accepts the catalog model id or the provider-facing id. Returns
 * undefined when the configured id is missing or unknown.
 */
export function resolveVisionDescribeModel(
  catalog: readonly CatalogModelEntry[],
  configuredModelId?: string,
): CatalogModelEntry | undefined {
  if (!configuredModelId || !configuredModelId.trim()) return undefined;
  const id = configuredModelId.trim();
  return catalog.find(
    (entry) =>
      (entry.modelId === id || entry.providerModelId === id) &&
      entry.enabled !== false &&
      catalogEntryVisionCapable(entry),
  );
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
  return '\n\n（图片预处理失败：视觉模型 Fallback 与 Windows OCR 均未返回可用结果。当前文本模型未接收原始图片，请根据这一限制回答。）';
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
