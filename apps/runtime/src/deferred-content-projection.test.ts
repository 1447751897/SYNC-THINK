import { describe, expect, it } from 'vitest';
import type { Event, Message, RunId } from '@sync-think/shared';
import type { AssistantTurnSegment } from '@sync-think/protocol';
import { encodeFrame, HEADER_BYTES, MAX_FRAME_BYTES } from '@sync-think/protocol';
import {
  projectEventContent,
  projectMessageContent,
  projectTimelineContent,
} from './deferred-content-projection.js';

const large = '完整结果🙂'.repeat(180000);
describe('deferred tool content display projections', () => {
  it('bounds every recognized argument container and pre-write snapshot without choosing an ignored input source', () => {
    const event = {
      id: 'mixed-input',
      payload: {
        arguments: { content: large },
        args: { content: large },
        argumentsJson: JSON.stringify({ content: large }),
        toolCall: {
          name: 'write_file',
          arguments: { content: large },
          argumentsJson: JSON.stringify({ content: large }),
        },
        previousContent: large,
      },
    } as unknown as Event;
    const projected = projectEventContent(event);
    expect(projected.payload.argumentsRef).toMatchObject({
      reference: { source: 'event', id: 'mixed-input', path: ['arguments'] },
    });
    expect(projected.payload.previousContentRef).toBeTruthy();
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(64000);
  });
  it('attaches full-content references at existing process-summary clipping boundaries', () => {
    const text = projectEventContent({
      id: 'summary',
      payload: { result: 'x'.repeat(1300) },
    } as unknown as Event);
    expect(text.payload.resultRef).toBeTruthy();
    const listing = projectEventContent({
      id: 'listing-short',
      payload: {
        result: JSON.stringify({
          entries: Array.from({ length: 21 }, (_, index) => index + '.ts'),
        }),
      },
    } as unknown as Event);
    expect(listing.payload.resultRef).toBeTruthy();
    expect(listing.payload.resultEntryCount).toBe(21);
  });
  it('bounds deeply nested numeric results as well as long strings', () => {
    let nested: unknown = 123456789;
    for (let depth = 0; depth < 4; depth++) nested = Array.from({ length: 16 }, () => nested);
    const projected = projectEventContent({
      id: 'numeric',
      payload: { result: nested },
    } as unknown as Event);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(32 * 1024);
    expect(projected.payload.resultRef).toBeTruthy();
  });

  it('retains failure flags even after many incidental object fields', () => {
    const result = {
      ...Object.fromEntries(Array.from({ length: 60 }, (_, index) => ['key-' + index, 'metadata'])),
      stdout: large,
      ok: false,
      exitCode: 1,
      error: 'specific failure',
    };
    expect(
      projectEventContent({ id: 'failure', payload: { result } } as unknown as Event).payload
        .result,
    ).toMatchObject({ ok: false, exitCode: 1, error: 'specific failure' });
  });
  it('reuses unchanged content projections while detecting mutable source fields and scope changes', () => {
    const segment = {
      id: 'cache',
      kind: 'tool',
      sequence: 1,
      toolCallId: 'cache',
      name: 'read_file',
      status: 'running',
      output: large,
    } as Extract<AssistantTurnSegment, { kind: 'tool' }>;
    const first = projectTimelineContent([segment], 'run-a' as RunId)[0] as typeof segment;
    segment.status = 'completed';
    const second = projectTimelineContent([segment], 'run-a' as RunId)[0] as typeof segment;
    expect(second.outputRef).toBe(first.outputRef);
    expect(second.status).toBe('completed');
    segment.output = 'changed' + large;
    const changed = projectTimelineContent([segment], 'run-a' as RunId)[0] as typeof segment;
    expect(changed.outputRef).not.toBe(first.outputRef);
    expect(changed.output).toMatch(/^changed/);
    expect(
      (projectTimelineContent([segment], 'run-b' as RunId)[0] as typeof segment).outputRef
        ?.reference,
    ).toHaveProperty('runId', 'run-b');
  });
  it('keeps short multiline output readable and tolerates opaque historical timeline entries', () => {
    const segment = {
      id: 'lines',
      kind: 'tool',
      sequence: 1,
      toolCallId: 'lines',
      name: 'read_file',
      status: 'completed',
      output: 'row\n'.repeat(60),
    } as AssistantTurnSegment;
    expect(projectTimelineContent([segment], 'run-a' as RunId)[0]).toHaveProperty('outputRef');
    const message = {
      id: 'legacy',
      blocks: [{ type: 'text', payload: { assistantTimeline: [null, 5, segment] } }],
    } as unknown as Message;
    expect(() => projectMessageContent(message)).not.toThrow();
  });

  it('retains the true collection size when projecting a long listing', () => {
    const entries = Array.from({ length: 60 }, (_, index) => `src/very-long-file-name-${index}.ts`);
    const event = { id: 'listing', payload: { result: { entries } } } as unknown as Event;
    expect(projectEventContent(event).payload.resultEntryCount).toBe(60);
  });

  it('bounds pathological JSON keys and does not attach a secondary error to the primary result', () => {
    const original = {
      id: 'event-a',
      runId: 'run-a',
      sequence: 1,
      payload: { result: 'primary small result', error: large, output: { [large]: 'value' } },
    } as unknown as Event;
    const projected = projectEventContent(original);
    expect(projected.payload.resultRef).toBeUndefined();
    expect(JSON.stringify(projected).length).toBeLessThan(10000);
  });
  it('keeps large events deliverable with scoped source references, model metadata and failure flags', () => {
    const original = {
      id: 'event-a',
      runId: 'run-a',
      workspaceId: 'workspace-a',
      sequence: 1,
      category: 'tool',
      type: 'tool.completed',
      occurredAt: '2026-09-05T13:00:00Z',
      payload: {
        threadId: 'thread-a',
        toolCallId: 'call-a',
        result: { stdout: large, exitCode: 1, ok: false, error: 'actual error' },
        run: { runId: 'run-a', threadId: 'thread-a', modelId: 'model-a', assistantText: large },
        runStateDelta: { body: large },
      },
    } as unknown as Event;
    const projected = projectEventContent(original);
    expect(projected.payload.run).toMatchObject({
      runId: 'run-a',
      threadId: 'thread-a',
      modelId: 'model-a',
    });
    expect(projected.payload.runStateDelta).toBeUndefined();
    expect(projected.payload.result).toMatchObject({
      exitCode: 1,
      ok: false,
      error: 'actual error',
    });
    expect(projected.payload.resultRef).toMatchObject({
      reference: { source: 'event', id: original.id, path: ['result'] },
      format: 'json',
    });
    expect(
      encodeFrame({
        id: 'stream',
        kind: 'event',
        type: 'runtime.event',
        payload: { event: projected },
      }).length - HEADER_BYTES,
    ).toBeLessThan(MAX_FRAME_BYTES / 8);
    expect((original.payload.result as { stdout: string }).stdout).toBe(large);
  });

  it('preserves valid argument JSON and exact source paths for timeline output and input', () => {
    const argumentsJson = JSON.stringify({ path: 'src/file.ts', content: large });
    const segment: AssistantTurnSegment = {
      id: 'segment-a',
      kind: 'tool',
      sequence: 1,
      toolCallId: 'call-a',
      name: 'write_file',
      argumentsJson,
      output: large,
      status: 'completed',
    };
    const [projected] = projectTimelineContent([segment], 'run-a' as RunId);
    expect(projected.kind).toBe('tool');
    if (projected.kind !== 'tool') throw new Error('Expected tool');
    expect(JSON.parse(projected.argumentsJson!).path).toBe('src/file.ts');
    expect(projected.argumentsRef?.reference).toEqual({
      source: 'timeline',
      runId: 'run-a',
      id: 'segment-a',
      path: ['argumentsJson'],
    });
    expect(projected.outputRef?.reference.path).toEqual(['output']);
    expect(segment.output).toBe(large);
    expect(JSON.stringify(projected).length).toBeLessThan(10000);
  });

  it('projects legacy message tool blocks and embedded timelines without changing normal answer text', () => {
    const original = {
      id: 'message-a',
      threadId: 'thread-a',
      role: 'assistant',
      sequence: 1,
      createdAt: '2026-09-05T13:00:00Z',
      blocks: [
        {
          type: 'tool-call',
          payload: {
            name: 'read_file',
            argumentsJson: JSON.stringify({ path: 'src/a.ts', extra: large }),
          },
        },
        { type: 'tool-result', text: large, payload: { toolCallId: 'call-a' } },
        { type: 'text', text: 'Actual final answer' },
      ],
    } as Message;
    const projected = projectMessageContent(original);
    expect(projected.blocks[1].contentRef?.reference).toEqual({
      source: 'message',
      id: original.id,
      path: ['blocks', 1, 'text'],
    });
    expect(projected.blocks[2]).toEqual(original.blocks[2]);
    expect(JSON.stringify(projected).length).toBeLessThan(10000);
    expect(original.blocks[1].text).toBe(large);
  });
  it('retains an oversized unknown payload as a bounded event with a readable display source', () => {
    const original = {
      id: 'unknown-large',
      workspaceId: 'workspace',
      runId: 'run',
      sequence: 1,
      type: 'tool.completed',
      payload: {
        ...Object.fromEntries(
          Array.from({ length: 80 }, (_, index) => ['extra-' + index, 'metadata']),
        ),
        toolName: 'custom_tool',
        toolCallId: 'call',
        threadId: 'thread',
        kernelId: 'codex',
        result: { ok: false, exitCode: 3 },
        vendorDetail: 'unknown🙂'.repeat(200000),
        previousContent: 'previous'.repeat(200000),
        run: { threadId: 'thread', modelId: 'model', assistantText: 'PRIVATE_RUN_TEXT' },
        runStateDelta: { secret: 'PRIVATE_DELTA' },
      },
    } as unknown as Event;
    const projected = projectEventContent(original);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(64 * 1024);
    expect(projected.payload).toMatchObject({
      toolName: 'custom_tool',
      toolCallId: 'call',
      threadId: 'thread',
      kernelId: 'codex',
      result: { ok: false, exitCode: 3 },
    });
    expect(projected.displayPayloadRef?.reference).toEqual({
      source: 'event-display',
      id: 'unknown-large',
      path: ['payload'],
    });
    expect(JSON.stringify(projected)).not.toContain('PRIVATE_RUN_TEXT');
    expect(JSON.stringify(projected)).not.toContain('PRIVATE_DELTA');
    expect(original.payload.vendorDetail).toHaveLength(1800000);
  });
  it('bounds nested objects whose long sibling keys outlive the value budget', () => {
    let nested: unknown = 'leaf';
    for (let depth = 0; depth < 6; depth++)
      nested = {
        result: nested,
        ...Object.fromEntries(
          Array.from({ length: 31 }, (_, index) => [String(index) + '字'.repeat(126), 'value']),
        ),
      };
    const projected = projectEventContent({
      id: 'nested-keys',
      payload: {
        vendor: nested,
        oversized: 'x'.repeat(1200000),
        toolName: 'custom_tool',
        toolCallId: 'call',
        threadId: 'thread',
      },
    } as unknown as Event);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(64 * 1024);
    expect(projected.payload).toMatchObject({
      toolName: 'custom_tool',
      toolCallId: 'call',
      threadId: 'thread',
    });
    expect(projected.displayPayloadRef).toBeTruthy();
  });
});

