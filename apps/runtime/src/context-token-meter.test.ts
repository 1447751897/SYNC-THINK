import { describe, expect, it } from 'vitest';
import { createUsageAnchor, measureContextRequest } from './context-token-meter.js';
const request = {
  systemPrompt: 'stable prefix',
  tools: [{ name: 'read_file', description: 'read', inputSchema: { type: 'object' } }],
  messages: [{ role: 'user' as const, content: '甲'.repeat(1000) }],
};
describe('native request usage calibration', () => {
  it('applies a signed delta after pruning and counts cached input only once', () => {
    const raw = measureContextRequest(request, 'route');
    const anchor = createUsageAnchor(request, 'route', {
      tokensIn: raw.usedTokens + 120,
      tokensOut: 50,
      cachedTokensHit: 100,
    });
    const smaller = {
      ...request,
      messages: [{ role: 'user' as const, content: '甲'.repeat(500) }],
    };
    const next = measureContextRequest(smaller, 'route', anchor);
    expect(next.source).toBe('provider-calibrated');
    expect(next.usedTokens).toBe(measureContextRequest(smaller, 'route').usedTokens + 120);
    expect(next.fixedInputTokens + next.messageTokens).toBe(next.usedTokens);
  });
  it('drops anchors on model/header/tool changes and rejects invalid or missing usage', () => {
    const anchor = createUsageAnchor(request, 'route', { tokensIn: 900, tokensOut: 0 });
    for (const [candidate, binding] of [
      [request, 'other'],
      [{ ...request, systemPrompt: 'changed' }, 'route'],
      [{ ...request, tools: [] }, 'route'],
    ] as const) {
      expect(measureContextRequest(candidate, binding, anchor).source).toBe('estimate');
    }
    expect(createUsageAnchor(request, 'route', { tokensIn: NaN, tokensOut: 0 })).toBeUndefined();
    expect(createUsageAnchor(request, 'route', { tokensIn: 0, tokensOut: 0 })).toBeUndefined();
  });
  it('measures tool-call arguments as input, not just the visible assistant text', () => {
    const plain = { role: 'assistant' as const, content: '' };
    const tool = {
      ...plain,
      content: [
        {
          type: 'tool-call' as const,
          text: 'read',
          toolCall: {
            id: 'call',
            name: 'read_file',
            argumentsJson: JSON.stringify({ path: '甲'.repeat(1000) }),
          },
        },
      ],
    };
    expect(
      measureContextRequest({ ...request, messages: [tool] }, 'route').usedTokens,
    ).toBeGreaterThan(
      measureContextRequest({ ...request, messages: [plain] }, 'route').usedTokens + 500,
    );
  });
});
