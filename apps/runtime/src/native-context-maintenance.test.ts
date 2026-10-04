import { describe, expect, it, vi } from 'vitest';
import {
  prepareNativeContextRequest,
  streamWithContextOverflowRecovery,
} from './native-context-maintenance.js';

describe('Native request context maintenance', () => {
  it('preserves a low-pressure request without calling the summarizer', async () => {
    const summarize = vi.fn();
    const request = {
      systemPrompt: 'system',
      messages: [{ role: 'user' as const, content: '你好' }],
    };
    const result = await prepareNativeContextRequest({
      request,
      contextWindow: 10000,
      reservedOutputTokens: 1000,
      safetyMarginTokens: 500,
      bindingKey: 'thread:model',
      summarize,
    });
    expect(result.request).toEqual(request);
    expect(result.budget.availableInputTokens).toBe(8500);
    expect(result.compacted).toBe(false);
    expect(summarize).not.toHaveBeenCalled();
  });
});

const checkpointText = [
  '## Primary Request and Intent\n- 保留小说角色与用户硬约束。',
  '## Key Technical Concepts\n- (none)',
  '## Files and Code\n- story.md',
  '## Errors and Fixes\n- (none)',
  '## Pending Jobs\n- 完成终稿',
  '## Current Work\n- 写作中',
  '## Next Step\n- 继续最新要求',
  '## Critical Context\n- 不更换主角。',
].join('\n');

it('compacts only an old prefix at pressure and retains recent raw messages', async () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: 'turn-' + index + ' ' + 'x'.repeat(2200),
  }));
  const original = JSON.stringify(messages);
  const summarize = vi.fn(async () => checkpointText);
  const result = await prepareNativeContextRequest({
    request: { systemPrompt: 'system', messages },
    contextWindow: 10000,
    reservedOutputTokens: 1000,
    safetyMarginTokens: 500,
    bindingKey: 'thread:model',
    summarize,
  });
  expect(result.compacted).toBe(true);
  expect(summarize).toHaveBeenCalledTimes(1);
  expect(result.request.messages.slice(-2)).toEqual(messages.slice(-2));
  expect(result.estimatedUsedTokens).toBeLessThan(8500);
  expect(result.checkpoint?.sourceMessageCount).toBe(12);
  expect(JSON.stringify(messages)).toBe(original);
});

it('compacts a long tool loop without discarding the current raw user request or splitting pairs', async () => {
  const messages = [
    { role: 'user' as const, content: '今日任务：检查浏览器并整理报告，不发送邮件。' },
    ...Array.from({ length: 10 }, (_, index) => [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-call' as const,
            toolCall: { id: 'call-' + index, name: 'read', argumentsJson: '{}' },
          },
        ],
      },
      { role: 'tool' as const, toolCallId: 'call-' + index, content: 'x'.repeat(3000) },
    ]).flat(),
  ];
  const result = await prepareNativeContextRequest({
    request: { systemPrompt: 'system', messages },
    contextWindow: 8000,
    reservedOutputTokens: 800,
    safetyMarginTokens: 400,
    bindingKey: 'tool-loop',
    summarize: async () => checkpointText,
  });
  expect(result.compacted).toBe(true);
  expect(result.request.messages.some((item) => item.content === messages[0]!.content)).toBe(true);
  const retainedIds = result.request.messages
    .filter((item) => item.role === 'tool')
    .map((item) => item.toolCallId);
  const callIds = result.request.messages.flatMap((item) =>
    Array.isArray(item.content)
      ? item.content.flatMap((part) => (part.toolCall ? [part.toolCall.id] : []))
      : [],
  );
  expect(callIds).toEqual(retainedIds);
  expect(retainedIds.slice(-2)).toEqual(['call-8', 'call-9']);
});

it('prunes an old oversized tool result first and skips a paid summary once pressure falls', async () => {
  const messages = [
    { role: 'user' as const, content: 'read' },
    ...Array.from({ length: 3 }, (_, index) => [
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-call' as const,
            toolCall: { id: 't' + index, name: 'read', argumentsJson: '{}' },
          },
        ],
      },
      {
        role: 'tool' as const,
        toolCallId: 't' + index,
        content: 'x'.repeat(index === 0 ? 24000 : 50),
      },
    ]).flat(),
  ];
  const summarize = vi.fn(async () => checkpointText);
  const result = await prepareNativeContextRequest({
    request: { systemPrompt: 'system', messages },
    contextWindow: 6000,
    reservedOutputTokens: 600,
    safetyMarginTokens: 300,
    bindingKey: 'prune',
    summarize,
  });
  expect(result.prunedCount).toBe(1);
  expect(result.compacted).toBe(false);
  expect(summarize).not.toHaveBeenCalled();
  expect(result.request.messages.slice(-4)).toEqual(messages.slice(-4));
  expect(messages[2]!.content).toHaveLength(24000);
});

