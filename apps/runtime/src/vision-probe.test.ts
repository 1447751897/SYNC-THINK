import { describe, expect, it } from 'vitest';

import { FakeProvider } from '@sync-think/adapters';

import {
  classifyVisionProbeFailure,
  describeVisionProbeFailure,
  formatCapabilityUnknownReply,
  hasVisionProbeMarker,
  interpretImageProbeResponse,
  isExplicitMediaUnsupported,
  probeText,
  VISION_PROBE_DOCUMENT_PROMPT,
  VISION_PROBE_IMAGE_URL,
  VISION_PROBE_MARKER,
  VISION_PROBE_MP4_BASE64,
  VISION_PROBE_MP4_URL,
  VISION_PROBE_PDF_BASE64,
  VISION_PROBE_PDF_URL,
  VISION_PROBE_PNG_BASE64,
  VISION_PROBE_PROMPT,
  VISION_PROBE_VIDEO_PROMPT,
  VISION_REFUSAL_PATTERNS,
} from './vision-probe.js';

describe('hasVisionProbeMarker', () => {
  it('accepts a bare marker reply', () => {
    expect(hasVisionProbeMarker(VISION_PROBE_MARKER)).toBe(true);
  });

  it('accepts a marker wrapped in surrounding prose or punctuation', () => {
    expect(hasVisionProbeMarker(`图中数字是 ${VISION_PROBE_MARKER}。`)).toBe(true);
    expect(hasVisionProbeMarker(`The digits are ${VISION_PROBE_MARKER}.`)).toBe(true);
    expect(hasVisionProbeMarker(` ${VISION_PROBE_MARKER} `)).toBe(true);
  });

  it('rejects the hallucinated replies a broken image path produces', () => {
    // 这条是判定链的核心价值：对着无法解析的图，模型常编出这些答复。
    // 若把「有非空文本」当通过，它们会被误判成具备视觉能力。
    expect(hasVisionProbeMarker('an image')).toBe(false);
    expect(hasVisionProbeMarker('white')).toBe(false);
    expect(hasVisionProbeMarker('I cannot see the image')).toBe(false);
    expect(hasVisionProbeMarker('')).toBe(false);
  });

  it('does not accept the pre-alignment synonyms NewMax never matches', () => {
    // 移植版曾额外接受这些写法；NewMax 只认校验码本身，多认会让结果不可比。
    expect(hasVisionProbeMarker('forty-two')).toBe(false);
    expect(hasVisionProbeMarker('四十二')).toBe(false);
    expect(hasVisionProbeMarker('4 and 2')).toBe(false);
  });

  it('requires the marker to stand alone rather than appear inside a longer number', () => {
    expect(hasVisionProbeMarker(`1${VISION_PROBE_MARKER}`)).toBe(false);
    expect(hasVisionProbeMarker(`${VISION_PROBE_MARKER}0`)).toBe(false);
    expect(hasVisionProbeMarker(`9${VISION_PROBE_MARKER}9`)).toBe(false);
  });
});

describe('interpretImageProbeResponse', () => {
  it('answers supported when the model reads the code', () => {
    expect(interpretImageProbeResponse(VISION_PROBE_MARKER)).toEqual({ supported: true });
    expect(interpretImageProbeResponse(`The code is ${VISION_PROBE_MARKER}.`)).toEqual({
      supported: true,
    });
  });

  it('answers unsupported only on an explicit refusal', () => {
    const verdict = interpretImageProbeResponse('I cannot see the image');
    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toBe(probeText('capabilityNoImage'));

    expect(interpretImageProbeResponse('我是一个纯文本模型').supported).toBe(false);
    expect(interpretImageProbeResponse('看不到').supported).toBe(false);
    expect(interpretImageProbeResponse('This model is text-only').supported).toBe(false);
  });

  it('answers unsupported when the model replies a bare none', () => {
    expect(interpretImageProbeResponse('none').supported).toBe(false);
    expect(interpretImageProbeResponse('"none".').supported).toBe(false);
    expect(interpretImageProbeResponse('没有').supported).toBe(false);
  });

  it('leaves the verdict unknown when the reply is off-script', () => {
    // 最关键的一条：模型答非所问时，NewMax 不写 false —— 写 false 会把这个模型
    // 永久降级到视觉 fallback / OCR，而它可能只是没读出这张探针图。
    for (const reply of ['an image of a chart', 'white', 'a QR code']) {
      const verdict = interpretImageProbeResponse(reply);
      expect(verdict.supported).toBeUndefined();
      expect(verdict.reason).toBeTruthy();
    }
  });

  it('truncates the off-script reply the way NewMax does', () => {
    const long = 'x'.repeat(200);
    const verdict = interpretImageProbeResponse(long);
    expect(verdict.supported).toBeUndefined();
    expect(verdict.reason).toBe(formatCapabilityUnknownReply('x'.repeat(60)));
  });

  it('ships all twelve refusal patterns NewMax carries', () => {
    expect(VISION_REFUSAL_PATTERNS).toHaveLength(12);
  });
});

