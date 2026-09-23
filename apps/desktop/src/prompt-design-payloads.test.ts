import { describe, expect, it } from 'vitest';
import {
  parseDesignGeneratePayloadForDesktop,
  parsePromptEnhanceCancelPayload,
  parsePromptEnhancePayload,
} from './prompt-design-payloads.js';

describe('Prompt and design payload parsing', () => {
  it('normalizes prompt enhancement fields', () => {
    expect(
      parsePromptEnhancePayload({
        requestId: ' enhance-1 ',
        text: ' Improve this prompt. ',
        modelId: ' model-fast ',
      }),
    ).toEqual({ requestId: 'enhance-1', text: 'Improve this prompt.', modelId: 'model-fast' });
    expect(parsePromptEnhancePayload({ requestId: 'enhance-2', text: ' Draft ', modelId: ' ' })).toEqual(
      { requestId: 'enhance-2', text: 'Draft' },
    );
  });

  it('rejects invalid prompt enhancement fields', () => {
    expect(() => parsePromptEnhancePayload({ requestId: '', text: 'draft' })).toThrow(
      'Invalid prompt-enhance payload',
    );
    expect(() =>
      parsePromptEnhancePayload({ requestId: 'enhance-1', text: 'draft', modelId: 1 }),
    ).toThrow('Invalid prompt-enhance model');
  });

  it('normalizes enhancement cancellation', () => {
    expect(parsePromptEnhanceCancelPayload({ requestId: ' enhance-1 ' })).toEqual({
      requestId: 'enhance-1',
    });
    expect(() => parsePromptEnhanceCancelPayload({ requestId: ' ' })).toThrow(
      'Invalid prompt-enhance-cancel payload',
    );
  });

  it('reuses the strict protocol parser for design generation', () => {
    expect(
      parseDesignGeneratePayloadForDesktop({
        requestId: ' design-1 ',
        modelId: ' model-visual ',
        frame: { id: 'frame-1', type: 'magicframe' },
        children: [{ id: 'shape-1', type: 'rectangle' }],
      }),
    ).toEqual({
      requestId: 'design-1',
      modelId: 'model-visual',
      frame: { id: 'frame-1', type: 'magicframe' },
      children: [{ id: 'shape-1', type: 'rectangle' }],
    });
  });

  it('maps invalid design scenes to the Desktop boundary error', () => {
    expect(() =>
      parseDesignGeneratePayloadForDesktop({
        requestId: 'design-1',
        frame: null,
        children: [],
      }),
    ).toThrow('Invalid design-generate payload');
  });
});
