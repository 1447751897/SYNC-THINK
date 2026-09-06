import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  parseContentReference,
  type ContentReference,
  type ConversationId,
  type DeferredContent,
} from '@sync-think/shared';
import { CopyTextButton } from './CopyTextButton.js';
import { deferredContentReader } from './deferred-content-reader.js';
import { formatDisplayedToolOutput } from './tool-output-display.js';

export const ConversationContentScope = createContext<string | undefined>(undefined);

const MAX_AUTO_CHUNKS = 256;

interface DeferredToolContentProps {
  deferred: DeferredContent;
  preview: string;
  previewContent?: ReactNode;
  presentation?: 'code' | 'prose';
  /** When false, keep paged “读取完整内容”. File diffs stay on-demand. */
  assemble?: boolean;
  label?: string;
  streaming?: boolean;
  failed?: boolean;
  testId?: string;
  initialOffset?: number;
  initialVersion?: string;
}

function byteLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function ContentSession({
  deferred,
  preview,
  previewContent,
  presentation = 'code',
  assemble,
  streaming,
  label = '输出',
  failed,
  testId,
  conversationId,
  reference,
  initialOffset = 0,
  initialVersion,
}: DeferredToolContentProps & {
  conversationId?: string;
  reference?: ContentReference;
}) {
  const autoAssemble = assemble ?? presentation !== 'prose';
  const [content, setContent] = useState<string>();
  const [history, setHistory] = useState<number[]>([]);
  const [paged, setPaged] = useState<{
    text: string;
    offset: number;
    nextOffset?: number;
    version: string;
    utf8Bytes: number;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'changed' | 'failed'>();
  const active = useRef<AbortController>();
  const lastRequest = useRef<{ offset: number; version?: string; history: number[] }>();
  const assembledFor = useRef<string>();
  useEffect(() => () => active.current?.abort(), []);

  const identity = JSON.stringify([conversationId, reference, deferred.utf8Bytes]);

  const loadPage = (offset: number, version: string | undefined, nextHistory: number[]) => {
    if (!conversationId || !reference || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    lastRequest.current = { offset, version, history: nextHistory };
    setBusy(true);
    setError(undefined);
    void deferredContentReader
      .read(
        {
          conversationId: conversationId as ConversationId,
          reference,
          offset,
          ...(version ? { version } : {}),
        },
        controller.signal,
      )
      .then((response) => {
        if (controller.signal.aborted) return;
        setPaged({
          text: response.content.text,
          offset: response.content.offset,
          nextOffset: response.content.nextOffset,
          version: response.content.version,
          utf8Bytes: response.content.utf8Bytes,
        });
        setHistory(nextHistory);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          failure instanceof Error && failure.message.includes('version-changed')
            ? 'changed'
            : 'failed',
        );
      })
      .finally(() => {
        if (active.current !== controller) return;
        active.current = undefined;
        setBusy(false);
      });
  };

  const loadAssembled = (startOffset = 0, startVersion?: string) => {
    if (!conversationId || !reference || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    lastRequest.current = { offset: startOffset, version: startVersion, history: [] };
    setBusy(true);
    setError(undefined);
    void (async () => {
      let offset = startOffset;
      let version = startVersion;
      const parts: string[] = [];
      let bytes = deferred.utf8Bytes;
      for (let index = 0; index < MAX_AUTO_CHUNKS; index++) {
        const response = await deferredContentReader.read(
          {
            conversationId: conversationId as ConversationId,
            reference,
            offset,
            ...(version ? { version } : {}),
          },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        parts.push(response.content.text);
        bytes = response.content.utf8Bytes;
        if (response.content.nextOffset === undefined) {
          assembledFor.current = identity;
          setContent(parts.join(''));
          setPaged({
            text: parts.join(''),
            offset: 0,
            version: response.content.version,
            utf8Bytes: bytes,
          });
          return;
        }
        offset = response.content.nextOffset;
        version = response.content.version;
      }
      assembledFor.current = identity;
      setContent(parts.join(''));
    })()
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          failure instanceof Error && failure.message.includes('version-changed')
            ? 'changed'
            : 'failed',
        );
      })
      .finally(() => {
        if (active.current !== controller) return;
        active.current = undefined;
        setBusy(false);
      });
  };

  useEffect(() => {
    if (!autoAssemble || streaming || !conversationId || !reference) return;
    if (assembledFor.current === identity || busy || error) return;
    loadAssembled(initialOffset, initialVersion);
    // Identity change remounts this session via key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAssemble, streaming, identity]);

  const returnToPreview = () => {
    active.current?.abort();
    active.current = undefined;
    setContent(undefined);
    setPaged(undefined);
    setHistory([]);
    setError(undefined);
    setBusy(false);
    assembledFor.current = undefined;
  };

  const assembled = autoAssemble ? content : paged?.text;
  const visibleRaw = assembled ?? preview;
  const displayed = autoAssemble && assembled ? formatDisplayedToolOutput(assembled) : undefined;
  const visibleText = displayed?.text ?? visibleRaw;
  const reading = Boolean(assembled || paged);

  return (
    <div
      className={`shell-tool-result shell-deferred-content${failed ? ' is-failed' : ''}`}
      data-testid={testId ?? 'deferred-tool-content'}
      data-mode={reading ? 'content' : 'preview'}
      data-presentation={presentation}
    >
      <div className="shell-tool-result__bar">
        <span>
          <span>
            {autoAssemble
              ? reading
                ? displayed?.truncated
                  ? '输出（已按长度截断展示）'
                  : '输出'
                : '预览'
              : reading
                ? `${presentation === 'prose' ? '原文分段' : '分段阅读'} · 第 ${history.length + 1} 段`
                : '预览'}
          </span>{' '}
          · {byteLabel(paged?.utf8Bytes ?? deferred.utf8Bytes)}
        </span>
        <CopyTextButton
          text={assembled ?? paged?.text ?? preview}
          label={reading ? (autoAssemble ? '复制全文' : '复制本段') : '复制预览'}
        />
      </div>
      {!reading && previewContent ? (
        <div className="shell-deferred-content__preview">{previewContent}</div>
      ) : (
        <pre
          className="shell-deferred-content__text"
          tabIndex={0}
          aria-label={`${label}内容（可滚动）`}
          data-testid="deferred-content-text"
        >
          <code>{visibleText}</code>
        </pre>
      )}
      {displayed?.notice ? (
        <p className="shell-deferred-content__notice" data-testid="deferred-content-truncated">
          {displayed.notice}
        </p>
      ) : null}
      <div className="shell-deferred-content__actions">
        {autoAssemble ? null : reading && paged ? (
          <>
            <button
              type="button"
              disabled={busy || !history.length || error === 'changed'}
              onClick={() => loadPage(history.at(-1)!, paged.version, history.slice(0, -1))}
            >
              上一段
            </button>
            <button
              type="button"
              disabled={busy || paged.nextOffset === undefined || error === 'changed'}
              onClick={() =>
                loadPage(paged.nextOffset!, paged.version, [...history, paged.offset])
              }
            >
              下一段
            </button>
            <button type="button" disabled={busy} onClick={() => loadPage(0, undefined, [])}>
              从头读取
            </button>
            <button type="button" onClick={returnToPreview}>
              返回预览
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={
              busy || !conversationId || !reference || (presentation === 'prose' && streaming)
            }
            onClick={() => loadPage(initialOffset, initialVersion, [])}
          >
            {presentation === 'prose' && streaming ? '生成中，完成后读取完整内容' : '读取完整内容'}
          </button>
        )}
        {busy ? <span role="status">正在读取…</span> : null}
      </div>
      {!conversationId || !reference ? (
        <p className="shell-deferred-content__notice">请在对应会话中重新打开此内容。</p>
      ) : null}
      {error ? (
        <div className="shell-deferred-content__notice" role="alert">
          <span>
            {error === 'changed'
              ? '内容已更新，当前片段保留为旧快照，请从头读取。'
              : '读取失败，预览和当前片段仍保留。'}
          </span>
          {error === 'failed' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (autoAssemble) {
                  loadAssembled(0, undefined);
                  return;
                }
                const request = lastRequest.current;
                if (request) loadPage(request.offset, request.version, request.history);
              }}
            >
              重试读取
            </button>
          ) : null}
          {error === 'changed' && autoAssemble ? (
            <button type="button" disabled={busy} onClick={() => loadAssembled(0, undefined)}>
              从头读取
            </button>
          ) : null}
          {error === 'changed' && !autoAssemble && !paged ? (
            <button type="button" disabled={busy} onClick={() => loadPage(0, undefined, [])}>
              从头读取
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DeferredToolContent(props: DeferredToolContentProps) {
  const conversationId = useContext(ConversationContentScope);
  const reference = parseContentReference(props.deferred.reference);
  const identity = JSON.stringify([
    conversationId,
    reference,
    props.deferred.utf8Bytes,
    props.deferred.utf16Length,
    props.preview,
    props.streaming,
    props.initialOffset,
    props.initialVersion,
    props.presentation,
    props.assemble,
  ]);
  return (
    <ContentSession
      key={identity}
      {...props}
      conversationId={conversationId}
      reference={reference}
    />
  );
}
