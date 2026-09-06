import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { readMessageImage } from './message-images.js';
import type { ConversationListMessagesResponse } from '@sync-think/protocol';
import { readApprovalRequestImage } from './approval-request-images.js';
function fixture() {
  const original = {
    id: 'message-a',
    runId: 'run-a',
    threadId: 'thread-a',
    role: 'user',
    sequence: 1,
    createdAt: '2026-09-06T00:00:00.000Z',
    blocks: [{ type: 'image', payload: { id: 'image-a', storageRef: 'image-a.png' } }],
  };
  const listMessages = vi.fn().mockResolvedValue({
    messages: [original],
    hasMore: false,
  } as ConversationListMessagesResponse);
  const readImage = vi
    .fn()
    .mockReturnValue({ data: Buffer.from([137, 80, 78, 71]), mimeType: 'image/png' });
  return {
    payload: {
      conversationId: 'conversation-a',
      messageId: 'message-a',
      runId: 'run-a',
      imageId: 'image-a',
    },
    original,
    listMessages,
    readImage,
  };
}
describe('approval image recovery boundary', () => {
  it('reads only an image owned by the exact original user request and enforces a byte budget', async () => {
    const input = fixture();
    expect(await readApprovalRequestImage(input.payload, input)).toEqual({
      dataUrl: 'data:image/png;base64,iVBORw==',
      mimeType: 'image/png',
    });
    expect(input.listMessages).toHaveBeenCalledWith({
      conversationId: 'conversation-a',
      aroundMessageId: 'message-a',
      limit: 1,
    });
    expect(input.readImage).toHaveBeenCalledWith('image-a.png', 525000);
  });
  it.each(['messageId', 'runId', 'imageId'] as const)(
    'rejects a mismatched %s without touching image storage',
    async (key) => {
      const input = fixture();
      input.payload[key] = 'other';
      await expect(readApprovalRequestImage(input.payload, input)).rejects.toThrow();
      expect(input.readImage).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid identities and non-user messages', async () => {
    const input = fixture();
    await expect(
      readApprovalRequestImage({ ...input.payload, messageId: 'x'.repeat(257) }, input),
    ).rejects.toThrow('Invalid image recovery identity');
    expect(input.listMessages).not.toHaveBeenCalled();
    input.original.role = 'assistant';
    await expect(readApprovalRequestImage(input.payload, input)).rejects.toThrow(
      'not in the original run',
    );
    expect(input.readImage).not.toHaveBeenCalled();
  });
  it('does not emit missing, empty or over-budget image data', async () => {
    const input = fixture();
    input.readImage
      .mockReturnValueOnce(undefined as never)
      .mockReturnValueOnce({ data: Buffer.alloc(0), mimeType: 'image/png' })
      .mockReturnValueOnce({ data: Buffer.alloc(525000), mimeType: 'image/png' });
    for (let attempt = 0; attempt < 3; attempt += 1)
      await expect(readApprovalRequestImage(input.payload, input)).rejects.toThrow();
  });
});

const imageFixtureDirectories: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of imageFixtureDirectories.splice(0)) {
    const target = realpathSync(directory);
    if (
      dirname(target).toLowerCase() !== realpathSync(tmpdir()).toLowerCase() ||
      !basename(target).startsWith('sync-think-approval-image-')
    )
      throw new Error('Unexpected fixture cleanup path');
    rmSync(target, { recursive: true, force: true });
  }
});
it('bounds file reads on the real stored-image path and closes the descriptor on failure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sync-think-approval-image-'));
  imageFixtureDirectories.push(directory);
  vi.stubEnv('SYNC_THINK_CHAT_MESSAGE_IMAGES', directory);
  writeFileSync(join(directory, 'original.png'), Buffer.from([1, 2, 3, 4]));
  expect(readMessageImage('original.png', 4)?.data).toEqual(Buffer.from([1, 2, 3, 4]));
  expect(() => readMessageImage('original.png', 3)).toThrow('read budget');
  expect(readMessageImage('original.png', 4)?.data).toHaveLength(4);
  expect(readMessageImage('../original.png', 4)).toBeUndefined();
});
