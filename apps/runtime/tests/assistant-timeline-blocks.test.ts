import { describe, expect, it, vi } from 'vitest';
import type { AssistantTurnSegment } from '@sync-think/protocol';
import type { Message, MessageBlock, MessageId, RunId, ThreadId } from '@sync-think/shared';
import {
  MAX_MESSAGE_BLOCKS,
  MAX_MESSAGE_BLOCKS_JSON_BYTES,
  MessageStoreError,
  type SqliteMessageStore,
} from '@sync-think/storage';
import {
  appendAssistantStatus,
  completeAssistantTool,
  createDemoRun,
  startAssistantTool,
} from '../src/demo-run.js';
import {
  assistantTextFallbackMessageBlocks,
  assistantTimelineFinalText,
  assistantTimelineToMessageBlocks,
  Runtime,
} from '../src/runtime.js';

describe('ordered assistant timeline persistence', () => {
  it('persists metadata plus compatibility blocks in the original segment order', () => {
    const timeline: AssistantTurnSegment[] = [
      {
        id: 'answer',
        sequence: 4,
        kind: 'text',
        phase: 'final_answer',
        text: '最终回答。',
        status: 'completed',
      },
      {
        id: 'thinking',
        sequence: 0,
        kind: 'thinking',
        text: '先分析',
        status: 'completed',
      },
      {
        id: 'commentary',
        sequence: 1,
        kind: 'text',
        phase: 'commentary',
        text: '我先检查。',
        status: 'completed',
      },
      {
        id: 'tool',
        sequence: 2,
        kind: 'tool',
        toolCallId: 'call-1',
        name: 'read_file',
        argumentsJson: '{"path":"a.txt"}',
        output: 'ok',
        status: 'completed',
      },
      {
        id: 'status',
        sequence: 3,
        kind: 'status',
        statusType: 'retry',
        label: '正在重试',
        detail: 'timeout',
      },
    ];

    const blocks = assistantTimelineToMessageBlocks(timeline);
    expect(blocks.map((block) => block.type)).toEqual([
      'commentary',
      'reasoning',
      'commentary',
      'tool-call',
      'tool-result',
      'text',
    ]);
    expect(blocks[0]?.payload).toEqual({
      assistantTimeline: expect.arrayContaining([
        expect.objectContaining({ id: 'status', kind: 'status', statusType: 'retry' }),
      ]),
    });
    expect(
      (blocks[0]?.payload as { assistantTimeline: AssistantTurnSegment[] }).assistantTimeline.map(
        (segment) => segment.sequence,
      ),
    ).toEqual([0, 1, 2, 3, 4]);
    expect(blocks.filter((block) => block.type === 'text')).toEqual([
      { type: 'text', text: '最终回答。' },
    ]);
    expect(assistantTimelineFinalText(timeline)).toBe('最终回答。');
  });

  it('updates a tool result in place and omits absent optional fields from durable metadata', () => {
    const runId = 'run-timeline' as RunId;
    let run = createDemoRun(runId, 'thread-a', 'fixture');
    run = startAssistantTool(run, {
      toolCallId: 'call-a',
      name: 'read_file',
      occurredAt: '2026-08-16T10:00:00.000Z',
    });
    run = completeAssistantTool(run, {
      toolCallId: 'call-a',
      output: 'ok',
      occurredAt: '2026-08-16T10:00:01.000Z',
    });
    run = appendAssistantStatus(run, {
      statusType: 'compaction',
      label: '内核已压缩上下文',
      occurredAt: '2026-08-16T10:00:02.000Z',
    });

    expect(run.assistantTimeline).toHaveLength(2);
    expect(run.assistantTimeline[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 'call-a',
      output: 'ok',
      status: 'completed',
    });
    expect(run.assistantTimeline[0]).not.toHaveProperty('argumentsJson');
    expect(run.assistantTimeline[1]).toMatchObject({
      kind: 'status',
      statusType: 'compaction',
    });
    expect(run.assistantTimeline[1]).not.toHaveProperty('detail');
  });

  it('bounds large tool timelines while retaining the final answer', () => {
    const timeline: AssistantTurnSegment[] = Array.from({ length: 18 }, (_, index) => ({
      id: `tool-${index}`,
      sequence: index,
      kind: 'tool' as const,
      toolCallId: `call-${index}`,
      name: 'read_file',
      argumentsJson: JSON.stringify({ path: `fixture-${index}.txt` }),
      output: `output-${index}:` + 'x'.repeat(20_000),
      status: 'completed' as const,
    }));
    timeline.push({
      id: 'answer',
      sequence: timeline.length,
      kind: 'text',
      phase: 'final_answer',
      text: '最终回答仍然存在。',
      status: 'completed',
    });

    const blocks = assistantTimelineToMessageBlocks(timeline);

    expect(blocks.length).toBeLessThanOrEqual(MAX_MESSAGE_BLOCKS);
    expect(Buffer.byteLength(JSON.stringify(blocks), 'utf8')).toBeLessThanOrEqual(
      MAX_MESSAGE_BLOCKS_JSON_BYTES,
    );
    expect(
      blocks.some((block) => block.type === 'text' && block.text === '最终回答仍然存在。'),
    ).toBe(true);
    expect(JSON.stringify(blocks)).toContain('content truncated');
  });

  it('removes embedded image data from tool details without dropping the process timeline', () => {
    const timeline: AssistantTurnSegment[] = [
      {
        id: 'commentary',
        sequence: 0,
        kind: 'text',
        phase: 'commentary',
        text: '我先检查应用资源。',
        status: 'completed',
      },
      {
        id: 'tool',
        sequence: 1,
        kind: 'tool',
        toolCallId: 'call-image-source',
        name: 'command_execution',
        argumentsJson: '{"command":"search bundled source"}',
        output: 'const icon = `data:image/png;base64,' + 'A'.repeat(300_000) + '`;',
        status: 'completed',
      },
      {
        id: 'answer',
        sequence: 2,
        kind: 'text',
        phase: 'final_answer',
        text: '检查完成。',
        status: 'completed',
      },
    ];

    const blocks = assistantTimelineToMessageBlocks(timeline);
    const serialized = JSON.stringify(blocks);

    expect(serialized).not.toMatch(/data:image\//i);
    expect(serialized).toContain('embedded image omitted');
    expect(blocks[0]).toMatchObject({
      type: 'commentary',
      payload: {
        assistantTimeline: expect.arrayContaining([
          expect.objectContaining({ kind: 'text', phase: 'commentary' }),
          expect.objectContaining({ kind: 'tool', toolCallId: 'call-image-source' }),
        ]),
      },
    });
    expect(blocks).toContainEqual({ type: 'text', text: '检查完成。' });
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(
      MAX_MESSAGE_BLOCKS_JSON_BYTES,
    );
  });

  it('bounds a text-only fallback without splitting UTF-16 surrogate pairs', () => {
    const blocks = assistantTextFallbackMessageBlocks('回答🙂'.repeat(100_000));

    expect(Buffer.byteLength(JSON.stringify(blocks), 'utf8')).toBeLessThanOrEqual(
      MAX_MESSAGE_BLOCKS_JSON_BYTES,
    );
    expect(blocks[0]?.text).toContain('content truncated');
    expect(blocks[0]?.text).not.toContain('\ud83d\n');
  });

  it('retries an invalid oversized assistant message as final text with the same id', () => {
    const persisted: Message[] = [];
    let attempts = 0;
    const messageStore = {
      nextSequence: () => 7,
      createFinalMessage: (message: Message) => {
        attempts += 1;
        if (attempts === 1) {
          throw new MessageStoreError('message.invalid_input', 'blocks_json exceeds byte limit');
        }
        persisted.push(message);
      },
    } as unknown as SqliteMessageStore;
    const runtime = new Runtime({ installId: 'timeline-fallback-test', messageStore });
    const persistFinalChatMessage = runtime as unknown as {
      persistFinalChatMessage(input: {
        id: MessageId;
        threadId: ThreadId;
        role: 'assistant';
        text: string;
        blocks: MessageBlock[];
      }): void;
    };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    persistFinalChatMessage.persistFinalChatMessage({
      id: 'asst-run-a' as MessageId,
      threadId: 'thread-a' as ThreadId,
      role: 'assistant',
      text: '最终答案',
      blocks: [{ type: 'commentary', text: 'x'.repeat(MAX_MESSAGE_BLOCKS_JSON_BYTES) }],
    });

    expect(attempts).toBe(2);
    expect(persisted).toEqual([
      expect.objectContaining({
        id: 'asst-run-a',
        sequence: 7,
        blocks: [{ type: 'text', text: '最终答案' }],
      }),
    ]);
    warning.mockRestore();
  });
});
