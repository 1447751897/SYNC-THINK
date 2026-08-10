import type { Message, MessageId, ThreadId } from '@sync-think/shared';
import { describe, expect, it } from 'vitest';
import { buildProviderMessagesFromDurableMessages } from './context-message-history.js';

function message(
  sequence: number,
  role: Message['role'],
  text: string,
  createdAt: string,
  blocks?: Message['blocks'],
): Message {
  return {
    id: `m-${sequence}` as MessageId,
    threadId: 'thread-1' as ThreadId,
    role,
    sequence,
    createdAt,
    blocks: blocks ?? [{ type: 'text', text }],
  };
}

describe('buildProviderMessagesFromDurableMessages', () => {
  it('keeps only messages after the latest compact boundary and injects the summary separately', () => {
    const result = buildProviderMessagesFromDurableMessages({
      messages: [
        message(0, 'user', 'old question', '2026-07-27T01:00:00.000Z'),
        message(1, 'assistant', 'old answer', '2026-07-27T01:01:00.000Z'),
        message(2, 'system', '上下文已压缩', '2026-07-27T01:02:00.000Z'),
        message(3, 'user', 'recent question', '2026-07-27T01:03:00.000Z'),
      ],
      compact: { summaryText: 'compact summary', compactedAt: '2026-07-27T01:02:00.000Z' },
      currentUserText: 'current question',
    });
    expect(result.compactSummary).toBe('compact summary');
    expect(result.messages).toEqual([
      { role: 'user', content: 'recent question' },
      { role: 'user', content: 'current question' },
    ]);
  });

  it('restores safe historical images after compact and never includes reasoning blocks', () => {
    const result = buildProviderMessagesFromDurableMessages({
      messages: [message(3, 'user', 'look', '2026-07-27T01:03:00.000Z', [
        { type: 'text', text: 'look' },
        { type: 'image', payload: { name: 'x.png', mimeType: 'image/png', storageRef: 'x.png' } },
        { type: 'plan', text: 'hidden reasoning' },
      ])],
      currentUserText: '',
      resolveImageDataUrl: (storageRef) => storageRef === 'x.png' ? 'data:image/png;base64,AAAA' : undefined,
    });
    expect(result.messages).toEqual([{ role: 'user', content: [
      { type: 'text', text: 'look' },
      { type: 'image', imageUrl: 'data:image/png;base64,AAAA' },
    ] }]);
    expect(JSON.stringify(result.messages)).not.toContain('hidden reasoning');
  });

  it('restores assistant commentary segments and final answers with Codex phases', () => {
    const result = buildProviderMessagesFromDurableMessages({
      messages: [
        message(1, 'assistant', '', '2026-07-27T01:00:00.000Z', [
          {
            type: 'commentary',
            text: '聚合文本不应与分段重复。',
            payload: {
              commentarySegments: [
                {
                  id: 'commentary-1',
                  text: '我先检查关键文件。',
                  startedAt: '2026-07-27T01:00:00.000Z',
                  completedAt: '2026-07-27T01:00:01.000Z',
                  afterSequence: 1,
                },
                {
                  id: 'commentary-2',
                  text: '文件结构正常，继续运行测试。',
                  startedAt: '2026-07-27T01:00:02.000Z',
                  completedAt: '2026-07-27T01:00:03.000Z',
                  afterSequence: 2,
                },
              ],
            },
          },
          { type: 'text', text: '测试已经完成。' },
          {
            type: 'reasoning',
            reasoningText: 'Internal diagnostic summary.',
            text: 'Internal diagnostic summary.',
          },
        ]),
        message(2, 'user', '继续', '2026-07-27T01:01:00.000Z'),
      ],
      currentUserText: '',
    });

    expect(result.messages).toEqual([
      { role: 'assistant', phase: 'commentary', content: '我先检查关键文件。' },
      { role: 'assistant', phase: 'commentary', content: '文件结构正常，继续运行测试。' },
      { role: 'assistant', phase: 'final_answer', content: '测试已经完成。' },
      { role: 'user', content: '继续' },
    ]);
    expect(JSON.stringify(result.messages)).not.toContain('聚合文本不应与分段重复');
    expect(JSON.stringify(result.messages)).not.toContain('Internal diagnostic summary');
  });

  it('classifies legacy assistant text as a final answer', () => {
    const result = buildProviderMessagesFromDurableMessages({
      messages: [message(1, 'assistant', '旧版回答', '2026-07-27T01:00:00.000Z')],
      currentUserText: '',
    });

    expect(result.messages).toEqual([
      { role: 'assistant', phase: 'final_answer', content: '旧版回答' },
    ]);
  });

  it('marks cancelled assistant output as an interrupted partial turn before restoring it', () => {
    const result = buildProviderMessagesFromDurableMessages({
      messages: [
        message(1, 'assistant', '', '2026-07-27T01:00:00.000Z', [
          {
            type: 'commentary',
            text: '我先检查当前实现。',
            payload: {
              commentarySegments: [
                {
                  id: 'commentary-cancelled',
                  text: '我先检查当前实现。',
                  startedAt: '2026-07-27T01:00:00.000Z',
                  completedAt: '2026-07-27T01:00:01.000Z',
                  afterSequence: 1,
                },
              ],
            },
          },
          { type: 'text', text: '这里是中止前产生的部分回答。' },
          {
            type: 'error',
            payload: {
              terminalState: 'cancelled',
            },
          },
        ]),
        message(2, 'user', '按我的新要求继续', '2026-07-27T01:01:00.000Z'),
      ],
      currentUserText: '',
    });

    expect(result.messages).toEqual([
      {
        role: 'system',
        content: '[上一轮回答已被用户中止，以下是中止前产生的部分内容]',
      },
      { role: 'assistant', phase: 'commentary', content: '我先检查当前实现。' },
      {
        role: 'assistant',
        phase: 'final_answer',
        content: '这里是中止前产生的部分回答。',
      },
      { role: 'user', content: '按我的新要求继续' },
    ]);
  });

  it('restores tool traces of a cancelled run before the partial output so a continue message can pick up', () => {
    const cancelledMessage = message(1, 'assistant', '', '2026-07-27T01:00:00.000Z', [
      { type: 'text', text: '中止前的部分回答。' },
      {
        type: 'error',
        payload: {
          terminalState: 'cancelled',
        },
      },
    ]);
    const result = buildProviderMessagesFromDurableMessages({
      messages: [
        { ...cancelledMessage, runId: 'run-aborted-1' as Message['runId'] },
        message(2, 'user', '继续任务', '2026-07-27T01:01:00.000Z'),
      ],
      currentUserText: '',
      toolTracesByRunId: new Map([
        [
          'run-aborted-1',
          [
            { toolName: 'search_files', argumentsText: '{ "pattern": "todo" }', resultText: '找到 3 个匹配' },
            { toolName: 'read_file', argumentsText: '{ "path": "a.ts" }', resultText: '文件内容…', failed: true },
          ],
        ],
      ]),
    });

    expect(result.messages).toEqual([
      {
        role: 'system',
        content: '[上一轮回答已被用户中止，以下是中止前产生的部分内容]',
      },
      {
        role: 'assistant',
        phase: 'commentary',
        content: '中断前已执行的工具调用轨迹：\n1. search_files({ "pattern": "todo" }) → 找到 3 个匹配\n2. read_file({ "path": "a.ts" }) → 失败：文件内容…',
      },
      { role: 'assistant', phase: 'final_answer', content: '中止前的部分回答。' },
      { role: 'user', content: '继续任务' },
    ]);
  });

  it('does not inject tool traces when none are provided (backward compatible)', () => {
    const cancelledMessage = message(1, 'assistant', '', '2026-07-27T01:00:00.000Z', [
      { type: 'text', text: '部分回答。' },
      {
        type: 'error',
        payload: {
          terminalState: 'cancelled',
        },
      },
    ]);
    const result = buildProviderMessagesFromDurableMessages({
      messages: [
        { ...cancelledMessage, runId: 'run-aborted-1' as Message['runId'] },
        message(2, 'user', '继续任务', '2026-07-27T01:01:00.000Z'),
      ],
      currentUserText: '',
    });

    expect(result.messages).toEqual([
      {
        role: 'system',
        content: '[上一轮回答已被用户中止，以下是中止前产生的部分内容]',
      },
      { role: 'assistant', phase: 'final_answer', content: '部分回答。' },
      { role: 'user', content: '继续任务' },
    ]);
  });
});
