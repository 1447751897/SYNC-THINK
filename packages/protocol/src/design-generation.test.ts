import { describe, expect, it } from 'vitest';
import {
  buildDesignGenerationPrompt,
  extractGeneratedDesignHtml,
  parseDesignGeneratePayload,
} from './design-generation.js';

describe('design generation protocol', () => {
  const payload = {
    requestId: 'design-1',
    frame: { type: 'magicframe', x: 10, y: 20, width: 320, height: 180 },
    children: [{ id: 'title', type: 'text', x: 24, y: 36, text: 'Hello' }],
  };

  it('accepts a bounded scene and includes it in the provider prompt', () => {
    const parsed = parseDesignGeneratePayload(payload);
    expect(parsed).toEqual(payload);
    expect(buildDesignGenerationPrompt(parsed!)).toContain('Children JSON');
  });

  it('rejects unknown keys, non-record children and oversized scenes', () => {
    expect(parseDesignGeneratePayload({ ...payload, extra: true })).toBeUndefined();
    expect(parseDesignGeneratePayload({ ...payload, children: [null] })).toBeUndefined();
    expect(
      parseDesignGeneratePayload({
        ...payload,
        children: [{ id: 'large', value: 'x'.repeat(1_600_000) }],
      }),
    ).toBeUndefined();
  });

  it('extracts one complete HTML document and rejects partial output', () => {
    const html = '<!doctype html><html><head><title>Demo</title></head><body><main>Demo</main></body></html>';
    expect(extractGeneratedDesignHtml(`Here you go:\n\`\`\`html\n${html}\n\`\`\``)).toBe(html);
    expect(() => extractGeneratedDesignHtml('<html><head></head><body>partial')).toThrow(
      '模型未返回完整 HTML 设计稿',
    );
    expect(() => extractGeneratedDesignHtml('<html><head></head><body><design-html /></body></html>')).toThrow(
      '嵌套 design-html',
    );
  });
});
