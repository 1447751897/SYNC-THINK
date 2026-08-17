import { describe, expect, it } from 'vitest';
import type { Message, MessageId, ThreadId } from '@sync-think/shared';
import {
  computeKernelGapFromMessages,
  formatKernelBootstrapTranscript,
  formatKernelGapTranscript,
  providerContentToKernelTranscript,
} from './runtime.js';
import type { ProviderMessage } from '@sync-think/adapters';

function makeMessage(sequence: number, text: string): Message {
  return {
    id: `m-${sequence}` as MessageId,
    threadId: 'thread-test' as ThreadId,
    role: 'user',
    blocks: [{ type: 'text', text }],
    createdAt: new Date(0).toISOString(),
    sequence,
  };
}

function makeToolTurn(sequence: number): Message {
  return {
    id: `t-${sequence}` as MessageId,
    threadId: 'thread-test' as ThreadId,
    role: 'assistant',
    blocks: [
      { type: 'tool-call', payload: { name: 'write_file', argumentsJson: '{"path":"a.txt"}' } },
      { type: 'tool-result', text: 'wrote 3 bytes' },
    ],
    createdAt: new Date(0).toISOString(),
    sequence,
  };
}

describe('computeKernelGapFromMessages', () => {
  it('returns in-sync for an empty gap (no catch-up, not oversized)', () => {
    const result = computeKernelGapFromMessages([], 128_000);
    expect(result).toEqual({ count: 0, oversized: false });
  });

  it('builds a catch-up transcript for a small gap and exposes the count', () => {
    const messages = [makeMessage(1, 'first gap turn'), makeMessage(2, 'second gap turn')];
    const result = computeKernelGapFromMessages(messages, 128_000);
    expect(result.count).toBe(2);
    expect(result.oversized).toBe(false);
    expect(result.catchUp).toContain('## Cross-kernel session gap');
    expect(result.catchUp).toContain('### User');
    expect(result.catchUp).toContain('first gap turn');
    expect(result.catchUp).toContain('second gap turn');
  });

  it('marks a gap with more turns than the message limit as oversized', () => {
    const messages = Array.from({ length: 61 }, (_, index) => makeMessage(index + 1, `turn ${index}`));
    const result = computeKernelGapFromMessages(messages, 128_000);
    expect(result.oversized).toBe(true);
    expect(result.count).toBe(61);
    expect(result.catchUp).toBeUndefined();
  });

  it('marks a gap whose rough token share of the window exceeds the ratio as oversized', () => {
    const longText = 'x'.repeat(200_000); // rough tokens ≈ 50k > 128k * 0.35 = 44.8k
    const result = computeKernelGapFromMessages([makeMessage(1, longText)], 128_000);
    expect(result.oversized).toBe(true);
  });

  it('renders tool calls with their name + arguments in the catch-up transcript', () => {
    const result = computeKernelGapFromMessages([makeToolTurn(1)], 128_000);
    expect(result.oversized).toBe(false);
    expect(result.catchUp).toContain('write_file');
    expect(result.catchUp).toContain('a.txt');
  });
});

describe('formatKernelGapTranscript', () => {
  it('marks the block as prior context, not the current user input', () => {
    const provider: ProviderMessage[] = [
      { role: 'user', content: 'a fact from the codex era' },
      { role: 'assistant', content: 'the codex answer' },
    ];
    const text = formatKernelGapTranscript(provider);
    expect(text).toContain('NOT the current user input');
    expect(text).toContain('a fact from the codex era');
    expect(text).toContain('the codex answer');
    expect(text).toContain('### Assistant');
  });

  it('returns empty when every turn is empty', () => {
    expect(formatKernelGapTranscript([{ role: 'user', content: '   ' }])).toBe('');
  });
});

describe('providerContentToKernelTranscript', () => {
  it('keeps the tool name and labels arguments + results', () => {
    const text = providerContentToKernelTranscript([
      {
        type: 'tool-call',
        toolCall: { id: 'c1', name: 'write_file', argumentsJson: '{"path":"a.txt"}' },
      },
      { type: 'tool-result', toolResult: 'wrote 3 bytes' },
    ]);
    expect(text).toContain('[Tool call: write_file 参数: {"path":"a.txt"}]');
    expect(text).toContain('[Tool result: wrote 3 bytes]');
  });

  it('truncates oversized arguments and results with an explicit marker', () => {
    const longArgs = JSON.stringify({ data: 'x'.repeat(600) });
    const longResult = 'y'.repeat(2000);
    const text = providerContentToKernelTranscript([
      { type: 'tool-call', toolCall: { id: 'c1', name: 'run_command', argumentsJson: longArgs } },
      { type: 'tool-result', toolResult: longResult },
    ]);
    expect(text).toContain('(参数截断)');
    expect(text).toContain('(结果截断)');
    expect(text.length).toBeLessThan(1200);
  });

  it('omits the tool-call arguments entirely when absent', () => {
    const text = providerContentToKernelTranscript([
      { type: 'tool-call', toolCall: { id: 'c1', name: 'noop', argumentsJson: '' } },
    ]);
    expect(text).toBe('[Tool call: noop]');
  });
});

describe('formatKernelBootstrapTranscript', () => {
  it('annotates the block as restored history, not the current user input', () => {
    const text = formatKernelBootstrapTranscript([
      { role: 'user', content: 'earlier fact' },
      { role: 'assistant', content: 'earlier answer' },
    ]);
    expect(text).toContain('## Restored conversation context');
    expect(text).toContain('NOT the current user input');
    expect(text).toContain('earlier fact');
    expect(text).toContain('earlier answer');
  });
});
