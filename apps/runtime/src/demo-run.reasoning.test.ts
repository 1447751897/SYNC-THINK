import { describe, expect, it } from 'vitest';
import type { RunId } from '@sync-think/shared';
import {
  appendAssistantTextDelta,
  appendCommentaryTimelineDelta,
  closeCommentaryTimelineSegment,
  createDemoRun,
  parseDemoRuns,
  projectAdapterEvent,
  serializeDemoRun,
  startAssistantTool,
} from './demo-run.js';

function run() {
  return createDemoRun(
    'run-reasoning-timeline' as RunId,
    'thread-reasoning-timeline',
    'test reasoning timeline',
  );
}

describe('DemoRun commentary timeline', () => {
  it('reclassifies provider final text as commentary when a tool follows it', () => {
    const text = appendAssistantTextDelta(
      run(),
      'final_answer',
      '我先检查项目结构。',
      '2026-08-16T10:00:00.000Z',
    );
    const withTool = startAssistantTool(text, {
      toolCallId: 'tool-read',
      name: 'read_file',
      argumentsJson: '{"path":"README.md"}',
      occurredAt: '2026-08-16T10:00:01.000Z',
    });

    expect(withTool.assistantTimeline).toEqual([
      expect.objectContaining({ kind: 'text', phase: 'commentary' }),
      expect.objectContaining({ kind: 'tool', toolCallId: 'tool-read' }),
    ]);
  });

  it('merges consecutive deltas at the same durable boundary', () => {
    const first = appendCommentaryTimelineDelta(run(), {
      textDelta: '先检查',
      occurredAt: '2026-08-08T01:02:03.000Z',
      afterSequence: 10,
    });
    const second = appendCommentaryTimelineDelta(first, {
      textDelta: '工作区。',
      occurredAt: '2026-08-08T01:02:04.000Z',
      afterSequence: 10,
    });

    expect(second.commentarySegments).toEqual([
      {
        id: 'commentary-10-0',
        text: '先检查工作区。',
        startedAt: '2026-08-08T01:02:03.000Z',
        afterSequence: 10,
      },
    ]);
  });

  it('starts a new segment after a durable tool boundary and closes the previous segment', () => {
    const first = appendCommentaryTimelineDelta(run(), {
      textDelta: '先读取文件。',
      occurredAt: '2026-08-08T01:02:03.000Z',
      afterSequence: 10,
    });
    const closed = closeCommentaryTimelineSegment(first, '2026-08-08T01:02:04.000Z');
    const second = appendCommentaryTimelineDelta(closed, {
      textDelta: '读取后继续分析。',
      occurredAt: '2026-08-08T01:02:05.000Z',
      afterSequence: 12,
    });

    expect(second.commentarySegments).toEqual([
      {
        id: 'commentary-10-0',
        text: '先读取文件。',
        startedAt: '2026-08-08T01:02:03.000Z',
        completedAt: '2026-08-08T01:02:04.000Z',
        afterSequence: 10,
      },
      {
        id: 'commentary-12-1',
        text: '读取后继续分析。',
        startedAt: '2026-08-08T01:02:05.000Z',
        afterSequence: 12,
      },
    ]);
  });

  it('restores old checkpoints without timeline segments', () => {
    const legacy = serializeDemoRun(run());
    delete (legacy as { commentarySegments?: unknown }).commentarySegments;

    expect(parseDemoRuns([legacy])[0]?.commentarySegments).toEqual([]);
  });

  it('keeps the checkpoint timeline bounded by segment count and total text size', () => {
    let current = run();
    for (let index = 0; index < 300; index++) {
      current = appendCommentaryTimelineDelta(current, {
        textDelta: `${String(index).padStart(3, '0')}:${'x'.repeat(1_000)}`,
        occurredAt: new Date(Date.UTC(2026, 7, 8, 1, 2, index)).toISOString(),
        afterSequence: index,
      });
    }

    const segments = current.commentarySegments ?? [];
    expect(segments.length).toBeLessThanOrEqual(128);
    expect(segments.reduce((total, segment) => total + segment.text.length, 0)).toBeLessThanOrEqual(
      120_000,
    );
    expect(segments.at(-1)?.text).toContain('299:');
  });

  it('keeps commentary, final answer, and provider reasoning in separate channels', () => {
    const commentary = projectAdapterEvent(run(), {
      type: 'assistant-message-delta',
      phase: 'commentary',
      itemId: 'msg-commentary',
      text: '我先检查工作区。',
    });
    const finalAnswer = projectAdapterEvent(commentary.nextRun!, {
      type: 'assistant-message-delta',
      phase: 'final_answer',
      itemId: 'msg-final',
      text: '检查完成。',
    });
    const reasoning = projectAdapterEvent(finalAnswer.nextRun!, {
      type: 'reasoning-delta',
      text: 'internal summary',
    });

    expect(reasoning.nextRun).toMatchObject({
      commentaryText: '我先检查工作区。',
      assistantText: '检查完成。',
      reasoningText: 'internal summary',
    });
    expect(commentary.type).toBe('message.commentary_delta');
    expect(finalAnswer.type).toBe('message.delta');
    expect(reasoning.type).toBe('message.reasoning_delta');
  });

  it('attaches stable provider request metadata to usage events', () => {
    const usageRun = createDemoRun(
      'run-usage-metadata' as RunId,
      'thread-usage-metadata',
      'test usage metadata',
      {
        modelId: 'model-catalog-id',
        providerModelId: 'gpt-5.6-luna',
        providerId: 'provider-openai',
        useFakeProvider: false,
      },
    );

    const projection = projectAdapterEvent(
      usageRun,
      {
        type: 'usage',
        tokensIn: 120,
        tokensOut: 30,
        totalTokens: 150,
      },
      { requestId: 'chat-request-1' },
    );

    expect(projection).toMatchObject({
      category: 'provider',
      type: 'provider.usage',
      payload: {
        requestId: 'chat-request-1',
        providerId: 'provider-openai',
        providerModelId: 'gpt-5.6-luna',
        purpose: 'normal',
        tokensIn: 120,
        tokensOut: 30,
        totalTokens: 150,
      },
    });
  });
});