describe('classifyVisionProbeFailure', () => {
  it('classifies the seven NewMax failure families', () => {
    expect(classifyVisionProbeFailure('this model only supports text')).toBe('unsupported');
    expect(classifyVisionProbeFailure('该模型不支持图片输入')).toBe('unsupported');
    expect(classifyVisionProbeFailure('401 invalid api key')).toBe('authentication');
    expect(classifyVisionProbeFailure('429 too many requests')).toBe('rateLimit');
    expect(classifyVisionProbeFailure('request timed out')).toBe('timeout');
    expect(classifyVisionProbeFailure('fetch failed ECONNRESET')).toBe('network');
    expect(classifyVisionProbeFailure('未识别测试图中的四位校验码')).toBe('responseMismatch');
  });

  it('falls back to unknown instead of mislabelling an unrecognised reason', () => {
    expect(classifyVisionProbeFailure('something entirely else')).toBe('unknown');
    expect(classifyVisionProbeFailure('')).toBe('unknown');
  });
});

describe('describeVisionProbeFailure', () => {
  it('maps known classes to their display labels', () => {
    expect(describeVisionProbeFailure('rate limit exceeded')).toContain('限流');
  });

  it('preserves the original message when the class is unknown', () => {
    // 归不了类时至少让人看到真实报错，而不是一句无信息量的「未通过」。
    expect(describeVisionProbeFailure('some novel upstream complaint')).toBe(
      'some novel upstream complaint',
    );
  });

  it('still returns a usable label when there is no reason text at all', () => {
    expect(describeVisionProbeFailure('')).toBe('未通过（原因未识别）');
  });

  it('classifies every family the scan panel may need to surface', () => {
    // 扫描面板按「图片 / 校验码」筛原因行，限流、网络这类标签本身不含这两个词，
    // 所以运行时会在前面加「图片输入未通过」前缀。这里确认它们都能被归类。
    for (const reason of ['401 invalid api key', '429', 'timeout', 'ECONNRESET']) {
      expect(classifyVisionProbeFailure(reason)).not.toBe('unknown');
    }
  });
});

describe('probe image parity with NewMax', () => {
  it('is the same 160x96 1-bit PNG NewMax ships', () => {
    // 与 NewMax main-bundle 里的 VISION_PROBE_PNG_BASE64 逐字节相同。
    // 改这张图会让两侧的视觉判定失去可比性，所以在这里钉死规格。
    const buf = Buffer.from(VISION_PROBE_PNG_BASE64, 'base64');
    expect(buf.length).toBe(333);
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buf.readUInt32BE(16)).toBe(160); // width
    expect(buf.readUInt32BE(20)).toBe(96); // height
    expect(buf[24]).toBe(1); // bit depth
    expect(buf[25]).toBe(0); // greyscale colour type
  });

  it('exposes the image as a data URL and pins the prompt to the NewMax wording', () => {
    expect(VISION_PROBE_IMAGE_URL.startsWith('data:image/png;base64,')).toBe(true);
    expect(VISION_PROBE_IMAGE_URL).toContain(VISION_PROBE_PNG_BASE64);
    expect(VISION_PROBE_PROMPT).toBe(
      'What exact four-digit code do you see in this image? Reply with just the code, or "none" if you cannot see one.',
    );
  });

  it('pins the marker to the four-digit code NewMax embeds', () => {
    expect(VISION_PROBE_MARKER).toBe('7319');
  });
});

