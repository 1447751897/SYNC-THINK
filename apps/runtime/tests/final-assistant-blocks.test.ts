import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '@sync-think/shared';
import { buildFinalAssistantBlocks } from '../src/runtime.js';

const toolBlocks: MessageBlock[] = [
  { type: 'tool-call', payload: { name: 'read_file', argumentsJson: '{}' } },
  { type: 'tool-result', text: 'ok' },
];

describe('buildFinalAssistantBlocks', () => {
  it('leads with the reasoning row for the native kernel (time order)', () => {
    const blocks = buildFinalAssistantBlocks({
      commentaryText: '我先读取文件。',
      commentarySegments: [],
      assistantText: '最终回答。',
      reasoningText: '内部思考',
      reasoningSegments: [],
      toolBlocks,
      reasoningFirst: true,
    });
    expect(blocks.map((b) => b.type)).toEqual([
      'reasoning',
      'commentary',
      'text',
      'tool-call',
      'tool-result',
    ]);
  });

  it('keeps the legacy [text … reasoning] order for external kernels', () => {
    const blocks = buildFinalAssistantBlocks({
      commentaryText: undefined,
      commentarySegments: [],
      assistantText: 'visible answer',
      reasoningText: 'internal plan',
      reasoningSegments: [],
      toolBlocks: [],
      reasoningFirst: false,
    });
    expect(blocks.map((b) => b.type)).toEqual(['text', 'reasoning']);
  });

  it('omits the reasoning block when no reasoning was produced', () => {
    const blocks = buildFinalAssistantBlocks({
      commentaryText: undefined,
      commentarySegments: [],
      assistantText: 'answer',
      reasoningText: undefined,
      reasoningSegments: [],
      toolBlocks: [],
      reasoningFirst: true,
    });
    expect(blocks.map((b) => b.type)).toEqual(['text']);
  });

  it('carries reasoning segments payload when present', () => {
    const blocks = buildFinalAssistantBlocks({
      commentaryText: undefined,
      commentarySegments: [],
      assistantText: '',
      reasoningText: undefined,
      reasoningSegments: [{ text: 'seg-1' }],
      toolBlocks: [],
      reasoningFirst: true,
    });
    expect(blocks[0]).toMatchObject({
      type: 'reasoning',
      payload: { reasoningSegments: [{ text: 'seg-1' }] },
    });
  });
});
