import { describe, expect, it, vi } from 'vitest';
import type { ConversationSubmissionPort } from './submit-conversation-message.js';
import { submitConversationMessage } from './submit-conversation-message.js';

const input: Parameters<typeof submitConversationMessage>[0] = {
  conversationId: 'conversation',
  text: 'Hello',
  images: [],
  track: 'model',
  targetRef: 'model-a',
  catalogModelIds: ['model-a'],
  modelOverride: '',
  kernelOverride: 'codex',
  reasoningEffort: 'high',
  networkEnabled: true,
  skillVersionIds: ['version-1'],
};
function fixture() {
  const preparation = { threadId: 'thread', taskVersion: 7, conversationTitle: 'Title' } as Awaited<
    ReturnType<ConversationSubmissionPort['prepare']>
  >;
  const response = { messageId: 'message', taskVersion: 8 } as Awaited<
    ReturnType<ConversationSubmissionPort['append']>
  >;
  return {
    preparation,
    response,
    port: {
      prepare: vi.fn().mockResolvedValue(preparation),
      append: vi.fn().mockResolvedValue(response),
    },
  };
}

describe('conversation submission boundary', () => {
  it('prepares before publishing the thread and appends with its exact version and frozen choices', async () => {
    const { port, preparation, response } = fixture();
    const onPrepared = vi.fn(() => expect(port.append).not.toHaveBeenCalled());
    const result = await submitConversationMessage(input, port, onPrepared);
    expect(port.prepare).toHaveBeenCalledWith({ conversationId: 'conversation', text: 'Hello' });
    expect(onPrepared).toHaveBeenCalledWith('thread');
    expect(port.append).toHaveBeenCalledTimes(1);
    expect(port.append).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread',
        expectedTaskVersion: 7,
        modelId: 'model-a',
        kernelId: 'codex',
        skillVersionIds: ['version-1'],
      }),
    );
    expect(result).toMatchObject({ preparation, response, durableImages: [] });
  });
  it('propagates preparation failure without appending or publishing a thread', async () => {
    const { port } = fixture();
    const failure = new Error('prepare failed');
    port.prepare.mockRejectedValue(failure);
    const onPrepared = vi.fn();
    await expect(submitConversationMessage(input, port, onPrepared)).rejects.toBe(failure);
    expect(onPrepared).not.toHaveBeenCalled();
    expect(port.append).not.toHaveBeenCalled();
  });
  it('propagates append failure for the caller to reconcile its optimistic message and draft', async () => {
    const { port } = fixture();
    const failure = new Error('append failed');
    port.append.mockRejectedValue(failure);
    await expect(submitConversationMessage(input, port, vi.fn())).rejects.toBe(failure);
    expect(port.prepare).toHaveBeenCalledTimes(1);
  });
  it.each(['materialized', 'described', 'ocr', 'failed'] as const)(
    'returns durable image URLs and the %s notice without retaining transport data',
    async (imagesMode) => {
      const { port, response } = fixture();
      port.append.mockResolvedValue({
        ...response,
        imagesMode,
        images: [
          {
            id: 'saved',
            name: 'saved.png',
            url: 'attachment://saved',
            storagePath: 'private-path',
          },
          { id: 'missing', name: 'missing.png' },
          { id: 'empty', name: 'empty.png', url: '' },
        ],
      });
      const result = await submitConversationMessage(
        {
          ...input,
          images: [{ id: 'local', name: 'local.png', url: 'data:image/png;base64,AA==' }],
        },
        port,
        vi.fn(),
      );
      expect(result.durableImages).toEqual([
        { id: 'saved', name: 'saved.png', url: 'attachment://saved' },
      ]);
      expect(result.imageNotice?.tone).toBe(imagesMode === 'failed' ? 'warning' : 'info');
      expect(result.imageNotice?.text).toBeTruthy();
      expect((await submitConversationMessage(input, port, vi.fn())).imageNotice).toBeUndefined();
    },
  );
  it('retains local image references when no durable list is returned', async () => {
    const { port } = fixture();
    const images = [{ id: 'local', name: 'local.png', url: 'data:image/png;base64,AA==' }];
    expect(await submitConversationMessage({ ...input, images }, port, vi.fn())).toMatchObject({
      durableImages: images,
      imageNotice: undefined,
    });
  });
});
