import type { ChatMessage } from './ChatView.js';
import type { ComposeAttachment } from './compose-mention.js';
import type {
  ReadApprovalRequestImagePayload,
  ReadApprovalRequestImageResponse,
} from '../../approval-recovery-contract.js';
import { resolveMessageText } from './message-text-source.js';

type ReadImage = (
  payload: ReadApprovalRequestImagePayload,
) => Promise<ReadApprovalRequestImageResponse>;

export async function prepareApprovalRequestDraft(
  message: ChatMessage,
  conversationId: string,
  signal: AbortSignal,
  readImage?: ReadImage,
) {
  if ((message.images?.length ?? 0) > 8) throw new Error('原请求图片数量超过单次发送预算');
  const [text, attachments] = await Promise.all([
    resolveMessageText(message.textParts, message.text, conversationId, signal),
    Promise.all(
      (message.images ?? []).map(async (image) => {
        if (signal.aborted) throw new Error('读取已取消');
        if (!readImage || !message.runId) throw new Error('图片恢复通道尚未就绪');
        const response = await readImage({
          conversationId,
          messageId: message.id,
          runId: message.runId,
          imageId: image.id,
        });
        if (signal.aborted) throw new Error('读取已取消');
        if (
          response.dataUrl.length > 700_000 ||
          !response.dataUrl.startsWith('data:' + response.mimeType + ';base64,') ||
          !/^data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/.test(response.dataUrl)
        )
          throw new Error('原图片超过预算或格式无效');
        return {
          path: image.id.startsWith('image:') ? image.id : 'image:' + image.id,
          name: image.name,
          kind: 'image',
          mimeType: response.mimeType,
          previewUrl: response.dataUrl,
        } satisfies ComposeAttachment;
      }),
    ),
  ]);
  if (signal.aborted) throw new Error('读取已取消');
  if (!text.trim() && attachments.length === 0) throw new Error('原请求没有可恢复的内容');
  return { text, attachments, skillVersionIds: message.skillVersionIds ?? [] };
}