it('preserves routing and failure fields when bulk fields precede them in source order', () => {
  const event = {
    id: 'late-routing' as Event['id'],
    workspaceId: 'workspace' as Event['workspaceId'],
    category: 'tool',
    type: 'tool.completed',
    sequence: 1,
    occurredAt: '2026-09-05T00:00:00Z',
    payload: {
      output: 'output'.repeat(3000),
      error: 'error'.repeat(3000),
      status: 'vendor status '.repeat(600),
      result: { error: 'failure'.repeat(3000), ok: false, exitCode: 1 },
      vendor: 'vendor'.repeat(200000),
      threadId: 'thread',
      toolCallId: 'call',
      toolName: 'custom_tool',
    },
  } as Event;
  const projected = projectEventContent(event);
  expect(projected.payload).toMatchObject({
    threadId: 'thread',
    toolCallId: 'call',
    toolName: 'custom_tool',
  });
  expect(projected.payload.result).toMatchObject({ ok: false, exitCode: 1 });
  expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(64 * 1024);
});

it('projects ordinary long prose without changing the stored message source', () => {
  const text = '完整正文🙂'.repeat(12000);
  const message = {
    id: 'prose-message',
    blocks: [
      { type: 'text', text },
      { type: 'reasoning', reasoningText: text },
    ],
  } as unknown as Message;
  const projected = projectMessageContent(message);
  expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(32 * 1024);
  expect(projected.blocks[0]?.contentRef).toMatchObject({
    reference: { source: 'message', id: message.id, path: ['blocks', 0, 'text'] },
    utf16Length: text.length,
  });
  expect(projected.blocks[1]?.contentRef?.reference.path).toEqual(['blocks', 1, 'reasoningText']);
  expect(message.blocks[0]?.text).toBe(text);
});

