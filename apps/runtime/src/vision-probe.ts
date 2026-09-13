/**
 * 视觉能力探针 —— 按 NewMax 的 `VisionFallbackPanel.runVisionScan` 一比一复刻。
 *
 * NewMax 的判定链（从 asar 的 main-bundle 取到的权威实现）：
 *   1. 用一张固定探针图（160×96 单色 PNG，画面是一个四位数字）发一次真实图片请求；
 *   2. 要求模型把图里的数字读出来；
 *   3. **只有回复里出现该数字**（`hasVisionProbeMarker`）才判定为具备视觉能力；
 *   4. 失败时用 `classifyVisionProbeFailure` 归入六类原因之一。
 *
 * 第 3 步是与「有非空文本就算通过」的关键差别：中转站对图片支持不完整时，
 * 模型常常会对着无法解析的图**编一句**（"an image"/"white"）——那种回复会被
 * 这一层挡掉，不会被误判成支持视觉。
 */

/** 探针图里画着的四位校验码。判定时要能在模型回复里原样找到它。 */
export const VISION_PROBE_MARKER = '7319';

/**
 * 探针图：160×96、1-bit 灰度 PNG，白底黑字写着 `7319`。
 * 与 NewMax 的 `VISION_PROBE_PNG_BASE64` 逐字节相同（333 字节）。
 */
export const VISION_PROBE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAABgAQAAAACyXEQ0AAAAAnRSTlMAAHaTzTgAAAEGSURBVDjL7dOxcQMhEIXhn9lgw+1A14jH15YDjW/VGaVQAs4IZK2DswBLDhx77oXfwAAPgCNH/hJpII6WO1hEsQB11jbjGo46223GLTLqRMz4rgXz1FYfy+QmlcWl2kD1mmoKl6K5o10qVcM1y4TpFzylsqNL3z0vqVCxB4RnfIP0hA2kPGIFe8RUSeGYa56wfKPkUagUUmTMpdjADFH3ljpqBqmYp4iBDjTMic9xSR3Xj4H7qczRS8cF4Iw5yIRS7tj7PCFlnz7h6x3VdcJUaJhrVh8dp/qNNmNLdT97r/MMV62YS11n3KJgnuI24xoZc+I639sSYM7WfrzkfciSj0995J/nC1iWmD956+TjAAAAAElFTkSuQmCC';

/** 探针图对应的 data URL，直接喂给适配层的图片输入。 */
export const VISION_PROBE_IMAGE_URL = `data:image/png;base64,${VISION_PROBE_PNG_BASE64}`;

/**
 * 探针提示词。要求模型**只回数字**，好让 `hasVisionProbeMarker` 做纯粹的
 * 字符串判定，避免被额外措辞干扰。
 */
export const VISION_PROBE_PROMPT = '请读取这张图片中的数字，只回复这些数字本身，不要添加任何其它文字。';

/**
 * 模型是否真的读出了探针图里的校验码。
 *
 * 两侧用 `\D` 而不是 `\b`：中文回复里数字会紧邻汉字（"数字是 7319。"），
 * `\b` 在汉字与数字之间不成立，会漏判。这与 NewMax 的实现一致。
 */
export function hasVisionProbeMarker(text: string): boolean {
  return new RegExp(`(?:^|\\D)${VISION_PROBE_MARKER}(?:\\D|$)`).test(text.trim());
}

/**
 * 失败原因分类 —— 与 NewMax 的 `classifyVisionProbeFailure` 同一套六类 + unknown。
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

const FAILURE_PATTERNS: ReadonlyArray<[VisionProbeFailureClass, RegExp]> = [
  [
    'unsupported',
    /only supports? text|text[- ]only|image(?: input)? (?:is )?(?:unsupported|not supported)|does not support (?:image|vision)|unknown variant [`'"]?image_url|不支持.{0,8}(?:图片|图像|视觉)|仅支持.{0,6}文本|只支持.{0,6}文本/i,
  ],
  [
    'authentication',
    /\b(?:401|403)\b|invalid api[- ]?key|api[- ]?key.{0,30}invalid|authentication|unauthori[sz]ed|forbidden|api 密钥无效|密钥无效|未授权|鉴权失败/i,
  ],
  ['rateLimit', /\b429\b|rate.?limit|too many requests|限流|请求过多/i],
  ['timeout', /timeout|timed out|请求超时|连接超时|验证超时/i],
  ['network', /network|econn|enotfound|socket|fetch failed|连接失败|连接中断|网络(?:异常|错误|不可用)/i],
  [
    'responseMismatch',
    /未识别测试图中的(?:数字|四位校验码)|did not identify (?:the )?(?:four-digit code in the )?probe image|probe image response mismatch/i,
  ],
];

export function classifyVisionProbeFailure(reason: string): VisionProbeFailureClass {
  const normalized = reason?.trim() ?? '';
  for (const [label, pattern] of FAILURE_PATTERNS) {
    if (pattern.test(normalized)) return label;
  }
  return 'unknown';
}

/** 六类原因的展示文案。`responseMismatch` 即「读到了图但没读出校验码」。 */
export const VISION_PROBE_FAILURE_LABELS: Record<VisionProbeFailureClass, string> = {
  unsupported: '该模型不支持图片输入',
  authentication: '鉴权失败（API 密钥无效或未授权）',
  rateLimit: '被限流（429 / 请求过多）',
  timeout: '请求超时',
  network: '网络异常或连接中断',
  responseMismatch: `未识别测试图中的校验码 ${VISION_PROBE_MARKER}（可能未真正读取图片）`,
  unknown: '未通过（原因未识别）',
};

/**
 * 把失败原因压成一行**原因描述**（不含「图片输入未通过」这类前缀，前缀由调用方加）：
 * 能归类就给归类文案，归不了类就原样保留上游消息，至少让人看到真实报错。
 *
 * 之所以不带前缀：调用方要保证每一条图片失败原因里都出现「图片」二字，
 * 否则扫描面板按关键词筛原因行时会漏掉限流、网络这类标签本身不含该词的分类。
 */
export function describeVisionProbeFailure(reason: string): string {
  const kind = classifyVisionProbeFailure(reason);
  if (kind === 'unknown') {
    return reason?.trim() || VISION_PROBE_FAILURE_LABELS.unknown;
  }
  return VISION_PROBE_FAILURE_LABELS[kind];
}
