import { describe, expect, it } from 'vitest';
import type { Event, Message, MessageBlock, MessageId, ThreadId } from '@sync-think/shared';
import {
  backfillMessagesFromEvents,
  readBackfillProgress,
  MESSAGE_STORE_BACKFILL_VERSION,
} from './message-store-backfill.js';

class MemoryMessageStore {
  readonly messages = new Map<string, Message>();

  nextSequence(threadId: ThreadId): number {
    let max = -1;
    for (const message of this.messages.values()) {
      if (message.threadId === threadId) max = Math.max(max, message.sequence);
    }
    return max + 1;
  }

  getMessage(messageId: MessageId): Message | undefined {
    return this.messages.get(messageId);
  }

  createFinalMessage(message: Message): Message {
    if (this.messages.has(message.id)) {
      const existing = this.messages.get(message.id)!;
      if (JSON.stringify(existing) !== JSON.stringify(message)) {
        throw new Error('message.conflict: id reused');
      }
      return existing;
    }
    this.messages.set(message.id, message);
    return message;
  }

  updateBlocks(messageId: MessageId, blocks: readonly MessageBlock[]): Message {
    const existing = this.messages.get(messageId);
    if (!existing) throw new Error(`missing ${messageId}`);
    const next = { ...existing, blocks: [...blocks] };
    this.messages.set(messageId, next);
    return next;
  }
}

function event(partial: Partial<Event> & Pick<Event, 'sequence' | 'type' | 'payload'>): Event {
  return {
    id: `event-${partial.sequence}` as Event['id'],
    workspaceId: 'ws-1' as Event['workspaceId'],
    category: 'message',
    occurredAt: new Date(partial.sequence * 1000).toISOString(),
    ...partial,
  };
}

