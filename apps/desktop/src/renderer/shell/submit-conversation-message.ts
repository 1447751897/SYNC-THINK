import type {
  AppendMessagePayload,
  AppendMessageResponse,
  ConversationSendMessagePayload,
  ConversationSendMessageResponse,
} from '@sync-think/protocol';
import { buildComposeAppendRequest } from './compose-send-request.js';
import type { MessageImage } from './compose-mention.js';

export interface ConversationSubmissionPort {
  prepare(payload: ConversationSendMessagePayload): Promise<ConversationSendMessageResponse>;
  append(payload: AppendMessagePayload): Promise<AppendMessageResponse>;
}

type FrozenSubmission = Omit<
  Parameters<typeof buildComposeAppendRequest>[0],
  'threadId' | 'taskVersion'
>;

/** Prepare once, then append using that exact thread/version. UI owns optimistic state. */
export async function submitConversationMessage(
  input: FrozenSubmission,
  port: ConversationSubmissionPort,
  onPrepared: (threadId: string) => void,
) {
  const preparation = await port.prepare({
    conversationId: input.conversationId as ConversationSendMessagePayload['conversationId'],
    text: input.text,
  });
  if (typeof preparation.threadId === 'string' && preparation.threadId.length > 0) {
    onPrepared(preparation.threadId);
  }
  const response = await port.append(
    buildComposeAppendRequest({
      ...input,
      threadId: preparation.threadId,
      taskVersion: preparation.taskVersion,
    }),
  );
  const durableImages: MessageImage[] = Array.isArray(response.images)
    ? response.images
        .filter((image) => typeof image.url === 'string' && image.url.length > 0)
        .map((image) => ({
          id: image.id,
          name: image.name,
          mimeType: image.mimeType,
          url: image.url!,
        }))
    : [...input.images];
  return {
    preparation,
    response,
    durableImages,
    imageNotice: imageSubmissionNotice(input.images.length > 0, response.imagesMode),
  };
}

function imageSubmissionNotice(hasImages: boolean, mode: AppendMessageResponse['imagesMode']) {
  if (!hasImages) return undefined;
  switch (mode) {
    case 'materialized':
      return {
        tone: 'info' as const,
        prefix: 'vision-mat',
        text: '当前模型不支持图片输入，附件已保存到工作区；模型会调用 ocr_image 提取文字，并可在已启用视觉 Fallback 时调用 describe_image。',
      };
    case 'described':
      return {
        tone: 'info' as const,
        prefix: 'vision-desc',
        text: '当前模型不支持图片输入，附件已由视觉模型生成文字描述替代。',
      };
    case 'ocr':
      return {
        tone: 'info' as const,
        prefix: 'vision-ocr',
        text: '当前模型不支持图片输入，已由 Windows OCR 自动提取附件文字；OCR 不包含画面中无法识别为文字的内容。',
      };
    case 'failed':
      return {
        tone: 'warning' as const,
        prefix: 'vision-fail',
        text: '图片转写失败，已配置的视觉模型未返回可用描述，原图未发送给当前文本模型。',
      };
    default:
      return undefined;
  }
}
