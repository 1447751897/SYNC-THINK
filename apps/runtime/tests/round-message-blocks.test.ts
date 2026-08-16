import { describe, expect, it } from 'vitest';
import { buildRoundMessageBlocks } from '../src/runtime.js';

describe('buildRoundMessageBlocks', () => {
  it('builds one round: reasoning + commentary + text + tool call/result in order', () => {
    const blocks = buildRoundMessageBlocks({
      reasoningDelta: '本轮思考',
      transcriptMessages: [
        { phase: 'commentary', content: '我先读取文件。' },
        { phase: 'final_answer', content: '本轮回答。' },
      ],
      toolCalls: [{ name: 'read_file', argumentsJson: '{"path":"a.txt"}' }],
      toolResults: ['a.txt: 1 line'],
    });
    expect(blocks.map((b) => b.type)).toEqual([
      'reasoning',
      'commentary',
      'text',
      'tool-call',
      'tool-result',
    ]);
    expect(blocks[0]).toMatchObject({ type: 'reasoning', reasoningText: '本轮思考' });
    expect(blocks[3]).toMatchObject({
      type: 'tool-call',
      payload: { name: 'read_file', argumentsJson: '{"path":"a.txt"}' },
    });
    expect(blocks[4]).toMatchObject({ type: 'tool-result', text: 'a.txt: 1 line' });
  });

  it('omits empty reasoning and text and pairs multiple tools with results', () => {
    const blocks = buildRoundMessageBlocks({
      reasoningDelta: '',
      transcriptMessages: [{ phase: 'commentary', content: '  ' }],
      toolCalls: [
        { name: 'read_file', argumentsJson: '{}' },
        { name: 'search_files', argumentsJson: '{}' },
      ],
      toolResults: ['one', 'two'],
    });
    expect(blocks.map((b) => b.type)).toEqual(['tool-call', 'tool-result', 'tool-call', 'tool-result']);
    expect(blocks[3]).toMatchObject({ type: 'tool-result', text: 'two' });
  });

  it('carries only the final-answer text as the text block', () => {
    const blocks = buildRoundMessageBlocks({
      reasoningDelta: '思考',
      transcriptMessages: [
        { phase: 'commentary', content: '中间说明' },
        { phase: 'final_answer', content: '最终文本' },
      ],
      toolCalls: [],
      toolResults: [],
    });
    expect(blocks.map((b) => b.type)).toEqual(['reasoning', 'commentary', 'text']);
    expect(blocks[2]).toMatchObject({ type: 'text', text: '最终文本' });
  });
});
