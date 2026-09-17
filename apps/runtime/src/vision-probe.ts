/**
 * 视觉能力探针 —— 逐字对齐 NewMax `probeCapabilities` / `interpretImageProbeResponse`。
 *
 * NewMax 的判定链（从发行版 asar 主包取到的权威实现）：
 *   1. 用一张固定探针图（160×96 单色 PNG，画面是四位校验码）发一次真实图片请求；
 *   2. prompt 要求模型只回那四位数字，看不见就回 `none`；
 *   3. 回复里出现校验码（`hasVisionProbeMarker`）→ `supported: true`；
 *   4. 命中 12 条拒答正则，或裸 `none` / `无` / `没有` → `supported: false`；
 *   5. 其它任何回复 → **只有 reason，没有 supported 字段**，即 `unknown`。
 *
 * 第 5 步是与「有非空文本就判负」的关键差别：中转站对图片支持不完整时，模型
 * 常常会对着无法解析的图**编一句**（"an image"/"white"）。NewMax 把这种回复
 * 当作 `unknown`（原图照发），只有明确拒答才降级。
 */

/** NewMax probe marker：探针图里的四位校验码。 */
export const VISION_PROBE_MARKER = '7319';

/**
 * NewMax 固定的 160×96 单色 PNG 探针图。
 * 逐字节照搬，保证两侧探针结果可比。
 */
export const VISION_PROBE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAABgAQAAAACyXEQ0AAAAAnRSTlMAAHaTzTgAAAEGSURBVDjL7dOxcQMhEIXhn9lgw+1A14jH15YDjW/VGaVQAs4IZK2DswBLDhx77oXfwAAPgCNH/hJpII6WO1hEsQB11jbjGo46223GLTLqRMz4rgXz1FYfy+QmlcWl2kD1mmoKl6K5o10qVcM1y4TpFzylsqNL3z0vqVCxB4RnfIP0hA2kPGIFe8RUSeGYa56wfKPkUagUUmTMpdjADFH3ljpqBqmYp4iBDjTMic9xSR3Xj4H7qczRS8cF4Iw5yIRS7tj7PCFlnz7h6x3VdcJUaJhrVh8dp/qNNmNLdT97r/MMV62YS11n3KJgnuI24xoZc+I639sSYM7WfrzkfciSj0995J/nC1iWmD956+TjAAAAAElFTkSuQmCC';

/** 探针图对应的 data URL，直接喂给适配层的图片输入。 */
export const VISION_PROBE_IMAGE_URL = `data:image/png;base64,${VISION_PROBE_PNG_BASE64}`;

/**
 * 文档探针资产（最小合法 PDF，329 字节）。
 *
 * NewMax 的 `PROBE_PDF_BASE64` 在发行版里是字符串表查表调用（`_0x5bda6e(0x36d2)`），
 * 无法静态提取，故按同等规格自造：一份结构完整、xref 偏移正确的单页 PDF。
 * 探测只关心「上游是否接受文档输入」，不关心内容，因此最小合法即可。
 */
export const VISION_PROBE_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSA+PgplbmRvYmoKeHJlZgowIDQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDQgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjE4NgolJUVPRgo=';

/** 文档探针的 data URL。 */
export const VISION_PROBE_PDF_URL = `data:application/pdf;base64,${VISION_PROBE_PDF_BASE64}`;

/**
 * 视频探针资产（最小合法 MP4，140 字节：`ftyp` + `moov/mvhd`）。
 *
 * 同 PDF：NewMax 的 `PROBE_MP4_BASE64` 是查表调用，无法静态提取，按同等规格自造。
 * 即使上游因内容过简而拒绝，判定也只会落到「未定」——`isExplicitMediaUnsupported`
 * 要求响应正文里**同时**出现视频关键词与"不支持"语义才判负，内容过简不会误判。
 */
export const VISION_PROBE_MP4_BASE64 =
  'AAAAGGZ0eXBpc29tAAACAGlzb21tcDQyAAAAdG1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=';

