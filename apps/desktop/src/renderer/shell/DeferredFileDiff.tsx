import { useEffect, useRef, useState } from 'react';
import type { FileChangeItem } from '@sync-think/protocol';
import {
  parseDeferredContent,
  type ConversationId,
  type FileDiffPage,
  type FileDiffSource,
} from '@sync-think/shared';
import { ConversationContentScope, DeferredToolContent } from './DeferredToolContent.js';
import { fileDiffReader } from './file-diff-reader.js';

interface Props {
  item: FileChangeItem;
  conversationId?: string;
  wrapLines?: boolean;
  showWhitespace?: boolean;
}

export function needsDeferredFileDiff(
  item: Pick<
    FileChangeItem,
    'content' | 'previousContent' | 'contentRef' | 'previousContentRef' | 'contentKind'
  >,
): boolean {
  return Boolean(
    item.contentRef ||
    item.previousContentRef ||
    item.contentKind ||
    [item.content, item.previousContent].some(
      (text) => text !== undefined && (text.length > 8192 || text.split('\n', 401).length > 400),
    ),
  );
}

function source(
  text: string | undefined,
  deferred: FileChangeItem['contentRef'],
): FileDiffSource | undefined {
  const content = parseDeferredContent(deferred);
  if (content) return { reference: content.reference };
  return text !== undefined && text.length <= 8192 ? { text } : undefined;
}

