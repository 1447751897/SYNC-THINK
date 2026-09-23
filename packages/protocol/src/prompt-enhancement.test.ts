import { describe, expect, it } from 'vitest';
import { req, type PromptEnhanceCancelPayload, type PromptEnhancePayload } from './commands.js';
import {
  tryParsePromptEnhanceCancelPayload,
  tryParsePromptEnhancePayload,
} from './prompt-enhancement-payloads.js';
import { DEFAULT_FEATURES } from './version.js';
import type { ModelId } from '@sync-think/shared';

describe('prompt enhancement protocol', () => {
  it('advertises prompt enhancement and builds typed enhance/cancel requests', () => {
    expect(DEFAULT_FEATURES).toContain('prompt.enhance');

    const enhance: PromptEnhancePayload = {
      requestId: 'enhance-1',
      text: 'make a release plan',
      modelId: 'model-fast' as ModelId,
    };
    const cancel: PromptEnhanceCancelPayload = { requestId: 'enhance-1' };

    expect(req('prompt.enhance', enhance, 'frame-enhance')).toEqual({
      type: 'prompt.enhance',
      payload: enhance,
      requestId: 'frame-enhance',
    });
    expect(req('prompt.enhance.cancel', cancel, 'frame-cancel')).toEqual({
      type: 'prompt.enhance.cancel',
      payload: cancel,
      requestId: 'frame-cancel',
    });
  });

  it('normalizes prompt enhancement payloads at the protocol boundary', () => {
    expect(
      tryParsePromptEnhancePayload({
        requestId: ' enhance-1 ',
        text: ' improve this ',
        modelId: ' model-fast ',
      }),
    ).toEqual({ requestId: 'enhance-1', text: 'improve this', modelId: 'model-fast' });
    expect(tryParsePromptEnhanceCancelPayload({ requestId: ' enhance-1 ' })).toEqual({
      requestId: 'enhance-1',
    });
  });

  it('rejects malformed or oversized prompt enhancement payloads', () => {
    expect(tryParsePromptEnhancePayload({ requestId: '', text: 'draft' })).toBeUndefined();
    expect(
      tryParsePromptEnhancePayload({ requestId: 'enhance-1', text: 'draft', modelId: 1 }),
    ).toBeUndefined();
    expect(
      tryParsePromptEnhancePayload({ requestId: 'enhance-1', text: 'x'.repeat(100_001) }),
    ).toBeUndefined();
    expect(tryParsePromptEnhanceCancelPayload({ requestId: 'x'.repeat(161) })).toBeUndefined();
  });
});
