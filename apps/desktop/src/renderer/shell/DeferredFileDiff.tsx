import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileChangeItem } from '@sync-think/protocol';
import {
  parseDeferredContent,
  type ConversationId,
  type FileDiffPage,
  type FileDiffRow,
  type FileDiffSource,
} from '@sync-think/shared';
import { deferredContentReader } from './deferred-content-reader.js';
import { fileDiffReader } from './file-diff-reader.js';
import { WordSegments, wordHighlightMap } from './word-diff.js';

interface Props {
  item: FileChangeItem;
  conversationId?: string;
  wrapLines?: boolean;
  showWhitespace?: boolean;
  /** NewMax "单词级差异": highlight the changed tokens inside paired lines. */
  wordLevel?: boolean;
  /** Line-number gutter. NewMax omits it; SYNC-THINK keeps it as an option. */
  showLineNumbers?: boolean;
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

/** Rows accumulated across every page fetched so far. */
interface LoadedDiff {
  rows: FileDiffRow[];
  nextOffset?: number;
  totalRows: number;
  added: number;
  removed: number;
  version: string;
  beforeVersion?: string;
  afterVersion?: string;
  mode: 'exact' | 'replacement';
  formatChanged: boolean;
}

function fromPage(page: FileDiffPage): LoadedDiff {
  return {
    rows: page.rows,
    nextOffset: page.nextOffset,
    totalRows: page.totalRows,
    added: page.added,
    removed: page.removed,
    version: page.version,
    beforeVersion: page.beforeVersion,
    afterVersion: page.afterVersion,
    mode: page.mode,
    formatChanged: page.formatChanged,
  };
}

function appendPage(previous: LoadedDiff, page: FileDiffPage): LoadedDiff {
  return {
    ...fromPage(page),
    rows: [...previous.rows, ...page.rows],
  };
}

/** Distance from the bottom at which the next page is fetched. */
const CONTINUE_THRESHOLD_PX = 160;

function decorateWhitespace(text: string): string {
  return text.replace(/\t/g, '⇥').replace(/ /g, '·');
}

function Session({
  item,
  conversationId,
  wrapLines = true,
  showWhitespace = false,
  wordLevel = false,
  showLineNumbers = true,
}: Props) {
  const [loaded, setLoaded] = useState<LoadedDiff>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'changed' | 'failed'>();
  const [expandedRow, setExpandedRow] = useState<{ key: string; text: string }>();
  const [rowError, setRowError] = useState<string>();
  const active = useRef<AbortController>();
  const lastRequest = useRef<{ offset?: number; version?: string }>();
  const rowsRef = useRef<HTMLDivElement>(null);
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

  const load = (offset?: number, version?: string, append = false) => {
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
        if (controller.signal.aborted) return;
        setLoaded((previous) =>
          append && previous ? appendPage(previous, response.diff) : fromPage(response.diff),
        );
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
        if (active.current === controller) {
          active.current = undefined;
          setBusy(false);
        }
      });
  };

  // NewMax renders the diff immediately; there is no "读取差异" gate.
  useEffect(() => {
    load();
    // The session remounts (keyed) whenever the scope or snapshot changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scrolling to the bottom continues reading instead of paging by hand.
  const continueReading = () => {
    const container = rowsRef.current;
    if (!container || !loaded || loaded.nextOffset === undefined || busy) return;
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remaining > CONTINUE_THRESHOLD_PX) return;
    load(loaded.nextOffset, loaded.version, true);
  };

  const readFullRow = (key: string, row: FileDiffRow) => {
    const deferred = row.kind === 'del' ? item.previousContentRef : item.contentRef;
    const reference = parseDeferredContent(deferred);
    const offset = row.kind === 'del' ? row.oldOffset : row.newOffset;
    // The snapshot version, not the diff version: the reader validates against
    // the content it serves.
    const version = row.kind === 'del' ? loaded?.beforeVersion : loaded?.afterVersion;
    if (!reference || offset === undefined || !conversationId) return;
    setRowError(undefined);
    setExpandedRow(undefined);
    const controller = new AbortController();
    void deferredContentReader
      .read(
        {
          conversationId: conversationId as ConversationId,
          reference: reference.reference,
          offset,
          ...(version ? { version } : {}),
        },
        controller.signal,
      )
      .then((response) => {
        if (!controller.signal.aborted)
          setExpandedRow({ key, text: response.content.text });
      })
      .catch(() => {
        if (!controller.signal.aborted) setRowError('这一行的完整内容读取失败。');
      });
  };

  const wordHighlights = useMemo(
    () => (wordLevel && loaded ? wordHighlightMap(loaded.rows) : undefined),
    [wordLevel, loaded],
  );

  const notice = item.contentKind
    ? '只记录了替换片段，未取得完整修改后快照；这里不将片段冒充完整文件差异。'
    : item.previousTruncated
      ? '修改前快照已截短，现有内容可读取，完整文件差异不作推算。'
      : '缺少对应历史快照；已记录的前后内容仍可分别读取。';

  return (
    <div className="shell-deferred-file-diff" data-testid="deferred-file-diff">
      {!comparable ? (
        <>
          <p className="shell-deferred-content__notice">{notice}</p>
          {item.content !== undefined ? (
            <pre className="shell-deferred-content__text" tabIndex={0} aria-label="修改后内容">
              <code>{item.content}</code>
            </pre>
          ) : null}
        </>
      ) : (
        <>
          {!conversationId ? (
            <p className="shell-deferred-content__notice">请从原会话重新打开审阅。</p>
          ) : null}
          {error ? (
            <div role="alert" className="shell-deferred-content__notice">
              {error === 'changed'
                ? '文件快照已更新，保留当前旧页；请重新读取差异。'
                : '差异读取失败，当前内容保留。'}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  error === 'changed'
                    ? load(undefined, undefined, false)
                    : load(lastRequest.current?.offset, lastRequest.current?.version, Boolean(loaded))
                }
              >
                {error === 'changed' ? '重新读取差异' : '重试差异'}
              </button>
            </div>
          ) : null}
          {loaded?.mode === 'replacement' ? (
            <p className="shell-deferred-content__notice">
              复杂变更超过精细比较预算；未匹配区间按整段替换展示，不是最小编辑差异。前后原文仍完整保留。
            </p>
          ) : null}
          {loaded?.formatChanged ? (
            <p className="shell-deferred-content__notice">
              文本行相同，但换行符或末尾换行发生变化。
            </p>
          ) : null}
          {loaded && !loaded.totalRows ? (
            <p className="shell-deferred-content__notice">两侧内容均为空。</p>
          ) : null}
          {rowError ? (
            <p role="alert" className="shell-deferred-content__notice">
              {rowError}
            </p>
          ) : null}
          {loaded ? (
            <div
              ref={rowsRef}
              className={
                'shell-changes-card__diff-lines shell-deferred-file-diff__rows' +
                (wrapLines ? ' is-wrap' : '') +
                (showLineNumbers ? '' : ' is-no-line-numbers')
              }
              aria-label="文件差异内容"
              tabIndex={0}
              onScroll={continueReading}
            >
              {loaded.rows.map((row, index) => {
                const key = String(index);
                const segments = wordHighlights?.get(index);
                return (
                  <div
                    key={key}
                    className={'shell-changes-card__diff-line is-' + row.kind}
                    data-kind={row.kind}
                  >
                    {showLineNumbers ? (
                      <>
                        <span
                          className="shell-changes-card__diff-no"
                          data-old-line
                          aria-hidden="true"
                        >
                          {row.oldLine ?? ''}
                        </span>
                        <span
                          className="shell-changes-card__diff-no"
                          data-new-line
                          aria-hidden="true"
                        >
                          {row.newLine ?? ''}
                        </span>
                      </>
                    ) : null}
                    <span className="shell-diff-prefix" aria-hidden="true">
                      {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                    </span>
                    <code className="shell-changes-card__diff-text">
                      {segments ? (
                        <WordSegments segments={segments} />
                      ) : showWhitespace ? (
                        decorateWhitespace(row.text || ' ')
                      ) : (
                        row.text || ' '
                      )}
                    </code>
                    {row.truncated ? (
                      <button
                        type="button"
                        className="shell-deferred-file-diff__read-row"
                        onClick={() => readFullRow(key, row)}
                      >
                        本行已缩略 · 读取完整行内容
                      </button>
                    ) : null}
                    {expandedRow?.key === key ? (
                      <pre className="shell-deferred-file-diff__row-text">
                        <code>{expandedRow.text}</code>
                      </pre>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {busy ? (
            <span role="status" className="shell-deferred-file-diff__status">
              正在读取差异…
            </span>
          ) : null}
        </>
      )}
    </div>
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
