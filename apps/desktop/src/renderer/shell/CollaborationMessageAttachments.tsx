import { useEffect, useState } from 'react';
import type { MessageBlock, CollaborationFileAttachment, CollaborationImageAttachment } from '@sync-think/shared';
import { ComposerAttachments } from './ComposerAttachments.js';
import type { ComposeAttachment } from './compose-mention.js';

type Media = CollaborationFileAttachment & CollaborationImageAttachment;
export function CollaborationMessageAttachments({ blocks, projectFolder }: { blocks: readonly MessageBlock[]; projectFolder?: string }) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const api = window.syncThink?.runtime?.readProjectImage;
    for (const block of blocks) {
      if (block.type !== 'image') continue;
      const path = (block.payload as CollaborationImageAttachment).stagingPath;
      if (!path || !api) continue;
      void api({ root: projectFolder || path.replace(/[\\/][^\\/]+$/, ''), path }).then(({ dataUrl }) => {
        if (active && dataUrl) setPreviews(current => ({ ...current, [path]: dataUrl }));
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [blocks, projectFolder]);
  const attachments: ComposeAttachment[] = blocks.filter(block => block.type === 'image' || block.type === 'file').map(block => {
    const media = block.payload as Media;
    const path = media.stagingPath || media.path || 'image:' + media.id;
    return { ...media, path, kind: block.type === 'image' ? 'image' : media.kind ?? 'file', previewUrl: media.dataUrl || previews[path] };
  });
  return attachments.length ? <div className="collab-message__attachments"><ComposerAttachments attachments={attachments} /></div> : null;
}
