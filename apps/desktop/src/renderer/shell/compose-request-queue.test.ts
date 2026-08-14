import { describe, expect, it } from 'vitest';
import {
  composeRequestQueueStorageKey,
  createQueuedComposeRequest,
  enqueueQueuedComposeRequest,
  readQueuedComposeRequests,
  removeQueuedComposeRequest,
  updateQueuedComposeRequest,
  writeQueuedComposeRequests,
  type ComposeRequestQueueStorage,
} from './compose-request-queue.js';

class MemoryStorage implements ComposeRequestQueueStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function queuedRequest(text = '继续完善页面') {
  return createQueuedComposeRequest(
    {
      conversationId: 'conversation-a',
      text,
      attachments: [
        {
          path: 'D:\\project\\reference.png',
          name: 'reference.png',
          kind: 'image',
          previewUrl: 'data:image/png;base64,AAAA',
          mimeType: 'image/png',
        },
      ],
      modelOverride: '',
      reasoningEffort: 'high',
      networkEnabled: true,
      skillVersionIds: ['skill-a'],
      kernelOverride: 'native',
    },
    {
      id: `queue-${text}`,
      createdAt: '2026-08-08T10:00:00.000Z',
    },
  );
}

describe('compose request queue', () => {
  it('keeps FIFO order and freezes the compose configuration snapshot', () => {
    const first = queuedRequest('第一项');
    const second = queuedRequest('第二项');
    const queue = enqueueQueuedComposeRequest(
      enqueueQueuedComposeRequest([], first),
      second,
    );

    expect(queue.map((item) => item.text)).toEqual(['第一项', '第二项']);
    expect(queue[0]).toMatchObject({
      modelOverride: '',
      reasoningEffort: 'high',
      networkEnabled: true,
      skillVersionIds: ['skill-a'],
    });

    first.skillVersionIds.push('later-change');
    first.attachments[0]!.name = 'changed.png';
    expect(queue[0]!.skillVersionIds).toEqual(['skill-a']);
    expect(queue[0]!.attachments[0]!.name).toBe('reference.png');
  });

  it('updates a draft in place and removes it without reordering the rest', () => {
    const first = queuedRequest('第一项');
    const second = queuedRequest('第二项');
    const queue = [first, second];

    const edited = updateQueuedComposeRequest(queue, first.id, { text: '修改后的第一项' });
    expect(edited.map((item) => item.text)).toEqual(['修改后的第一项', '第二项']);
    expect(edited[0]!.id).toBe(first.id);

    const removed = removeQueuedComposeRequest(edited, first.id);
    expect(removed).toEqual([second]);
  });

  it('persists per conversation with a versioned key and ignores malformed data', () => {
    const storage = new MemoryStorage();
    const request = queuedRequest();

    expect(writeQueuedComposeRequests('conversation-a', [request], storage)).toBe(true);
    expect(storage.values.has(composeRequestQueueStorageKey('conversation-a'))).toBe(true);
    expect(readQueuedComposeRequests('conversation-a', storage)).toEqual([request]);
    expect(readQueuedComposeRequests('conversation-b', storage)).toEqual([]);

    storage.values.set(
      composeRequestQueueStorageKey('conversation-a'),
      JSON.stringify({ version: 99, items: [request] }),
    );
    expect(readQueuedComposeRequests('conversation-a', storage)).toEqual([]);
  });

  it('defaults legacy queued entries (no kernelOverride) to the native kernel', () => {
    const storage = new MemoryStorage();
    const legacy = queuedRequest();
    delete (legacy as { kernelOverride?: string }).kernelOverride;
    storage.values.set(
      composeRequestQueueStorageKey('conversation-a'),
      JSON.stringify({ version: 1, items: [legacy] }),
    );

    const restored = readQueuedComposeRequests('conversation-a', storage);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ ...legacy, kernelOverride: 'native' });
  });

  it('treats storage failures as best-effort instead of losing the in-memory queue', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;

    expect(writeQueuedComposeRequests('conversation-a', [queuedRequest()], storage)).toBe(false);
  });
});