/** 视频探针的 data URL。 */
export const VISION_PROBE_MP4_URL = `data:video/mp4;base64,${VISION_PROBE_MP4_BASE64}`;

/**
 * NewMax 的探针提示词原样（英文）。
 * 要求模型**只回四位校验码**，看不见就回 `none`，好让判定退化成纯字符串比较。
 */
export const VISION_PROBE_PROMPT =
  'What exact four-digit code do you see in this image? Reply with just the code, or "none" if you cannot see one.';

/**
 * 文档 / 视频探针的提示词 —— NewMax `buildDocumentContent` / `buildVideoContent`
 * 里的字面量。这两维没有校验码可对，判定退化成「上游是否接受了该媒体的请求」。
 */
export const VISION_PROBE_DOCUMENT_PROMPT = 'summarize';
export const VISION_PROBE_VIDEO_PROMPT = 'describe';

/**
 * 思考维探针的正文。NewMax 用同一句连接自检文本（`providerTestText('probeText')`）
 * 发一条纯文本请求，只额外带 `thinking` 字段——探的是「网关收不收思考参数」，
 * 而不是「模型答得好不好」。
 */
export const CAPABILITY_PROBE_TEXT_PROMPT = 'connection check';

/**
 * 模型是否真的读出了探针图里的校验码。
 *
 * NewMax 原文只认这一条：校验码两侧必须是非数字字符或串边界。
 * 不再接受 `forty two` / `4 and 2` / `四十二` 之类的同义写法 —— 那些是
 * 移植时的加宽，与 NewMax 不一致，会让判定结果不可比。
 */
export function hasVisionProbeMarker(text: string): boolean {
  return new RegExp(`(?:^|\\D)${VISION_PROBE_MARKER}(?:\\D|$)`).test(text.trim());
}

/** 探针/描述文案的语言档，对齐 NewMax 的 `getProviderConnectionLocale()`。 */
export type ProbeLocale = 'zh-CN' | 'en';

/**
 * 能力探测的用户可见文案。对齐 NewMax `PROVIDER_TEST_TEXT` 的 `capability*` 子集
 * （主包是混淆字符串表，这里取的是其渲染层等价文案）。
 */
const PROBE_TEXT: Record<ProbeLocale, Record<string, string>> = {
  'zh-CN': {
    capabilityNoImage: '模型回复未识别图片',
    capabilityEmpty: '模型未返回任何内容',
    capabilityInvalidResponse: '响应无效',
    capabilityRateLimited: '限流，请稍后重试',
    capabilityTimeout: '请求超时',
    capabilityAuthFailed: '鉴权失败',
    capabilityNetwork: '网络异常',
  },
  en: {
    capabilityNoImage: 'The model did not identify the image.',
    capabilityEmpty: 'The model returned an empty response.',
    capabilityInvalidResponse: 'The response was not valid.',
    capabilityRateLimited: 'Rate limited. Try again later.',
    capabilityTimeout: 'The request timed out.',
    capabilityAuthFailed: 'Authentication failed.',
    capabilityNetwork: 'Network error.',
  },
};

export function probeText(key: string, locale: ProbeLocale = 'zh-CN'): string {
  return PROBE_TEXT[locale]?.[key] ?? PROBE_TEXT['zh-CN'][key] ?? key;
}

/** 与 NewMax `formatCapabilityRejected` 一致。 */
export function formatCapabilityRejected(status: number, locale: ProbeLocale = 'zh-CN'): string {
  return locale === 'en'
    ? `Probe request was rejected (HTTP ${status})`
    : `探测请求被拒绝 (HTTP ${status})`;
}

/** 与 NewMax `formatCapabilityServer` 一致。 */
export function formatCapabilityServer(status: number, locale: ProbeLocale = 'zh-CN'): string {
  return locale === 'en' ? `Server error (HTTP ${status})` : `服务异常 (HTTP ${status})`;
}

