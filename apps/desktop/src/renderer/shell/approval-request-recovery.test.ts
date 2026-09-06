/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { prepareApprovalRequestDraft } from './approval-request-recovery.js';
import type { ChatMessage } from './ChatView.js';
function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'original',
    runId: 'source-run',
    role: 'user',
    text: '完整原文',
    timestamp: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}
function image(url = 'sync-think-image://media/original.png') {
  return { id: 'original-image', name: 'original.png', mimeType: 'image/png', url };
}
const originalImage = { dataUrl: 'data:image/png;base64,iVBORw==', mimeType: 'image/png' };
describe('approval original request recovery', () => {
  it('preserves text, images and skills through an exact message/run scoped IPC read', async () => {
    const readImage = vi.fn().mockResolvedValue(originalImage);
    const draft = await prepareApprovalRequestDraft(
      message({ images: [image()], skillVersionIds: ['original-skill'] }),
      'conversation',
      new AbortController().signal,
      readImage,
    );
    expect(draft).toMatchObject({
      text: '完整原文',
      skillVersionIds: ['original-skill'],
      attachments: [
        {
          path: 'image:original-image',
          kind: 'image',
          name: 'original.png',
          previewUrl: originalImage.dataUrl,
        },
      ],
    });
    expect(readImage).toHaveBeenCalledWith({
      conversationId: 'conversation',
      messageId: 'original',
      runId: 'source-run',
      imageId: 'original-image',
    });
  });
  it('does not use image URLs or fetch remote resources while recovering', async () => {
    const readImage = vi.fn().mockResolvedValue(originalImage);
    await prepareApprovalRequestDraft(
      message({ images: [image('https://example.invalid/private.png')] }),
      'conversation',
      new AbortController().signal,
      readImage,
    );
    expect(JSON.stringify(readImage.mock.calls)).not.toContain('https:');
  });
  it('fails rather than silently dropping missing, oversized or inconsistent images', async () => {
    const readImage = vi
      .fn()
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce({
        dataUrl: 'data:image/png;base64,' + 'A'.repeat(700001),
        mimeType: 'image/png',
      })
      .mockResolvedValueOnce({ ...originalImage, mimeType: 'image/jpeg' });
    const original = message({ images: [image()] });
    await expect(
      prepareApprovalRequestDraft(
        original,
        'conversation',
        new AbortController().signal,
        readImage,
      ),
    ).rejects.toThrow('missing');
    await expect(
      prepareApprovalRequestDraft(
        original,
        'conversation',
        new AbortController().signal,
        readImage,
      ),
    ).rejects.toThrow('原图片超过预算或格式无效');
    await expect(
      prepareApprovalRequestDraft(
        original,
        'conversation',
        new AbortController().signal,
        readImage,
      ),
    ).rejects.toThrow('原图片超过预算或格式无效');
    expect(original.text).toBe('完整原文');
  });
  it('rejects an empty, cancelled, over-count or unbound request', async () => {
    await expect(
      prepareApprovalRequestDraft(
        message({ text: '' }),
        'conversation',
        new AbortController().signal,
      ),
    ).rejects.toThrow('原请求没有可恢复的内容');
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareApprovalRequestDraft(message(), 'conversation', controller.signal),
    ).rejects.toThrow('读取已取消');
    await expect(
      prepareApprovalRequestDraft(
        message({ images: Array.from({ length: 9 }, () => image()) }),
        'conversation',
        new AbortController().signal,
      ),
    ).rejects.toThrow('原请求图片数量超过单次发送预算');
    await expect(
      prepareApprovalRequestDraft(
        message({ images: [image()] }),
        'conversation',
        new AbortController().signal,
      ),
    ).rejects.toThrow('图片恢复通道尚未就绪');
  });
});
