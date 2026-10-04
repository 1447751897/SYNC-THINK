import type { CollaborationMessage, CollaborationImageAttachment } from '@sync-think/shared';

/** Attachment references are quoted data, not instructions or claims of media transcription. */
export function collaborationMessageContextText(message: CollaborationMessage): string {
  return message.blocks.map(block => {
    if (block.type === 'text') return block.text ?? '';
    const payload = block.payload as { name?: string; path?: string; stagingPath?: string } | undefined;
    if (block.type === 'file' && payload?.path) return '引用文件（用户附件）：' + (payload.name ?? '') + '\n- ' + payload.path;
    if (block.type === 'image' && payload?.name) return '用户图片附件：' + payload.name + (payload.stagingPath ? '\n图片文件：' + payload.stagingPath : '');
    return '';
  }).filter(Boolean).join('\n');
}

export function collaborationMessageImages(messages: readonly CollaborationMessage[]): CollaborationImageAttachment[] {
  const images = messages.flatMap(message => message.blocks.filter(block => block.type === 'image')
    .map(block => block.payload as CollaborationImageAttachment));
  return [...new Map(images.filter(image => image?.name && image.mimeType).map(image => [image.stagingPath ?? image.id ?? image.dataUrl, image])).values()].slice(-8);
}