it('keeps canonical references for long text and thinking through message compatibility compaction', async () => {
  const { assistantTimelineToMessageBlocks } = await import('./runtime.js');
  const text = '完整回答🙂'.repeat(200000);
  const timeline: AssistantTurnSegment[] = [
    { id: 'long-thinking', sequence: 1, kind: 'thinking', text, status: 'completed' },
    {
      id: 'long-answer',
      sequence: 2,
      kind: 'text',
      phase: 'final_answer',
      text,
      status: 'completed',
    },
  ];
  const projected = projectTimelineContent(timeline, 'run-prose' as RunId);
  expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(32 * 1024);
  expect(projected[1]).toMatchObject({
    textRef: {
      reference: { source: 'timeline', runId: 'run-prose', id: 'long-answer', path: ['text'] },
      utf16Length: text.length,
    },
  });
  const blocks = assistantTimelineToMessageBlocks(timeline, 'run-prose' as RunId);
  const message = projectMessageContent({ id: 'compacted-prose', blocks } as unknown as Message);
  const metadata = message.blocks[0]?.payload as { assistantTimeline: AssistantTurnSegment[] };
  expect(metadata.assistantTimeline.find((segment) => segment.id === 'long-answer')).toMatchObject({
    textRef: {
      reference: { source: 'timeline', id: 'long-answer', runId: 'run-prose', path: ['text'] },
      utf16Length: text.length,
    },
  });
  expect(
    message.blocks.find((block) => block.type === 'text')?.contentRef?.reference,
  ).toMatchObject({ source: 'timeline', id: 'long-answer' });
  expect(timeline[1]).toHaveProperty('text', text);
});

it('describes the sanitized canonical prose source rather than an omitted embedded image', async () => {
  const { assistantTimelineToMessageBlocks } = await import('./runtime.js');
  const text = '前文'.repeat(5000) + 'data:image/png;base64,' + 'A'.repeat(200000) + '结尾';
  const expected =
    '前文'.repeat(5000) + '[embedded image omitted from durable process details]' + '结尾';
  const blocks = assistantTimelineToMessageBlocks(
    [
      {
        id: 'sanitized-answer',
        kind: 'text',
        phase: 'final_answer',
        sequence: 1,
        status: 'completed',
        text,
      },
    ],
    'sanitized-run' as RunId,
  );
  const projected = projectMessageContent({
    id: 'sanitized-message',
    blocks,
  } as unknown as Message);
  expect(projected.blocks.find((block) => block.type === 'text')?.contentRef).toMatchObject({
    reference: {
      source: 'timeline',
      runId: 'sanitized-run',
      id: 'sanitized-answer',
      path: ['text'],
    },
    utf16Length: expected.length,
    utf8Bytes: Buffer.byteLength(expected),
  });
  expect(JSON.stringify(blocks)).not.toContain('data:image/');
});
