import { useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import type { DeferredContent } from '@sync-think/shared';
import { ConversationContentScope } from './DeferredToolContent.js';
import { MarkdownContent } from './MarkdownContent.js';
import { resolveMessageText } from './message-text-source.js';

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
  const conversationId = props.conversationId ?? inheritedScope;
  const streaming = sourceStreaming ?? props.streaming;
  const hasDeferred = Boolean(parts?.some((part) => part.contentRef));
  const identity = JSON.stringify([
    conversationId,
    parts?.map((part) => [part.text, part.contentRef]),
    props.text,
    streaming,
  ]);
  const [assembled, setAssembled] = useState<string>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (!hasDeferred || streaming || !conversationId || !parts) {
      setAssembled(undefined);
      setError(false);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setError(false);
    void resolveMessageText(parts, props.text, conversationId, controller.signal)
      .then((text) => {
        if (!controller.signal.aborted) setAssembled(text);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof Error && failure.message === 'content.cancelled') return;
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
    // Identity already captures conversation, parts, preview text, and streaming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDeferred, identity, retryTick]);

  const render = (text: string, previewOnly = false) =>
    renderPreview?.(text) ?? (
      <MarkdownContent
        {...props}
        text={text}
        {...(previewOnly ? { interactiveEmbeds: false } : {})}
      />
    );

  if (!hasDeferred) return render(props.text);

  return (
    <div data-testid="deferred-message-text">
      {render(assembled ?? props.text, assembled === undefined)}
      {error ? (
        <p className="shell-deferred-content__notice" role="alert">
          <span>读取失败，预览仍保留。</span>
          <button type="button" disabled={busy} onClick={() => setRetryTick((value) => value + 1)}>
            重试读取
          </button>
        </p>
      ) : null}
    </div>
  );
}
