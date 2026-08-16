/**
 * @vitest-environment jsdom
 *
 * messageToChat inline-process split: the last non-empty text block is the
 * final answer; every earlier block (reasoning / commentary / intermediate
 * text / tool-call + tool-result) becomes an ordered process item.
 */
import { describe, expect, it } from 'vitest';
import type { Message, MessageBlock } from '@sync-think/shared';
import { messageToChat, type InlineProcessItem } from './ChatView.js';

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
      message([{ type: 'text', text: '过程说明。' }, { type: 'text', text: '最终回答。' }]),
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
});
