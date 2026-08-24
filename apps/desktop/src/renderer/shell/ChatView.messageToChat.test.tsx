/**
 * @vitest-environment jsdom
 *
 * messageToChat inline-process split: the last non-empty text block is the
 * final answer; every earlier block (reasoning / commentary / intermediate
 * text / tool-call + tool-result) becomes an ordered process item.
 */
import { describe, expect, it } from 'vitest';
import type { AssistantTurnSegment } from '@sync-think/protocol';
import type { Message, MessageBlock } from '@sync-think/shared';
import {
  assistantTimelineProcessTiming,
  messageToChat,
  projectTransientAssistantDisplay,
  projectTransientAnswerText,
  type InlineProcessItem,
} from './ChatView.js';

function message(blocks: MessageBlock[]): Message {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    role: 'assistant',
    blocks,
    createdAt: '2026-08-16T10:00:00.000Z',
    sequence: 1,
  } as Message;
}

describe('messageToChat inline process split', () => {
  it('derives settled process timing from durable timeline boundaries', () => {
    const timeline: AssistantTurnSegment[] = [
      {
        id: 'think-1',
        sequence: 0,
        kind: 'thinking',
        text: '检查中',
        status: 'completed',
        startedAt: '2026-08-16T10:00:00.000Z',
        completedAt: '2026-08-16T10:00:01.000Z',
      },
      {
        id: 'answer-1',
        sequence: 1,
        kind: 'text',
        phase: 'final_answer',
        text: '完成。',
        status: 'completed',
        startedAt: '2026-08-16T10:01:07.000Z',
        completedAt: '2026-08-16T10:01:08.000Z',
      },
    ];

    expect(assistantTimelineProcessTiming(timeline, true)).toEqual({
      startedAt: '2026-08-16T10:00:00.000Z',
      completedAt: '2026-08-16T10:01:08.000Z',
    });
    expect(assistantTimelineProcessTiming(timeline, false)).toEqual({
      startedAt: '2026-08-16T10:00:00.000Z',
    });
  });

  it('keeps the unclassified provider suffix provisional instead of putting it in the process flow', () => {
    const timeline: AssistantTurnSegment[] = [
      {
        id: 'think-1',
        sequence: 0,
        kind: 'thinking',
        text: '先分析。',
        status: 'streaming',
      },
      {
        id: 'commentary-1',
        sequence: 1,
        kind: 'text',
        phase: 'commentary',
        text: '我先检查资料。',
        status: 'completed',
      },
    ];

    // NewMax boundary: phase-unknown text is retained for later classification,
    // but only confirmed thinking/commentary/tools may render in 执行过程.
    expect(projectTransientAnswerText('我先检查资料。正在生成最终回答', timeline)).toEqual({
      answerText: undefined,
      pendingText: '正在生成最终回答',
    });
    expect(projectTransientAssistantDisplay('我先检查资料。正在生成最终回答', timeline)).toEqual({
      answerText: undefined,
      pendingText: '正在生成最终回答',
      commentaryText: '我先检查资料。',
      reasoningText: '先分析。',
      processItems: [
        {
          kind: 'reasoning',
          id: 'think-1',
          sequence: 0,
          text: '先分析。',
          status: 'streaming',
        },
        {
          kind: 'commentary',
          id: 'commentary-1',
          sequence: 1,
          text: '我先检查资料。',
          status: 'completed',
        },
      ],
    });
    expect(projectTransientAnswerText('我先检查资料。', timeline)).toEqual({
      answerText: undefined,
      pendingText: '',
    });
  });

  it('keeps a phase-aware final answer without duplicating classified timeline text', () => {
    const timeline: AssistantTurnSegment[] = [
      {
        id: 'commentary-1',
        sequence: 0,
        kind: 'text',
        phase: 'commentary',
        text: '说明。',
        status: 'completed',
      },
      {
        id: 'answer-1',
        sequence: 1,
        kind: 'text',
        phase: 'final_answer',
        text: '答案。',
        status: 'streaming',
      },
    ];

    expect(projectTransientAnswerText('答案。', timeline)).toEqual({
      answerText: '答案。',
      pendingText: '',
    });
  });

  it('splits the last text block as the final answer and keeps earlier blocks as process items', () => {
    const chat = messageToChat(
      message([
        { type: 'reasoning', reasoningText: '先想一下' },
        { type: 'text', text: '我先看一下项目结构。' },
        { type: 'tool-call', payload: { name: 'list_files', argumentsJson: '{}' } },
        { type: 'tool-result', text: '[files]' },
        { type: 'text', text: '这是最终回答。' },
      ]),
    );
    expect(chat.answerText).toBe('这是最终回答。');
    expect(chat.processItems).toEqual([
      { kind: 'reasoning', text: '先想一下' },
      { kind: 'text', text: '我先看一下项目结构。' },
      { kind: 'tool', name: 'list_files', argumentsJson: '{}', result: '[files]' },
    ]);
  });

  it('pairs a tool-call with its immediately following tool-result', () => {
    const chat = messageToChat(
      message([
        { type: 'tool-call', payload: { name: 'read_file', argumentsJson: '{"path":"a.txt"}' } },
        { type: 'tool-result', text: 'a.txt: 1 line' },
      ]),
    );
    const items = chat.processItems ?? [];
    expect(items).toHaveLength(1);
    const item = items[0] as Extract<InlineProcessItem, { kind: 'tool' }>;
    expect(item).toMatchObject({ kind: 'tool', name: 'read_file', result: 'a.txt: 1 line' });
    expect(item.failed).toBeUndefined();
  });

  it('marks a failed tool-result on the paired tool item', () => {
    const chat = messageToChat(
      message([
        { type: 'tool-call', payload: { name: 'run_command', argumentsJson: '{"c":"x"}' } },
        { type: 'tool-result', text: 'boom', payload: { failed: true } },
      ]),
    );
    expect((chat.processItems ?? [])[0]).toMatchObject({ kind: 'tool', failed: true });
  });

  it('keeps a tool-call without a result as pending', () => {
    const chat = messageToChat(
      message([{ type: 'tool-call', payload: { name: 'run_command', argumentsJson: '{}' } }]),
    );
    const item = (chat.processItems ?? [])[0] as Extract<InlineProcessItem, { kind: 'tool' }>;
    expect(item).toMatchObject({ kind: 'tool' });
    expect(item.result).toBeUndefined();
  });

  it('leaves answerText undefined when the message has no text block', () => {
    const chat = messageToChat(
      message([
        { type: 'commentary', text: '已检查完毕。' },
        { type: 'tool-call', payload: { name: 'read_file', argumentsJson: '{}' } },
        { type: 'tool-result', text: 'ok' },
      ]),
    );
    expect(chat.answerText).toBeUndefined();
    // the tool-result pairs into the tool item, so the flow is 2 items
    const items = chat.processItems ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ kind: 'commentary', text: '已检查完毕。' });
    expect(items[1]).toMatchObject({ kind: 'tool', result: 'ok' });
  });

  it('treats a single text block as the answer with no process items', () => {
    const chat = messageToChat(message([{ type: 'text', text: '简单的回答。' }]));
    expect(chat.answerText).toBe('简单的回答。');
    expect(chat.processItems).toEqual([]);
  });

  it('keeps backward-compatible joined text for copy and legacy surfaces', () => {
    const chat = messageToChat(
      message([
        { type: 'text', text: '过程说明。' },
        { type: 'text', text: '最终回答。' },
      ]),
    );
    expect(chat.text).toBe('过程说明。\n最终回答。');
  });

  it('keeps reasoning/commentary/text aggregate fields for the supplementary panel', () => {
    const chat = messageToChat(
      message([
        { type: 'reasoning', reasoningText: '思考' },
        { type: 'commentary', text: '注释' },
        { type: 'text', text: '回答' },
      ]),
    );
    expect(chat.reasoningText).toBe('思考');
    expect(chat.commentaryText).toBe('注释');
    expect(chat.answerText).toBe('回答');
  });
  it('uses the ordered assistant timeline as the source of truth without duplicating compatibility blocks', () => {
    const timeline: AssistantTurnSegment[] = [
      {
        id: 'thinking-a',
        sequence: 0,
        kind: 'thinking',
        text: '先检查项目',
        status: 'completed',
      },
      {
        id: 'commentary-a',
        sequence: 1,
        kind: 'text',
        phase: 'commentary',
        text: '我先读取配置。',
        status: 'completed',
      },
      {
        id: 'tool-a',
        sequence: 2,
        kind: 'tool',
        toolCallId: 'call-a',
        name: 'read_file',
        argumentsJson: '{"path":"config.json"}',
        output: 'ok',
        status: 'completed',
      },
      {
        id: 'status-a',
        sequence: 3,
        kind: 'status',
        statusType: 'retry',
        label: '正在重试当前模型（1/2）',
        detail: 'timeout',
      },
      {
        id: 'thinking-b',
        sequence: 4,
        kind: 'thinking',
        text: '重试后继续',
        status: 'completed',
      },
      {
        id: 'answer-a',
        sequence: 5,
        kind: 'text',
        phase: 'final_answer',
        text: '最终回答。',
        status: 'completed',
      },
    ];
    const chat = messageToChat(
      message([
        { type: 'commentary', payload: { assistantTimeline: timeline } },
        { type: 'reasoning', reasoningText: '先检查项目' },
        { type: 'commentary', text: '我先读取配置。' },
        {
          type: 'tool-call',
          payload: {
            toolCallId: 'call-a',
            name: 'read_file',
            argumentsJson: '{"path":"config.json"}',
          },
        },
        { type: 'tool-result', text: 'ok', payload: { toolCallId: 'call-a' } },
        { type: 'reasoning', reasoningText: '重试后继续' },
        { type: 'text', text: '最终回答。' },
      ]),
    );

    expect(chat.answerText).toBe('最终回答。');
    expect(chat.text).toBe('最终回答。');
    expect(chat.processItems).toEqual([
      expect.objectContaining({
        kind: 'reasoning',
        id: 'thinking-a',
        sequence: 0,
        text: '先检查项目',
      }),
      expect.objectContaining({
        kind: 'commentary',
        id: 'commentary-a',
        sequence: 1,
        text: '我先读取配置。',
      }),
      expect.objectContaining({
        kind: 'tool',
        id: 'tool-a',
        sequence: 2,
        toolCallId: 'call-a',
        result: 'ok',
        status: 'completed',
      }),
      expect.objectContaining({ kind: 'status', id: 'status-a', sequence: 3, statusType: 'retry' }),
      expect.objectContaining({
        kind: 'reasoning',
        id: 'thinking-b',
        sequence: 4,
        text: '重试后继续',
      }),
    ]);
    expect(chat.processItems).toHaveLength(5);
  });

  it('repairs historical final text that is followed by a tool boundary', () => {
    const timeline: AssistantTurnSegment[] = [
      {
        id: 'premature-final',
        sequence: 0,
        kind: 'text',
        phase: 'final_answer',
        text: '我先查看项目结构。',
        status: 'completed',
      },
      {
        id: 'tool-a',
        sequence: 1,
        kind: 'tool',
        toolCallId: 'call-a',
        name: 'read_file',
        status: 'completed',
      },
      {
        id: 'actual-final',
        sequence: 2,
        kind: 'text',
        phase: 'final_answer',
        text: '项目检查完成。',
        status: 'completed',
      },
    ];

    const chat = messageToChat(
      message([{ type: 'commentary', payload: { assistantTimeline: timeline } }]),
    );

    expect(chat.answerText).toBe('项目检查完成。');
    expect(chat.processItems).toEqual([
      expect.objectContaining({ kind: 'commentary', text: '我先查看项目结构。' }),
      expect.objectContaining({ kind: 'tool', toolCallId: 'call-a' }),
    ]);
  });

  it('does not synthesize Think when the ordered timeline has no thinking segment', () => {
    const timeline: AssistantTurnSegment[] = [
      {
        id: 'commentary-a',
        sequence: 0,
        kind: 'text',
        phase: 'commentary',
        text: '正在处理。',
        status: 'completed',
      },
      {
        id: 'answer-a',
        sequence: 1,
        kind: 'text',
        phase: 'final_answer',
        text: '完成。',
        status: 'completed',
      },
    ];
    const chat = messageToChat(
      message([
        { type: 'commentary', payload: { assistantTimeline: timeline } },
        { type: 'text', text: '完成。' },
      ]),
    );

    expect(chat.reasoningText).toBeUndefined();
    expect(chat.processItems).toEqual([
      expect.objectContaining({ kind: 'commentary', text: '正在处理。' }),
    ]);
  });
});