it('replays a checkpoint and preserves newly appended messages without repeating the summary call', async () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: 'turn-' + index + ' ' + 'x'.repeat(2200),
  }));
  const summarize = vi.fn(async () => checkpointText);
  const first = await prepareNativeContextRequest({
    request: { systemPrompt: 'system', messages },
    contextWindow: 10000,
    reservedOutputTokens: 1000,
    safetyMarginTokens: 500,
    bindingKey: 'replay',
    summarize,
  });
  const next = await prepareNativeContextRequest({
    request: {
      systemPrompt: 'system',
      messages: [...messages, { role: 'user', content: 'new instruction' }],
    },
    contextWindow: 10000,
    reservedOutputTokens: 1000,
    safetyMarginTokens: 500,
    bindingKey: 'replay',
    checkpoint: first.checkpoint,
    summarize,
  });
  expect(summarize).toHaveBeenCalledTimes(1);
  expect(next.request.messages.at(-1)?.content).toBe('new instruction');
  expect(next.request.messages.slice(0, -1)).toEqual(first.request.messages);
});

it('rejects a checkpoint whose source or model/session binding has changed', async () => {
  const messages = [
    { role: 'user' as const, content: '原始要求' },
    { role: 'assistant' as const, content: '原始回答' },
  ];
  const result = await prepareNativeContextRequest({
    request: { systemPrompt: 'system', messages },
    contextWindow: 10000,
    bindingKey: 'new-model',
    checkpoint: {
      bindingKey: 'old-model',
      sourceMessageCount: 1,
      sourcePrefixFingerprint: 'a'.repeat(64),
      summary: checkpointText,
    },
    summarize: async () => checkpointText,
  });
  expect(result.request.messages).toEqual(messages);
  expect(result.checkpoint).toBeUndefined();
});

it('keeps a soft-pressure request intact when summarization fails, without pretending it compacted', async () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: 'x'.repeat(2200),
  }));
  const result = await prepareNativeContextRequest({
    request: { systemPrompt: 'system', messages },
    contextWindow: 10000,
    reservedOutputTokens: 600,
    safetyMarginTokens: 300,
    bindingKey: 'failed',
    summarize: async () => undefined,
  });
  expect(result.compacted).toBe(false);
  expect(result.checkpoint).toBeUndefined();
  expect(result.request.messages).toEqual(messages);
  expect(result.warning).toContain('原始上下文仍保留');
});

it('rejects a summary if the selected source prefix changed while awaiting the model', async () => {
  const messages = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: 'x'.repeat(2200),
  }));
  await expect(
    prepareNativeContextRequest({
      request: { systemPrompt: 'system', messages },
      contextWindow: 10000,
      reservedOutputTokens: 1000,
      safetyMarginTokens: 500,
      bindingKey: 'changed',
      summarize: async () => {
        messages[0]!.content = '用户修正了最初约束';
        return checkpointText;
      },
    }),
  ).rejects.toThrow('所选消息已变化');
});

it('does not submit a checkpoint after cancellation', async () => {
  const controller = new AbortController();
  const messages = Array.from({ length: 16 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    content: 'x'.repeat(2200),
  }));
  await expect(
    prepareNativeContextRequest({
      request: { systemPrompt: 'system', messages },
      contextWindow: 10000,
      signal: controller.signal,
      reservedOutputTokens: 1000,
      safetyMarginTokens: 500,
      bindingKey: 'cancelled',
      summarize: async () => {
        controller.abort(new Error('用户取消'));
        return checkpointText;
      },
    }),
  ).rejects.toThrow('用户取消');
});

it('rejects fixed-cost overflow before doing any summary or discarding the current message', async () => {
  const summarize = vi.fn(async () => checkpointText);
  await expect(
    prepareNativeContextRequest({
      request: {
        systemPrompt: 'x'.repeat(40000),
        messages: [{ role: 'user', content: 'keep me' }],
      },
      contextWindow: 10000,
      reservedOutputTokens: 1000,
      safetyMarginTokens: 500,
      bindingKey: 'fixed',
      summarize,
    }),
  ).rejects.toThrow('固定成本');
  expect(summarize).not.toHaveBeenCalled();
});

it('retries a confirmed context overflow once only after real request reduction', async () => {
  const original = {
    systemPrompt: 'system',
    messages: [{ role: 'user' as const, content: 'x'.repeat(400) }],
  };
  const reduced = {
    systemPrompt: 'system',
    messages: [{ role: 'user' as const, content: 'short checkpoint' }],
  };
  let calls = 0;
  const events = [];
  for await (const event of streamWithContextOverflowRecovery({
    request: original,
    call: async function* () {
      calls++;
      if (calls === 1)
        yield {
          type: 'error' as const,
          failureClass: 'protocol' as const,
          message: 'context_length_exceeded',
        };
      else {
        yield { type: 'text-delta' as const, text: 'done' };
        yield { type: 'finished' as const, reason: 'stop' as const };
      }
    },
    recover: async () => reduced,
  }))
    events.push(event);
  expect(calls).toBe(2);
  expect(events.map((event) => event.type)).toEqual(['text-delta', 'finished']);
});


it.each(['invalid API key', 'context_length_exceeded'])('does not loop on %s when recovery has no reduction', async message => {
 let calls = 0; const recover = vi.fn(async (request: import('./native-context-maintenance.js').NativeContextRequest) => request);
 const result = [];
 for await (const event of streamWithContextOverflowRecovery({request: {systemPrompt: 'system', messages: [{role: 'user', content: 'unchanged'}]},
  call: async function* () { calls++; yield {type: 'error' as const, failureClass: 'protocol' as const, message}; }, recover })) result.push(event);
 expect(calls).toBe(1); expect(result).toEqual([{type: 'error', failureClass: 'protocol', message}]);
 expect(recover).toHaveBeenCalledTimes(message === 'context_length_exceeded' ? 1 : 0);
});
