import { describe, expect, it } from 'vitest';

import {
  classifyVisionProbeFailure,
  describeVisionProbeFailure,
  hasVisionProbeMarker,
  VISION_PROBE_IMAGE_URL,
  VISION_PROBE_MARKER,
  VISION_PROBE_PNG_BASE64,
  VISION_PROBE_PROMPT,
} from './vision-probe.js';

describe('hasVisionProbeMarker', () => {
  it('accepts a bare marker reply', () => {
    expect(hasVisionProbeMarker(VISION_PROBE_MARKER)).toBe(true);
  });

  it('accepts a marker wrapped in surrounding prose or punctuation', () => {
    expect(hasVisionProbeMarker('图中数字是 7319。')).toBe(true);
    expect(hasVisionProbeMarker('The digits are 7319.')).toBe(true);
    expect(hasVisionProbeMarker(' 7319 ')).toBe(true);
  });

  it('rejects the hallucinated replies a broken image path produces', () => {
    // 这条是判定链的核心价值：对着无法解析的图，模型常编出这些答复。
    // 若把「有非空文本」当通过，它们会被误判成具备视觉能力。
    expect(hasVisionProbeMarker('an image')).toBe(false);
    expect(hasVisionProbeMarker('white')).toBe(false);
    expect(hasVisionProbeMarker('I cannot see the image')).toBe(false);
    expect(hasVisionProbeMarker('')).toBe(false);
  });

  it('requires the marker to stand alone rather than appear inside a longer number', () => {
    expect(hasVisionProbeMarker('17319')).toBe(false);
    expect(hasVisionProbeMarker('73190')).toBe(false);
    expect(hasVisionProbeMarker('73197')).toBe(false);
  });
});

describe('classifyVisionProbeFailure', () => {
  it('classifies the six NewMax failure families', () => {
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

  it('exposes the image as a data URL and pins the prompt to a digits-only answer', () => {
    expect(VISION_PROBE_IMAGE_URL.startsWith('data:image/png;base64,')).toBe(true);
    expect(VISION_PROBE_IMAGE_URL).toContain(VISION_PROBE_PNG_BASE64);
    expect(VISION_PROBE_PROMPT).toContain('数字');
  });
});
