import { useContext, type ComponentProps, type ReactNode } from 'react';
import type { DeferredContent } from '@sync-think/shared';
import { ConversationContentScope, DeferredToolContent } from './DeferredToolContent.js';
import { MarkdownContent } from './MarkdownContent.js';

export interface MessageTextPart {
  text: string;
  contentRef?: DeferredContent;
}

export function MessageTextContent({
  parts,
  renderPreview,
  sourceStreaming,
  ...props
}: ComponentProps<typeof MarkdownContent> & {
  parts?: readonly MessageTextPart[];
  sourceStreaming?: boolean;
  renderPreview?: (text: string) => ReactNode;
}) {
  const inheritedScope = useContext(ConversationContentScope);
  const render = (text: string, deferred = false) =>
    renderPreview?.(text) ?? (
      <MarkdownContent {...props} text={text} {...(deferred ? { interactiveEmbeds: false } : {})} />
    );
  if (!parts?.some((part) => part.contentRef)) return render(props.text);
  return (
    <ConversationContentScope.Provider value={props.conversationId ?? inheritedScope}>
      {parts.map((part, index) =>
        part.contentRef ? (
          <DeferredToolContent
            key={index}
            deferred={part.contentRef}
            preview={part.text}
            previewContent={render(part.text, true)}
            presentation="prose"
            label="正文"
            streaming={sourceStreaming ?? props.streaming}
            testId="deferred-message-text"
          />
        ) : (
          <div key={index}>{render(part.text)}</div>
        ),
      )}
    </ConversationContentScope.Provider>
  );
}
