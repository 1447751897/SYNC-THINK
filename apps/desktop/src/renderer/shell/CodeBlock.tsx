import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ArrowDown, Check, ChevronDown, FileCode2, LoaderCircle } from 'lucide-react';
import { CopyTextButton } from './CopyTextButton.js';
import { highlightCodeLines, languageFromPath } from './code-highlight.js';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  streaming?: boolean;
  streamingLabel?: string;
  highlightLines?: readonly number[];
  copyLabel?: string;
  collapsible?: boolean;
  maxHeight?: number;
  showStatus?: boolean;
  /** 覆盖顶条左侧的身份区（默认是「文件图标 + 文件名 + 语言名」）。 */
  identity?: ReactNode;
  readingState?: CodeBlockReadingState;
}

export interface CodeBlockReadingState {
  expanded: boolean;
  following: boolean;
  scrollTop: number;
  scrollLeft: number;
}

const PREVIEW_LINE_LIMIT = 2000;
const useReadingLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function CodeBlock({
  code,
  language,
  filename,
  streaming = false,
  streamingLabel = '生成中',
  highlightLines,
  copyLabel,
  collapsible = true,
  maxHeight = 280,
  showStatus = true,
  identity,
  readingState,
}: CodeBlockProps) {
  const deferredCode = useDeferredValue(code);
  const writing = streaming || deferredCode !== code;
  const resolvedLanguage = language || languageFromPath(filename) || 'text';
  const [expanded, setExpanded] = useState(readingState?.expanded ?? false);
  const [following, setFollowing] = useState(readingState?.following ?? true);
  const followingRef = useRef(readingState?.following ?? true);
  const previousWritingRef = useRef(writing);
  const viewportRef = useRef<HTMLDivElement>(null);
  const { lines, totalLines, source } = useMemo(() => {
    const allLines = deferredCode.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    const visible = allLines.slice(0, PREVIEW_LINE_LIMIT);
    return { lines: visible, totalLines: allLines.length, source: visible.join('\n') };
  }, [deferredCode]);
  const highlighted = useMemo(
    () => highlightCodeLines(source, resolvedLanguage),
    [source, resolvedLanguage],
  );
  const focusedLines = useMemo(() => new Set(highlightLines), [highlightLines]);
  const canExpand = collapsible && totalLines > 12;
  const expandLabel =
    totalLines > PREVIEW_LINE_LIMIT
      ? `展开预览 ${PREVIEW_LINE_LIMIT} 行`
      : `展开全部 ${totalLines} 行`;

  useReadingLayoutEffect(() => {
    if (!readingState) return;
    setExpanded(readingState.expanded);
    setFollowing(readingState.following);
    followingRef.current = readingState.following;
    if (viewportRef.current) {
      viewportRef.current.scrollTop = readingState.scrollTop;
      viewportRef.current.scrollLeft = readingState.scrollLeft;
    }
  }, [readingState]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport && (writing || previousWritingRef.current) && followingRef.current) {
      viewport.scrollTop = viewport.scrollHeight;
      if (readingState) readingState.scrollTop = viewport.scrollTop;
    }
    previousWritingRef.current = writing;
  }, [deferredCode, writing, readingState]);

  const pauseFollowing = () => {
    followingRef.current = false;
    if (readingState) readingState.following = false;
    setFollowing(false);
  };

  const toggleExpanded = () => {
    if (readingState) readingState.expanded = !expanded;
    setExpanded(!expanded);
  };

  return (
    <div
      className={`shell-md-code${canExpand ? ' is-expandable' : ''} ${expanded ? 'is-expanded' : 'is-collapsed'} shell-agent-code`}
      data-language={resolvedLanguage}
      data-writing={writing ? 'true' : 'false'}
    >
      <div className="shell-md-code__bar">
        {identity ?? (
          <div className="shell-agent-code__identity">
            <FileCode2 size={14} aria-hidden="true" />
            {filename ? (
              <span className="shell-agent-code__filename" title={filename}>
                {filename}
              </span>
            ) : null}
            <span className="shell-md-code__lang">{resolvedLanguage}</span>
          </div>
        )}
        <div className="shell-md-code__actions">
          {showStatus ? (
            <span className="shell-agent-code__status" role="status">
              {writing ? (
                <LoaderCircle size={12} className="shell-agent-code__spinner" aria-hidden="true" />
              ) : (
                <Check size={12} aria-hidden="true" />
              )}
              {writing ? streamingLabel : '已完成'}
            </span>
          ) : null}
          <CopyTextButton text={code} label={copyLabel} />
          {canExpand ? (
            <button
              type="button"
              className="shell-md-code__action shell-md-code__collapse"
              onClick={toggleExpanded}
              aria-expanded={expanded}
              aria-label={expanded ? '收起代码' : `${expandLabel}代码`}
            >
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="shell-agent-code__body">
        <div
          ref={viewportRef}
          className="shell-md-code__viewport shell-agent-code__viewport"
          data-code-viewport
          tabIndex={0}
          role="region"
          aria-label={filename ? `${filename}代码` : '代码内容'}
          style={{ maxHeight: expanded ? Math.max(480, maxHeight) : maxHeight }}
          onScroll={(event) => {
            const viewport = event.currentTarget;
            const nearBottom =
              viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24;
            followingRef.current = nearBottom;
            if (readingState) {
              readingState.following = nearBottom;
              readingState.scrollTop = viewport.scrollTop;
              readingState.scrollLeft = viewport.scrollLeft;
            }
            setFollowing(nearBottom);
          }}
          onWheel={(event) => {
            if (event.deltaY < 0) pauseFollowing();
          }}
          onKeyDown={(event) => {
            if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pauseFollowing();
          }}
        >
          <pre className="shell-agent-code__source">
            <code className={`hljs language-${resolvedLanguage}`}>
              {lines.map((line, index) => (
                <span
                  className="shell-agent-code__line"
                  data-code-line={index + 1}
                  data-highlighted={focusedLines.has(index + 1) ? 'true' : undefined}
                  key={index}
                >
                  <span className="shell-agent-code__number" aria-hidden="true">
                    {index + 1}
                  </span>
                  {highlighted ? (
                    <span
                      className="shell-agent-code__text"
                      dangerouslySetInnerHTML={{ __html: highlighted[index] || ' ' }}
                    />
                  ) : (
                    <span className="shell-agent-code__text">{line || ' '}</span>
                  )}
                  {'\n'}
                </span>
              ))}
            </code>
          </pre>
        </div>
        {!following ? (
          <button
            type="button"
            className="shell-agent-code__follow"
            onClick={() => {
              followingRef.current = true;
              if (readingState) readingState.following = true;
              setFollowing(true);
              if (viewportRef.current) {
                viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
                if (readingState) readingState.scrollTop = viewportRef.current.scrollTop;
              }
            }}
            aria-label="回到代码末尾"
          >
            <ArrowDown size={12} aria-hidden="true" />
            回到末尾
          </button>
        ) : null}
      </div>
      {totalLines > PREVIEW_LINE_LIMIT ? (
        <div className="shell-agent-code__limit">
          仅预览前 {PREVIEW_LINE_LIMIT} 行；复制可获取完整内容。
        </div>
      ) : null}
      {canExpand ? (
        <button
          type="button"
          className="shell-md-code__expand"
          onClick={toggleExpanded}
          aria-expanded={expanded}
        >
          <ChevronDown size={13} aria-hidden="true" />
          {expanded ? '收起代码' : expandLabel}
        </button>
      ) : null}
    </div>
  );
}
