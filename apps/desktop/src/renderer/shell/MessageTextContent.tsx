import { useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import type { MessageTextPart } from './message-text-types.js';
export type { MessageTextPart } from './message-text-types.js';
import { ConversationContentScope } from './DeferredToolContent.js';
import { MarkdownContent } from './MarkdownContent.js';
import { resolveMessageText } from './message-text-source.js';

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
  const [readState, setReadState] = useState<{
    identity: string;
    status: 'loading' | 'loaded' | 'error';
    text?: string;
  }>();
  const [retryTick, setRetryTick] = useState(0);
  // Props can change before effect cleanup. Never render a result from another source,
  // including while the replacement is loading or when that read fails.
  const currentRead = readState?.identity === identity ? readState : undefined;
  const assembled = currentRead?.text;
  const error = currentRead?.status === 'error';
  const busy = currentRead?.status === 'loading';

  useEffect(() => {
    if (!hasDeferred || streaming || !conversationId || !parts) {
      setReadState(undefined);
      return;
    }
    const controller = new AbortController();
    setReadState({ identity, status: 'loading' });
    void resolveMessageText(parts, props.text, conversationId, controller.signal)
      .then((text) => {
        if (!controller.signal.aborted) setReadState({ identity, status: 'loaded', text });
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof Error && failure.message === 'content.cancelled') return;
        setReadState({ identity, status: 'error' });
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