describe('message-store-backfill', () => {
  it('projects user, assistant, and image attach events in order and is idempotent', () => {
    const store = new MemoryMessageStore();
    const events: Event[] = [
      event({
        sequence: 1,
        type: 'message.appended',
        messageId: 'msg-user-1' as MessageId,
        payload: {
          threadId: 'thread-1',
          role: 'user',
          text: 'hello',
          messageId: 'msg-user-1',
        },
      }),
      event({
        sequence: 2,
        type: 'message.images-attached',
        messageId: 'msg-user-1' as MessageId,
        payload: {
          threadId: 'thread-1',
          messageId: 'msg-user-1',
          images: [
            {
              id: 'img-1',
              name: 'a.png',
              mimeType: 'image/png',
              storageRef: 'a.png',
            },
          ],
        },
      }),
      event({
        sequence: 3,
        type: 'run.completed',
        runId: 'run-1' as Event['runId'],
        payload: {
          threadId: 'thread-1',
          assistantText: 'world',
          modelId: 'model-1',
          idempotencyKey: 'run-1',
        },
      }),
      event({
        sequence: 4,
        type: 'tool.requested',
        payload: { threadId: 'thread-1', toolName: 'read_file' },
      }),
    ];

    const first = backfillMessagesFromEvents(store, events);
    expect(first).toMatchObject({
      version: MESSAGE_STORE_BACKFILL_VERSION,
      fromSequence: 0,
      toSequence: 4,
      writtenMessages: 2,
      updatedMessages: 1,
    });
    expect([...store.messages.values()].map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
    expect(store.getMessage('msg-user-1' as MessageId)?.blocks).toEqual([
      { type: 'text', text: 'hello' },
      {
        type: 'image',
        payload: {
          id: 'img-1',
          name: 'a.png',
          mimeType: 'image/png',
          storageRef: 'a.png',
        },
      },
    ]);
    expect(store.getMessage('asst-run-1' as MessageId)).toMatchObject({
      role: 'assistant',
      sequence: 1,
      runId: 'run-1',
      modelId: 'model-1',
      blocks: [{ type: 'text', text: 'world' }],
    });

    // Re-run with progress cursor → no more writes.
    const second = backfillMessagesFromEvents(store, events, {
      afterSequence: first.lastEventSequence,
    });
    expect(second.processedEvents).toBe(0);
    expect(second.writtenMessages).toBe(0);
    expect(store.messages.size).toBe(2);

    // Full re-run remains idempotent (same ids already present).
    const third = backfillMessagesFromEvents(store, events, { afterSequence: 0 });
    expect(third.writtenMessages).toBe(0);
    expect(third.updatedMessages).toBe(0);
    expect(store.messages.size).toBe(2);
    expect(store.getMessage('msg-user-1' as MessageId)?.blocks).toEqual([
      { type: 'text', text: 'hello' },
      {
        type: 'image',
        payload: {
          id: 'img-1',
          name: 'a.png',
          mimeType: 'image/png',
          storageRef: 'a.png',
        },
      },
    ]);
  });

  it('continues within a duplicate sequence using the event id cursor', () => {
    const store = new MemoryMessageStore();
    const events: Event[] = [
      event({
        id: 'event-a' as Event['id'],
        sequence: 7,
        type: 'message.appended',
        messageId: 'msg-a' as MessageId,
        payload: {
          threadId: 'thread-1',
          role: 'user',
          text: 'first',
          messageId: 'msg-a',
        },
      }),
      event({
        id: 'event-b' as Event['id'],
        sequence: 7,
        type: 'message.appended',
        messageId: 'msg-b' as MessageId,
        payload: {
          threadId: 'thread-1',
          role: 'user',
          text: 'second',
          messageId: 'msg-b',
        },
      }),
    ];

    const result = backfillMessagesFromEvents(store, events, {
      afterSequence: 7,
      afterEventId: 'event-a',
    });

    expect(result).toMatchObject({
      fromSequence: 7,
      toSequence: 7,
      processedEvents: 1,
      writtenMessages: 1,
    });
    expect(store.getMessage('msg-a' as MessageId)).toBeUndefined();
    expect(store.getMessage('msg-b' as MessageId)?.blocks).toEqual([
      { type: 'text', text: 'second' },
    ]);
  });

  it('skips compact markers and empty assistant completions', () => {
    const store = new MemoryMessageStore();
    const result = backfillMessagesFromEvents(store, [
      event({
        sequence: 1,
        type: 'message.appended',
        payload: {
          threadId: 'thread-1',
          role: 'system',
          text: 'compacted',
          messageId: 'msg-compact',
          compact: true,
        },
      }),
      event({
        sequence: 2,
        type: 'run.completed',
        runId: 'run-empty' as Event['runId'],
        payload: { threadId: 'thread-1', assistantText: '   ' },
      }),
    ]);
    expect(result.writtenMessages).toBe(0);
    expect(store.messages.size).toBe(0);
  });

  it('projects paused runs as durable failed assistant summaries and scrubs secrets', () => {
    const store = new MemoryMessageStore();
    const events: Event[] = [
      event({
        sequence: 1,
        type: 'message.appended',
        messageId: 'msg-before-pause' as MessageId,
        payload: {
          threadId: 'thread-1',
          role: 'user',
          text: 'please continue',
          messageId: 'msg-before-pause',
        },
      }),
      event({
        sequence: 2,
        type: 'run.paused',
        runId: 'run-paused' as Event['runId'],
        payload: {
          threadId: 'thread-1',
          reason: 'no_fallback_configured',
          failureClass: 'unknown',
          errorMessage: 'spawn codex.exe ENOENT with sk-abcdefgh1234',
          modelId: 'model-vision',
          providerModelId: 'vision-model',
        },
      }),
    ];

    const first = backfillMessagesFromEvents(store, events);
    expect(first.writtenMessages).toBe(2);
    const paused = store.getMessage('asst-run-paused' as MessageId);
    expect(paused).toMatchObject({
      role: 'assistant',
      runId: 'run-paused',
      modelId: 'model-vision',
      sequence: 1,
      createdAt: events[1]!.occurredAt,
      blocks: [
        {
          type: 'error',
          payload: {
            terminalState: 'failed',
            legacyBackfill: true,
          },
        },
      ],
    });
    const errorMessage = (paused?.blocks[0]?.payload as { errorMessage?: string } | undefined)
      ?.errorMessage;
    expect(errorMessage).toContain('当前模型不可用');
    expect(errorMessage).toContain('spawn codex.exe ENOENT');
    expect(errorMessage).not.toContain('sk-abcdefgh1234');

    const second = backfillMessagesFromEvents(store, events);
    expect(second.writtenMessages).toBe(0);
    expect(store.messages.size).toBe(2);
  });

  it('parses stored progress for resume', () => {
    expect(
      readBackfillProgress({
        version: 1,
        lastEventSequence: 42,
        processedEvents: 10,
        writtenMessages: 3,
        updatedMessages: 1,
        skippedEvents: 6,
        completedAt: '2026-07-27T00:00:00.000Z',
      }),
    ).toEqual({
      version: 1,
      lastEventSequence: 42,
      processedEvents: 10,
      writtenMessages: 3,
      updatedMessages: 1,
      skippedEvents: 6,
      completedAt: '2026-07-27T00:00:00.000Z',
    });
    expect(readBackfillProgress({ lastEventSequence: -1 })).toBeUndefined();
    expect(
      readBackfillProgress({
        lastEventSequence: 7,
        processedEvents: 7,
        writtenMessages: 2,
        updatedMessages: 0,
        skippedEvents: 5,
      })?.version,
    ).toBe(1);
  });
});