/** 与 NewMax `formatCapabilityUnknownStatus` 一致。 */
export function formatCapabilityUnknownStatus(status: number, locale: ProbeLocale = 'zh-CN'): string {
  return locale === 'en' ? `Unexpected response (HTTP ${status})` : `未知响应 (HTTP ${status})`;
}

/**
 * 与 NewMax `formatCapabilityUnknownReply` 一致：模型回了话但没读出校验码。
 * 有内容就带预览，空内容退回 `capabilityEmpty`。
 */
export function formatCapabilityUnknownReply(preview: string, locale: ProbeLocale = 'zh-CN'): string {
  if (preview) {
    return locale === 'en'
      ? `The channel returned content but did not identify the four-digit code in the probe image (response: ${preview})`
      : `通道已返回内容，但未识别测试图中的四位校验码（回复：${preview}）`;
  }
  return probeText('capabilityEmpty', locale);
}

/**
 * NewMax `interpretImageProbeResponse` 里的 12 条拒答正则，逐条照搬。
 * 命中即「模型确实看不见图」——这是唯一可以判负的**内容级**信号。
 */
export const VISION_REFUSAL_PATTERNS: readonly RegExp[] = [
  /看不到/,
  /看不见/,
  /无法.{0,4}(看到|识别|查看|处理|解析).{0,4}图/,
  /没有.{0,4}(视觉|图像|图片).{0,4}(能力|功能)/,
  /(纯|仅).{0,2}文本.{0,2}模型/,
  /视觉.{0,4}(模型|能力).{0,4}(无法|暂时|不支持)/,
  /不支持.{0,4}(视觉|图像|图片|多模态)/,
  /\bi (can'?t|cannot|am unable to) (see|view|process|read|analyze|interpret)\b/,
  /\b(no|without|lack|don'?t have) vision\b/,
  /\btext[- ]only\b/,
  /\bi'?m (just |only )?a (text |language )?model\b/,
  /\bcannot (see|view|process|analyze) (the |this )?image/,
];

/** 裸 `none` / `无` / `没有`：模型按 prompt 明确回答了"看不见"。 */
const BARE_NONE = /^\s*("|')?none("|')?[\s.!]*$/;
const BARE_NONE_CN = /^\s*(无|没有)[\s.!]*$/;

/** 探针判定结果。`supported` 缺失 = `unknown`（不是 false）。 */
export interface ImageProbeVerdict {
  supported?: boolean;
  reason?: string;
}

/**
 * 把探针回复解读成三态判定 —— NewMax `interpretImageProbeResponse` 的逐字移植。
 *
 *   `{ supported: true }`                 模型读出了校验码
 *   `{ supported: false, reason }`        模型明确拒答 / 回了 none
 *   `{ reason }`（无 supported）          答非所问 → unknown，**不可判负**
 */
export function interpretImageProbeResponse(
  text: string,
  locale: ProbeLocale = 'zh-CN',
): ImageProbeVerdict {
  const trimmed = text.trim();
  if (hasVisionProbeMarker(trimmed)) return { supported: true };

  if (
    VISION_REFUSAL_PATTERNS.some((pattern) => pattern.test(trimmed)) ||
    BARE_NONE.test(trimmed) ||
    BARE_NONE_CN.test(trimmed)
  ) {
    return { supported: false, reason: probeText('capabilityNoImage', locale) };
  }

  return { reason: formatCapabilityUnknownReply(trimmed.slice(0, 60), locale) };
}

/**
 * 失败原因分类 —— NewMax `classifyVisionProbeFailure` 的逐字移植（7 类）。
 *
 * 分类的价值在于区分「模型真的不支持图片」与「这次只是限流/网络/密钥问题」：
 * 后者不该被判成模型能力缺失。
 */
export type VisionProbeFailureClass =
  | 'unsupported'
  | 'authentication'
  | 'rateLimit'
  | 'timeout'
  | 'network'
  | 'responseMismatch'
  | 'unknown';

export function classifyVisionProbeFailure(reason: string): VisionProbeFailureClass {
  const normalized = reason?.trim() ?? '';
  if (
    /only supports? text|text[- ]only|image(?: input)? (?:is )?(?:unsupported|not supported)|does not support (?:image|vision)|unknown variant [`'"]?image_url|不支持.{0,8}(?:图片|图像|视觉)|仅支持.{0,6}文本|只支持.{0,6}文本/i.test(
      normalized,
    )
  ) {
    return 'unsupported';
  }
  if (
    /\b(?:401|403)\b|invalid api[- ]?key|api[- ]?key.{0,30}invalid|authentication|unauthori[sz]ed|forbidden|api 密钥无效|密钥无效|未授权|鉴权失败/i.test(
      normalized,
    )
  ) {
    return 'authentication';
  }
  if (/\b429\b|rate.?limit|too many requests|限流|请求过多/i.test(normalized)) return 'rateLimit';
  if (/timeout|timed out|请求超时|连接超时|验证超时/i.test(normalized)) return 'timeout';
  if (/network|econn|enotfound|socket|fetch failed|连接失败|连接中断|网络(?:异常|错误|不可用)/i.test(normalized)) {
    return 'network';
  }
  if (
    /未识别测试图中的(?:数字|四位校验码)|did not identify (?:the )?(?:four-digit code in the )?probe image|probe image response mismatch/i.test(
      normalized,
    )
  ) {
    return 'responseMismatch';
  }
  return 'unknown';
}

/** 各能力维度在错误正文里的媒体关键词。对齐 NewMax `MEDIA_WORDS`。 */
const MEDIA_WORDS: Record<string, RegExp> = {
  image: /\b(image|image_url|vision|visual|multimodal)\b|图像|图片|视觉|多模态/i,
  document: /\b(document|file|pdf)\b|文档|文件/i,
  video: /\b(video|video_url)\b|视频/i,
};

/**
 * 上游是否**明确**说了"不接受这个媒体类型" —— NewMax `isExplicitMediaUnsupported`。
 *
 * 这是 4xx 判负的唯一依据：中转站返回模糊 400（参数名不对、余额不足、路由错误…）
 * 时不能当成模型不支持图片，否则一次协议抖动就把多模态模型永久降级。
 */
export function isExplicitMediaUnsupported(body: string, capability: string): boolean {
  const lower = (body ?? '').toLowerCase();
  const media = MEDIA_WORDS[capability];
  if (!media || !media.test(lower)) return false;
  return /\b(not supported|unsupported|does not support|only supports? text|text[- ]only|invalid (?:value|type)|expected one of)\b|不支持|仅支持文本|只支持文本|无此能力/i.test(
    lower,
  );
}

/** 七类原因的展示文案（设置面板用）。 */
export const VISION_PROBE_FAILURE_LABELS: Record<VisionProbeFailureClass, string> = {
  unsupported: '该模型不支持图片输入',
  authentication: '鉴权失败（API 密钥无效或未授权）',
  rateLimit: '被限流（429 / 请求过多）',
  timeout: '请求超时',
  network: '网络异常或连接中断',
  responseMismatch: `未识别测试图中的四位校验码 ${VISION_PROBE_MARKER}（可能未真正读取图片）`,
  unknown: '未通过（原因未识别）',
};

/**
 * 把失败原因压成一行**原因描述**（不含「图片输入未通过」这类前缀，前缀由调用方加）：
 * 能归类就给归类文案，归不了类就原样保留上游消息，至少让人看到真实报错。
 */
export function describeVisionProbeFailure(reason: string): string {
  const kind = classifyVisionProbeFailure(reason);
  if (kind === 'unknown') {
    return reason?.trim() || VISION_PROBE_FAILURE_LABELS.unknown;
  }
  return VISION_PROBE_FAILURE_LABELS[kind];
}
