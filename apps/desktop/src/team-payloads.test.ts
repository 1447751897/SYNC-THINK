import { describe, expect, it } from 'vitest';
import {
  parseConversationDecideToolApprovalPayload,
  parseConversationGetContextStatusPayload,
  parseConversationGetRunProcessPayload,
  parseSetConversationContextWindowOverridePayload,
} from './team-payloads.js';

describe('parseConversationDecideToolApprovalPayload', () => {
  it('preserves the real approval scope and defaults legacy calls to once', () => {
    expect(
      parseConversationDecideToolApprovalPayload({
        approvalId: 'approval-1',
        decision: 'approve',
        scope: 'session',
      }),
    ).toEqual({ approvalId: 'approval-1', decision: 'approve', scope: 'session' });
    expect(
      parseConversationDecideToolApprovalPayload({
        approvalId: 'approval-2',
        decision: 'deny',
      }),
    ).toEqual({ approvalId: 'approval-2', decision: 'deny', scope: 'once' });
  });

  it('rejects remembered deny decisions and unknown scopes', () => {
    expect(() =>
      parseConversationDecideToolApprovalPayload({
        approvalId: 'approval-1',
        decision: 'deny',
        scope: 'session',
      }),
    ).toThrow('Invalid conversation-decide-tool-approval payload');
    expect(() =>
      parseConversationDecideToolApprovalPayload({
        approvalId: 'approval-1',
        decision: 'approve',
        scope: 'forever',
      }),
    ).toThrow('Invalid conversation-decide-tool-approval payload');
  });
});

describe('parseConversationGetRunProcessPayload', () => {
  it('accepts one bounded non-empty run id', () => {
    expect(parseConversationGetRunProcessPayload({ runId: 'run-1' })).toEqual({ runId: 'run-1' });
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { runId: '' },
    { runId: '   ' },
    { runId: 1 },
    { runId: 'run-1', extra: true },
    { runId: 'x'.repeat(129) },
  ])('rejects malformed payload %#', (payload) => {
    expect(() => parseConversationGetRunProcessPayload(payload)).toThrow(
      'Invalid get-conversation-run-process payload',
    );
  });
});

describe('parseConversationGetContextStatusPayload', () => {
  it('accepts a bounded conversation id with optional model and kernel overrides', () => {
    expect(parseConversationGetContextStatusPayload({ conversationId: 'conv-1' })).toEqual({
      conversationId: 'conv-1',
    });
    expect(
      parseConversationGetContextStatusPayload({
        conversationId: 'conv-1',
        modelId: 'provider/model-luna',
        kernelId: 'claude-code',
      }),
    ).toEqual({
      conversationId: 'conv-1',
      modelId: 'provider/model-luna',
      kernelId: 'claude-code',
    });
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { conversationId: '' },
    { conversationId: '   ' },
    { conversationId: 1 },
    { conversationId: 'conv-1', modelId: '' },
    { conversationId: 'conv-1', modelId: 1 },
    { conversationId: 'conv-1', modelId: 'x'.repeat(257) },
    { conversationId: 'conv-1', kernelId: '' },
    { conversationId: 'conv-1', kernelId: 'x'.repeat(65) },
    { conversationId: 'conv-1', extra: true },
    { conversationId: 'x'.repeat(129) },
  ])('rejects malformed payload %#', (payload) => {
    expect(() => parseConversationGetContextStatusPayload(payload)).toThrow(
      'Invalid get-conversation-context-status payload',
    );
  });
});

describe('parseSetConversationContextWindowOverridePayload', () => {
  it('accepts a bounded token capacity or null to restore the model default', () => {
    expect(
      parseSetConversationContextWindowOverridePayload({
        conversationId: 'conv-1',
        contextWindowOverride: 256_000,
      }),
    ).toEqual({ conversationId: 'conv-1', contextWindowOverride: 256_000 });
    expect(
      parseSetConversationContextWindowOverridePayload({
        conversationId: 'conv-1',
        contextWindowOverride: null,
      }),
    ).toEqual({ conversationId: 'conv-1', contextWindowOverride: null });
  });

  it.each([
    undefined,
    {},
    { conversationId: '', contextWindowOverride: 256_000 },
    { conversationId: 'conv-1', contextWindowOverride: 1_023 },
    { conversationId: 'conv-1', contextWindowOverride: 10_000_001 },
    { conversationId: 'conv-1', contextWindowOverride: 128_000.5 },
    { conversationId: 'conv-1', contextWindowOverride: 128_000, extra: true },
  ])('rejects malformed payload %#', (payload) => {
    expect(() => parseSetConversationContextWindowOverridePayload(payload)).toThrow(
      'Invalid set-conversation-context-window-override payload',
    );
  });
});
