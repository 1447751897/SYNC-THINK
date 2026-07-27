import { describe, expect, it } from 'vitest';
import {
  MAX_CONTEXT_STATUS_TOKENS,
  MAX_CONTEXT_STATUS_USAGE_RATIO,
  parseConversationGetContextStatusPayload,
  parseConversationGetContextStatusResponse,
} from './conversation-context-status.js';
import {
  req,
  type ConversationGetContextStatusResponse,
  type ContextStatusSection,
} from './commands.js';
import { decodeFrames, encodeFrame } from './framing.js';
import { DEFAULT_FEATURES } from './version.js';

const validSections: ContextStatusSection[] = [
  { type: 'system', tokens: 120 },
  { type: 'agent', tokens: 80 },
  { type: 'project', tokens: 160 },
  { type: 'summary', tokens: 0 },
  { type: 'messages', tokens: 240 },
  { type: 'tools', tokens: 100 },
];

const validResponse: ConversationGetContextStatusResponse = {
  modelId: 'provider/model-1',
  contextWindow: 1_000,
  estimatedUsedTokens: 700,
  usageRatio: 0.7,
  compactThreshold: 0.7,
  compactedAt: '2026-07-27T12:34:56.000Z',
  sections: validSections,
};

describe('conversation.getContextStatus protocol', () => {
  it('registers the command and builds its typed request', () => {
    expect(DEFAULT_FEATURES).toContain('conversation.getContextStatus');
    expect(
      req('conversation.getContextStatus', { conversationId: 'conv-1' }, 'request-1'),
    ).toEqual({
      type: 'conversation.getContextStatus',
      payload: { conversationId: 'conv-1' },
      requestId: 'request-1',
    });
  });

  it('round-trips the audit-only response without context body or reasoning', () => {
    const encoded = encodeFrame({
      id: 'response-1',
      kind: 'response',
      type: 'conversation.getContextStatus',
      payload: validResponse,
    });
    expect(decodeFrames(encoded).frames[0]?.payload).toEqual(validResponse);
  });

  it('strictly validates conversationId', () => {
    expect(parseConversationGetContextStatusPayload({ conversationId: 'conv-1' })).toEqual({
      conversationId: 'conv-1',
    });
    expect(() => parseConversationGetContextStatusPayload({ conversationId: '' })).toThrow();
    expect(() => parseConversationGetContextStatusPayload({ conversationId: '   ' })).toThrow();
    expect(() =>
      parseConversationGetContextStatusPayload({ conversationId: 'x'.repeat(129) }),
    ).toThrow();
    expect(() =>
      parseConversationGetContextStatusPayload({ conversationId: 'conv-1', extra: true }),
    ).toThrow();
  });

  it('accepts a bounded internally consistent response', () => {
    expect(parseConversationGetContextStatusResponse(validResponse)).toEqual(validResponse);
    const { compactedAt: _compactedAt, ...withoutCompactedAt } = validResponse;
    expect(parseConversationGetContextStatusResponse(withoutCompactedAt)).toEqual(
      withoutCompactedAt,
    );
  });

  it('keeps truthful usage when the request estimate exceeds the model window', () => {
    const sections = validSections.map((section, index) =>
      index === 0 ? { ...section, tokens: section.tokens + 400 } : section,
    );
    const response = {
      ...validResponse,
      estimatedUsedTokens: 1_100,
      usageRatio: 1.1,
      sections,
    };
    expect(parseConversationGetContextStatusResponse(response)).toEqual(response);
  });

  it.each([
    { ...validResponse, modelId: '' },
    { ...validResponse, modelId: 'x'.repeat(257) },
    { ...validResponse, contextWindow: 0 },
    { ...validResponse, contextWindow: 1.5 },
    { ...validResponse, contextWindow: MAX_CONTEXT_STATUS_TOKENS + 1 },
    { ...validResponse, estimatedUsedTokens: -1 },
    { ...validResponse, estimatedUsedTokens: MAX_CONTEXT_STATUS_TOKENS + 1 },
    { ...validResponse, usageRatio: -0.1 },
    { ...validResponse, usageRatio: Number.POSITIVE_INFINITY },
    { ...validResponse, usageRatio: 1.1 },
    { ...validResponse, usageRatio: MAX_CONTEXT_STATUS_USAGE_RATIO + 1 },
    { ...validResponse, compactThreshold: 0.69 },
    { ...validResponse, compactedAt: 'not-a-date' },
    { ...validResponse, estimatedUsedTokens: 699 },
    { ...validResponse, usageRatio: 0.69 },
    { ...validResponse, reasoning: 'hidden chain' },
    { ...validResponse, extra: true },
  ])('rejects invalid status numbers or top-level fields: %#', (response) => {
    expect(() => parseConversationGetContextStatusResponse(response)).toThrow();
  });

  it.each([
    validSections.slice(0, -1),
    validSections.map((section, index) =>
      index === 0 ? { ...section, type: 'other' } : section,
    ),
    validSections.map((section, index) =>
      index === 0 ? { ...section, tokens: -1 } : section,
    ),
    validSections.map((section, index) =>
      index === 0 ? { ...section, tokens: 1.5 } : section,
    ),
    validSections.map((section, index) =>
      index === 0 ? { ...section, tokens: MAX_CONTEXT_STATUS_TOKENS + 1 } : section,
    ),
    validSections.map((section, index) =>
      index === 0 ? { ...section, body: 'secret prompt' } : section,
    ),
    validSections.map((section, index) =>
      index === 0 ? { ...section, reasoning: 'hidden chain' } : section,
    ),
    validSections.map((section, index) =>
      index === validSections.length - 1 ? { ...section, type: 'system' } : section,
    ),
  ])('rejects incomplete, invalid, duplicate, or content-bearing sections: %#', (sections) => {
    expect(() =>
      parseConversationGetContextStatusResponse({ ...validResponse, sections }),
    ).toThrow();
  });
});
