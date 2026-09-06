import type {
  ConversationListMessagesPayload,
  ConversationListMessagesResponse,
} from '@sync-think/protocol';
import type {
  ReadApprovalRequestImagePayload,
  ReadApprovalRequestImageResponse,
} from '../approval-recovery-contract.js';

export async function readApprovalRequestImage(
  value: unknown,
  dependencies: {
    listMessages(
      payload: ConversationListMessagesPayload,
    ): Promise<ConversationListMessagesResponse>;
    readImage(storageRef: string, maxBytes: number): { data: Buffer; mimeType: string } | undefined;
  },
): Promise<ReadApprovalRequestImageResponse> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid image recovery payload');
  const payload = value as ReadApprovalRequestImagePayload;
  for (const key of ['conversationId', 'messageId', 'runId', 'imageId'] as const) {
    if (typeof payload[key] !== 'string' || !payload[key].trim() || payload[key].length > 256)
      throw new Error('Invalid image recovery identity');
  }
  const page = await dependencies.listMessages({
    conversationId: payload.conversationId as ConversationListMessagesPayload['conversationId'],
    aroundMessageId: payload.messageId as ConversationListMessagesPayload['aroundMessageId'],
    limit: 1,
  });
  const message = page.messages.find((item) => item.id === payload.messageId);
  if (!message || message.role !== 'user' || message.runId !== payload.runId)
    throw new Error('Image recovery request is not in the original run');
  const image = message.blocks.find((block) => {
    if (block.type !== 'image' || !block.payload || typeof block.payload !== 'object') return false;
    const data = block.payload as Record<string, unknown>;
    return (data.id ?? data.storageRef) === payload.imageId;
  });
  const stored = image?.payload as Record<string, unknown> | undefined;
  if (typeof stored?.storageRef !== 'string') throw new Error('Original message image not found');
  const result = dependencies.readImage(stored.storageRef, 525_000);
  if (!result || result.data.length === 0 || !/^image\/[A-Za-z0-9.+-]+$/.test(result.mimeType))
    throw new Error('Original image is unavailable');
  const dataUrl = 'data:' + result.mimeType + ';base64,' + result.data.toString('base64');
  if (dataUrl.length > 700_000) throw new Error('Original image exceeds the send budget');
  return { dataUrl, mimeType: result.mimeType };
}
