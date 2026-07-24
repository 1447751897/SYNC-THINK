import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Maximize2,
  Minus,
  Plus,
  X,
} from 'lucide-react';

interface MarkdownContentProps {
  text: string;
  /** When true, show a trailing caret for streaming replies. */
  streaming?: boolean;
  className?: string;
}

function languageFromClassName(className: string | undefined): string | undefined {
  if (!className) return undefined;
  const match = /language-([a-z0-9_+-]+)/i.exec(className);
  return match?.[1]?.toLowerCase();
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

function CodeBlock({
  language,
  children,
}: {
  language?: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const text = useMemo(() => extractText(children).replace(/\n$/, ''), [children]);
  const lineCount = useMemo(() => Math.max(1, text.split('\n').length), [text]);
  const canExpand = lineCount > 12;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore clipboard failures */
    }
  }, [text]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  const renderBlock = (isFullscreen: boolean) => (
    <div
      className={`shell-md-code ${expanded ? 'is-expanded' : ''} ${isFullscreen ? 'is-fullscreen' : ''}`}
      data-language={language || 'text'}
      style={{ '--shell-code-scale': fontScale } as CSSProperties}
      role={isFullscreen ? 'dialog' : undefined}
      aria-modal={isFullscreen ? true : undefined}
      aria-label={isFullscreen ? `${language || 'text'} 代码预览` : undefined}
    >
      <div className="shell-md-code__bar">
        <span className="shell-md-code__lang">{language || 'text'}</span>
        <div className="shell-md-code__actions">
          {isFullscreen ? (
            <div className="shell-md-code__zoom" aria-label="代码字号">
              <button
                type="button"
                onClick={() => setFontScale((value) => Math.max(0.8, value - 0.1))}
                title="缩小代码"
                aria-label="缩小代码"
              >
                <Minus size={12} />
              </button>
              <span>{Math.round(fontScale * 100)}%</span>
              <button
                type="button"
                onClick={() => setFontScale((value) => Math.min(1.6, value + 0.1))}
                title="放大代码"
                aria-label="放大代码"
              >
                <Plus size={12} />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="shell-md-code__action"
            onClick={() => void handleCopy()}
            title="复制代码"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
          {!isFullscreen ? (
            <button
              type="button"
              className="shell-md-code__action is-icon"
              onClick={() => setFullscreen(true)}
              title="放大查看"
              aria-label="放大查看代码"
            >
              <Maximize2 size={13} />
            </button>
          ) : (
            <button
              type="button"
              className="shell-md-code__action is-icon"
              onClick={() => setFullscreen(false)}
              title="关闭"
              aria-label="关闭代码预览"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
      <pre className="shell-md-code__pre">
        <code className={language ? `hljs language-${language}` : 'hljs'}>{children}</code>
      </pre>
      {canExpand && !isFullscreen ? (
        <button
          type="button"
          className="shell-md-code__expand"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {expanded ? '收起代码' : `展开全部 ${lineCount} 行`}
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      {renderBlock(false)}
      {fullscreen && typeof document !== 'undefined'
        ? createPortal(
            <div className="shell-md-code-lightbox" onClick={() => setFullscreen(false)}>
              <div
                className="shell-md-code-lightbox__panel"
                onClick={(event) => event.stopPropagation()}
              >
                {renderBlock(true)}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * NewMax-aligned message markdown renderer:
 * - GFM (tables, task lists, strikethrough, autolink)
 * - fenced code with language label + copy + expand/fullscreen zoom
 * - syntax highlight via highlight.js tokens (theme in shell.css)
 */
export function MarkdownContent({ text, streaming = false, className }: MarkdownContentProps) {
  return (
    <div className={`shell-md ${className ?? ''}`} data-streaming={streaming ? '1' : '0'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const language = languageFromClassName(className);
            const raw = extractText(children);
            const isBlock = Boolean(language) || raw.includes('\n');
            if (!isBlock) {
              return (
                <code className="shell-md-inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return <CodeBlock language={language}>{children}</CodeBlock>;
          },
          table: ({ children }) => (
            <div className="shell-md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
      {streaming ? <span className="shell-md-cursor" aria-hidden="true" /> : null}
    </div>
  );
}