// NewMax 的 document / video 探针资产是字符串表查表调用，无法静态提取，
// 这里按同等规格自造。判定退化为「上游是否接受该媒体」，资产只需结构合法。
describe('probe document / video assets', () => {
  it('ships a structurally valid PDF', () => {
    const buf = Buffer.from(VISION_PROBE_PDF_BASE64, 'base64');
    expect(buf.length).toBe(329);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain('startxref');
    expect(buf.subarray(-6).toString('latin1').trim()).toBe('%%EOF');
  });

  it('ships a structurally valid MP4 whose box lengths are self-consistent', () => {
    const buf = Buffer.from(VISION_PROBE_MP4_BASE64, 'base64');
    expect(buf.length).toBe(140);
    expect(buf.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expect(buf.subarray(28, 32).toString('latin1')).toBe('moov');
    // box 长度与实际字节数必须自洽，否则部分上游会直接 400。
    expect(buf.readUInt32BE(0)).toBe(24);
    expect(buf.readUInt32BE(24)).toBe(116);
  });

  it('exposes both as data URLs with the NewMax prompts', () => {
    expect(VISION_PROBE_PDF_URL.startsWith('data:application/pdf;base64,')).toBe(true);
    expect(VISION_PROBE_PDF_URL).toContain(VISION_PROBE_PDF_BASE64);
    expect(VISION_PROBE_MP4_URL.startsWith('data:video/mp4;base64,')).toBe(true);
    expect(VISION_PROBE_MP4_URL).toContain(VISION_PROBE_MP4_BASE64);
    expect(VISION_PROBE_DOCUMENT_PROMPT).toBe('summarize');
    expect(VISION_PROBE_VIDEO_PROMPT).toBe('describe');
  });

  it('only judges a media dimension unsupported when the body says so', () => {
    expect(isExplicitMediaUnsupported('the document format is not supported', 'document')).toBe(true);
    expect(isExplicitMediaUnsupported('video input is unsupported', 'video')).toBe(true);
    // 关键防线：模糊失败（配额 / 参数名 / 路由）不能把一维媒体判负。
    expect(isExplicitMediaUnsupported('insufficient user quota', 'video')).toBe(false);
    expect(isExplicitMediaUnsupported('invalid parameter: max_tokens', 'document')).toBe(false);
    expect(isExplicitMediaUnsupported('unsupported parameter: temperature', 'video')).toBe(false);
  });
});

describe('FakeProvider 与探针校验码的一致性', () => {
  /**
   * 防漂移：探针的判定完全建立在「回复里出现校验码」这一个字符串比较上，
   * 所以测试替身的回答必须与 `VISION_PROBE_MARKER` 同步。两者曾漂移
   * （替身留 `42`、探针已改 `7319`），导致所有走替身的能力探测都落到
   * 「未判定」，`vision: true` 再也测不出来。
   */
  it('answers the probe with the exact marker so live vision detection stays testable', async () => {
    const provider = new FakeProvider();
    const events: string[] = [];
    for await (const event of provider.call({
      protocol: 'openai-chat',
      baseUrl: 'https://fake.example/v1',
      modelId: 'fake-vision',
      apiKey: 'sk-fake',
      idempotencyKey: 'vision-probe-marker-check',
      signal: new AbortController().signal,
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROBE_PROMPT },
            { type: 'image', imageUrl: VISION_PROBE_IMAGE_URL },
          ],
        },
      ],
    })) {
      if (event.type === 'text-delta') events.push(event.text);
    }

    const reply = events.join('');
    expect(hasVisionProbeMarker(reply)).toBe(true);
    expect(interpretImageProbeResponse(reply)).toEqual({ supported: true });
  });
});