function Session({ item, conversationId, wrapLines = true, showWhitespace = false }: Props) {
  const [mode, setMode] = useState<'diff' | 'before' | 'after'>('diff');
  const [page, setPage] = useState<FileDiffPage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'changed' | 'failed'>();
  const [contentOffset, setContentOffset] = useState(0);
  const active = useRef<AbortController>();
  const lastRequest = useRef<{ offset?: number; version?: string }>();
  useEffect(() => () => active.current?.abort(), []);
  const before = source(
    item.previousContent ?? (item.action === 'created' ? '' : undefined),
    item.previousContentRef,
  );
  const after = source(
    item.content ?? (item.action === 'deleted' ? '' : undefined),
    item.contentRef,
  );
  const comparable = Boolean(before && after && !item.previousTruncated && !item.contentKind);
  const load = (offset?: number, version?: string) => {
    if (!comparable || !before || !after || !conversationId || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    lastRequest.current = { offset, version };
    setBusy(true);
    setError(undefined);
    void fileDiffReader
      .read(
        {
          conversationId: conversationId as ConversationId,
          before,
          after,
          ...(offset === undefined ? {} : { offset }),
          ...(version ? { version } : {}),
        },
        controller.signal,
      )
      .then((response) => {
        if (!controller.signal.aborted) setPage(response.diff);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error && failure.message.includes('version-changed')
              ? 'changed'
              : 'failed',
          );
      })
      .finally(() => {
        if (active.current === controller) {
          active.current = undefined;
          setBusy(false);
        }
      });
  };
  const select = (next: typeof mode, offset = 0) => {
    active.current?.abort();
    active.current = undefined;
    setBusy(false);
    setMode(next);
    setContentOffset(offset);
  };
  const selectedReference = mode === 'before' ? item.previousContentRef : item.contentRef;
  const selectedText = mode === 'before' ? item.previousContent : item.content;
  const selectedLabel = mode === 'before' ? '修改前' : item.contentKind ? '替换片段' : '修改后';
  return (
    <ConversationContentScope.Provider value={conversationId}>
      <div className="shell-deferred-file-diff" data-testid="deferred-file-diff">
        <div className="shell-deferred-content__actions" aria-label="文件差异阅读方式">
          <button type="button" aria-pressed={mode === 'diff'} onClick={() => select('diff')}>
            差异
          </button>
          <button
            type="button"
            aria-pressed={mode === 'before'}
            disabled={!before}
            onClick={() => select('before')}
          >
            修改前
          </button>
          <button
            type="button"
            aria-pressed={mode === 'after'}
            disabled={!after}
            onClick={() => select('after')}
          >
            {item.contentKind ? '替换片段' : '修改后'}
          </button>
        </div>
        {!comparable ? (
          <p className="shell-deferred-content__notice">
            {item.contentKind
              ? '只记录了替换片段，未取得完整修改后快照；这里不将片段冒充完整文件差异。'
              : item.previousTruncated
                ? '修改前快照已截短，现有内容可读取，完整文件差异不作推算。'
                : '缺少对应历史快照；已记录的前后内容仍可分别读取。'}
          </p>
        ) : null}
        {mode === 'diff' ? (
          <>
            <div className="shell-deferred-content__actions">
              <button
                type="button"
                disabled={!comparable || !conversationId || busy}
                onClick={() => load()}
              >
                {page ? '重新读取差异' : '读取差异'}
              </button>
              {page ? (
                <>
                  <button
                    type="button"
                    disabled={busy || error === 'changed' || page.offset === 0}
                    onClick={() => load(0, page.version)}
                  >
                    文件开头
                  </button>
                  <button
                    type="button"
                    disabled={busy || error === 'changed' || page.offset === 0}
                    onClick={() => load(Math.max(0, page.offset - 80), page.version)}
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={busy || error === 'changed' || page.nextOffset === undefined}
                    onClick={() => load(page.nextOffset, page.version)}
                  >
                    下一页
                  </button>
                  <span>
                    {page.totalRows ? page.offset + 1 : 0}–{page.offset + page.rows.length} /{' '}
                    {page.totalRows} 行 · +{page.added} / −{page.removed}
                  </span>
                </>
              ) : null}
              {busy ? <span role="status">正在读取差异…</span> : null}
            </div>
            {!conversationId ? (
              <p className="shell-deferred-content__notice">请从原会话重新打开审阅。</p>
            ) : null}
            {error ? (
              <div role="alert" className="shell-deferred-content__notice">
                {error === 'changed'
                  ? '文件快照已更新，保留当前旧页；请重新读取差异。'
                  : '差异读取失败，当前内容保留。'}
                {error === 'failed' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => load(lastRequest.current?.offset, lastRequest.current?.version)}
                  >
                    重试差异
                  </button>
                ) : null}
              </div>
            ) : null}
            {page?.mode === 'replacement' ? (
              <p className="shell-deferred-content__notice">
                复杂变更超过精细比较预算；未匹配区间按整段替换展示，不是最小编辑差异。前后原文仍完整保留。
              </p>
            ) : null}
            {page?.formatChanged ? (
              <p className="shell-deferred-content__notice">
                文本行相同，但换行符或末尾换行发生变化。
              </p>
            ) : null}
            {page && !page.totalRows ? (
              <p className="shell-deferred-content__notice">两侧内容均为空。</p>
            ) : null}
            {page ? (
              <div
                className={
                  'shell-changes-card__diff-lines shell-deferred-file-diff__rows' +
                  (wrapLines ? ' is-wrap' : '')
                }
                aria-label="文件差异分页内容"
                tabIndex={0}
              >
                {page.rows.map((row, index) => (
                  <div
                    key={page.offset + index}
                    className={'shell-changes-card__diff-line is-' + row.kind}
                  >
                    <span className="shell-changes-card__diff-no">{row.oldLine ?? ''}</span>
                    <span className="shell-changes-card__diff-no">{row.newLine ?? ''}</span>
                    <span className="shell-deferred-file-diff__line">
                      <span aria-hidden="true">
                        {row.kind === 'add' ? '+ ' : row.kind === 'del' ? '− ' : '  '}
                      </span>
                      <code>
                        {showWhitespace
                          ? row.text.replace(/\t/g, '⇥').replace(/ /g, '·')
                          : row.text}
                      </code>
                      {row.truncated ? (
                        <button
                          type="button"
                          onClick={() =>
                            select(
                              row.newOffset === undefined ? 'before' : 'after',
                              row.newOffset ?? row.oldOffset ?? 0,
                            )
                          }
                        >
                          本行已缩略 · 读取完整行内容
                        </button>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : selectedReference ? (
          <DeferredToolContent
            deferred={selectedReference}
            label={selectedLabel}
            assemble={false}
            preview={
              mode === 'after'
                ? (item.preview ?? '完整修改后内容按需读取')
                : '完整修改前内容按需读取'
            }
            initialOffset={contentOffset}
            initialVersion={mode === 'before' ? page?.beforeVersion : page?.afterVersion}
          />
        ) : (
          <pre
            className="shell-deferred-content__text"
            tabIndex={0}
            aria-label={selectedLabel + '内容'}
          >
            <code>{selectedText ?? ''}</code>
          </pre>
        )}
      </div>
    </ConversationContentScope.Provider>
  );
}

export function DeferredFileDiff(props: Props) {
  const identity = JSON.stringify([
    props.conversationId,
    props.item.path,
    props.item.toolCallId,
    props.item.contentRef,
    props.item.previousContentRef,
    props.item.content,
    props.item.previousContent,
    props.item.previousTruncated,
    props.item.contentKind,
  ]);
  return <Session key={identity} {...props} />;
}
