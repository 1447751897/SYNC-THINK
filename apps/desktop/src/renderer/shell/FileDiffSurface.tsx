import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
} from 'react';
import { ArrowDown, WrapText } from 'lucide-react';
import { CodeBlockButton } from './CodeBlockButton.js';
import { CopyTextButton } from './CopyTextButton.js';

/** Be UI File Diff presentation adapted to local snapshots and paged readers. */
export function FileDiffToolbar({
  additions,
  deletions,
  wrap,
  onWrapChange,
  copyText,
  copyLabel = '复制差异',
  children,
}: {
  additions?: number;
  deletions?: number;
  wrap?: boolean;
  onWrapChange?(wrap: boolean): void;
  copyText?: string;
  copyLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="shell-changes-card__diff-toolbar shell-beui-diff__toolbar">
      <span className="shell-beui-diff__caption">文件差异</span>
      {additions !== undefined && deletions !== undefined ? (
        <span className="shell-changes-card__diff-counts" aria-label="变更统计">
          <span className="is-add">+{additions}</span>
          <span className="is-del">−{deletions}</span>
        </span>
      ) : (
        <span className="shell-beui-diff__spacer" />
      )}
      {children}
      {onWrapChange ? (
        <CodeBlockButton
          type="button"
          className="shell-beui-diff__action"
          aria-label="自动换行"
          title={wrap ? '关闭自动换行' : '开启自动换行'}
          aria-pressed={wrap}
          onClick={() => onWrapChange(!wrap)}
        >
          <WrapText size={14} aria-hidden="true" />
        </CodeBlockButton>
      ) : null}
      {copyText !== undefined ? <CopyTextButton text={copyText} label={copyLabel} compact /> : null}
    </div>
  );
}

/** Only real content updates follow. User scrolling always takes precedence. */
export function FileDiffViewport({
  children,
  label = '文件差异内容',
  wrap = true,
  showLineNumbers = true,
  streaming = false,
  revision,
  viewportRef: externalRef,
  onScroll,
  path,
  className = '',
  onRead,
}: {
  children: ReactNode;
  label?: string;
  wrap?: boolean;
  showLineNumbers?: boolean;
  streaming?: boolean;
  revision?: unknown;
  viewportRef?: RefObject<HTMLDivElement>;
  onScroll?: UIEventHandler<HTMLDivElement>;
  path?: string;
  className?: string;
  onRead?(): void;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const viewportRef = externalRef ?? ownRef;
  const followingRef = useRef(true);
  const wasStreaming = useRef(streaming);
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    if ((streaming || wasStreaming.current) && followingRef.current && viewportRef.current) {
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
    }
    wasStreaming.current = streaming;
  }, [revision, streaming, viewportRef]);
  const pause = () => {
    followingRef.current = false;
    setFollowing(false);
    onRead?.();
  };
  return (
    <div className="shell-beui-diff__viewport-shell">
      <div
        ref={viewportRef}
        className={`shell-changes-card__diff-lines shell-beui-diff__viewport${wrap ? ' is-wrap' : ''}${showLineNumbers ? '' : ' is-no-line-numbers'} ${className}`}
        data-path={path}
        role="region"
        aria-label={label}
        tabIndex={0}
        onWheel={(event) => {
          if (event.deltaY < 0) pause();
        }}
        onKeyDown={(event) => {
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause();
        }}
        onScroll={(event) => {
          const view = event.currentTarget;
          const nearBottom = view.scrollHeight - view.scrollTop - view.clientHeight <= 24;
          followingRef.current = nearBottom;
          setFollowing(nearBottom);
          if (!nearBottom) onRead?.();
          onScroll?.(event);
        }}
      >
        {children}
      </div>
      {streaming && !following ? (
        <CodeBlockButton
          type="button"
          className="shell-beui-diff__follow"
          onClick={() => {
            followingRef.current = true;
            setFollowing(true);
            if (viewportRef.current)
              viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
          }}
        >
          <ArrowDown size={12} aria-hidden="true" />
          跟随最新差异
        </CodeBlockButton>
      ) : null}
    </div>
  );
}

export interface DisplayDiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  text: string;
  oldLine?: number;
  newLine?: number;
}

/** Complete, single-hunk patch. No preview truncation or inferred file contents. */
export function formatFilePatch(
  path: string,
  before: string,
  after: string,
  rows: readonly DisplayDiffLine[],
): string {
  if (before === after) return '';
  const lineCount = (text: string) =>
    text === '' ? 0 : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
  const oldCount = lineCount(before),
    newCount = lineCount(after);
  const normalizedPath = path.replace(/\\/g, '/');
  // Quoted Git paths preserve spaces and prevent newlines from creating false patch headers.
  const patchPath = (prefix: string) => JSON.stringify(prefix + normalizedPath);
  const output = [
    `--- ${patchPath('a/')}`,
    `+++ ${patchPath('b/')}`,
    `@@ -${oldCount ? 1 : 0},${oldCount} +${newCount ? 1 : 0},${newCount} @@`,
  ];
  for (const row of rows) {
    const missingOldNewline = row.oldLine === oldCount && before !== '' && !before.endsWith('\n');
    const missingNewNewline = row.newLine === newCount && after !== '' && !after.endsWith('\n');
    if (row.kind === 'ctx' && missingOldNewline !== missingNewNewline) {
      output.push('-' + row.text);
      if (missingOldNewline) output.push('\\ No newline at end of file');
      output.push('+' + row.text);
      if (missingNewNewline) output.push('\\ No newline at end of file');
      continue;
    }
    output.push((row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ') + row.text);
    if (
      (row.kind === 'del' && missingOldNewline) ||
      (row.kind === 'add' && missingNewNewline) ||
      (row.kind === 'ctx' && missingOldNewline && missingNewNewline)
    )
      output.push('\\ No newline at end of file');
  }
  return output.join('\n') + '\n';
}
