import type { CollaborationMember, CollaborationSnapshot } from '@sync-think/shared';
import { AgentAvatarView } from './AgentAvatarView.js';
import { MarkdownContent } from './MarkdownContent.js';
import { mentionDisplayText } from './collaboration-mentions.js';

export function CollaborationMessageText({ text, mentions, members, projectFolder, conversationId }: {
  text: string;
  mentions: CollaborationSnapshot['messages'][number]['mentions'];
  members: ReadonlyMap<string, CollaborationMember>;
  projectFolder?: string;
  conversationId: string;
}) {
  const display = mentionDisplayText(text, mentions);
  const inlineReferences = new Map(display.references.map(({ href, mention }) => {
    const member = members.get(mention.memberId);
    const name = member?.name ?? mention.label;
    return [href, <span className="collab-mention-chip" data-member-id={mention.memberId} key={href}><AgentAvatarView name={name} avatar={member?.avatar} size={16} /><span>{name}</span></span>] as const;
  }));
  return <MarkdownContent text={display.text} inlineReferences={inlineReferences} projectFolder={projectFolder} conversationId={conversationId} />;
}
