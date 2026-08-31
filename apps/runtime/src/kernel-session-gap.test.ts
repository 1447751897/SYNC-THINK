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

function makeMixedAssistantTurn(sequence: number): Message {
  return {
    id: `a-${sequence}` as MessageId,
    threadId: 'thread-test' as ThreadId,
    role: 'assistant',
    blocks: [
      { type: 'reasoning', reasoningText: 'private chain of thought' },
      { type: 'commentary', text: 'running a diagnostic command' },
      {
        type: 'tool-call',
        payload: { name: 'run_command', argumentsJson: '{"command":"secret"}' },
      },
      { type: 'tool-result', text: 'verbose tool output' },
      { type: 'text', text: 'final user-visible answer' },
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

  it('keeps a large gap on the native session and appends only the latest 20 portable turns', () => {
    const messages = Array.from({ length: 61 }, (_, index) =>
      makeMessage(index + 1, `turn ${index}`),
    );
    const result = computeKernelGapFromMessages(messages, 128_000);
    expect(result.oversized).toBe(false);
    expect(result.count).toBe(61);
    expect(result.catchUp).toContain('41 earlier portable turns omitted');
    expect(result.catchUp).not.toContain('turn 40\n');
    expect(result.catchUp).toContain('turn 41');
    expect(result.catchUp).toContain('turn 60');
  });

  it('bounds a large portable gap instead of rebuilding the native session', () => {
    const longText = 'x'.repeat(200_000);
    const result = computeKernelGapFromMessages([makeMessage(1, longText)], 128_000);
    expect(result.oversized).toBe(false);
    expect(result.catchUp).toContain('portable turn truncated');
    expect(Buffer.byteLength(result.catchUp ?? '', 'utf8')).toBeLessThanOrEqual(65_536);
  });

  it('does not replay tool-only host projections into the native session', () => {
    const result = computeKernelGapFromMessages([makeToolTurn(1)], 128_000);
    expect(result.oversized).toBe(false);
    expect(result.catchUp).toBeUndefined();
  });

  it('replays only final user-visible text, excluding reasoning, commentary and tool details', () => {
    const result = computeKernelGapFromMessages([makeMixedAssistantTurn(1)], 128_000);
    expect(result.catchUp).toContain('final user-visible answer');
    expect(result.catchUp).not.toContain('private chain of thought');
    expect(result.catchUp).not.toContain('running a diagnostic command');
    expect(result.catchUp).not.toContain('run_command');
    expect(result.catchUp).not.toContain('verbose tool output');
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
