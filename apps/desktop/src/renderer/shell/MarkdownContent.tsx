import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  Check,
  ChevronDown,
  Copy,
} from 'lucide-react';

interface MarkdownContentProps {
  text: string;
  /** When true, show a trailing caret for streaming replies. */
  streaming?: boolean;
  className?: string;
}

interface MarkdownSection {
  title?: string;
  body: string;
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

/** Split level-two markdown sections without treating headings inside fenced code as UI. */
function splitMarkdownSections(text: string): MarkdownSection[] {
  const lines = text.split('\n');
  const sections: MarkdownSection[] = [];
  let title: string | undefined;
  let body: string[] = [];
  let fence: '```' | '~~~' | undefined;

  const flush = () => {
    if (title !== undefined || body.length > 0) {
      sections.push({ title, body: body.join('\n') });
    }
    body = [];
  };

  for (const line of lines) {
    const fenceMatch = /^\s{0,3}(```|~~~)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] as '```' | '~~~';
      if (!fence) fence = marker;
      else if (fence === marker) fence = undefined;
      body.push(line);
      continue;
    }

    const heading = !fence ? /^##(?!#)\s+(.+?)\s*$/.exec(line) : null;
    if (heading) {
      flush();
      title = heading[1];
      continue;
    }
    body.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ body: text }];
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

  return (
    <div
      className={`shell-md-code ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-language={language || 'text'}
    >
      <div className="shell-md-code__bar">
        <span className="shell-md-code__lang">{language || 'text'}</span>
        <div className="shell-md-code__actions">
          <button
            type="button"
            className="shell-md-code__action"
            onClick={() => void handleCopy()}
            title="复制代码"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? '已复制' : '复制'}</span>
          </button>
          {canExpand ? (
            <button
              type="button"
              className="shell-md-code__action shell-md-code__collapse"
              onClick={() => setExpanded((value) => !value)}
              title={expanded ? '收起代码' : '展开代码'}
              aria-label={expanded ? '收起代码' : `展开全部 ${lineCount} 行代码`}
              aria-expanded={expanded}
            >
              <ChevronDown size={13} aria-hidden="true" />
              <span>{expanded ? '收起' : '展开'}</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="shell-md-code__viewport">
        <pre className="shell-md-code__pre">
          <code className={language ? `hljs language-${language}` : 'hljs'}>{children}</code>
        </pre>
        {canExpand && !expanded ? (
          <div className="shell-md-code__fade" aria-hidden="true" />
        ) : null}
      </div>
      {canExpand ? (
        <button
          type="button"
          className="shell-md-code__expand"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <ChevronDown size={13} aria-hidden="true" />
          <span>{expanded ? '收起代码' : `展开全部 ${lineCount} 行`}</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * react-markdown 默认丢弃未知协议；放行 sync-think-image:（AI browser_screenshot
 * 产物走本地保护协议，CSP img-src 已允许），其余仍走默认清洗。
 */
function markdownUrlTransform(url: string): string {
  if (url.startsWith('sync-think-image://')) return url;
  return defaultUrlTransform(url);
}

function MarkdownRenderer({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      urlTransform={markdownUrlTransform}
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
  );
}

function CollapsibleSection({ title, body }: { title: string; body: string }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section className={`shell-md-section ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <h2 className="shell-md-section__heading">
        <button
          type="button"
          className="shell-md-section__toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span>{title}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </h2>
      <div className="shell-md-section__body" aria-hidden={!expanded}>
        <div className="shell-md-section__body-inner">
          <MarkdownRenderer text={body} />
        </div>
      </div>
    </section>
  );
}

/**
 * NewMax-aligned message markdown renderer:
 * - GFM (tables, task lists, strikethrough, autolink)
 * - level-two sections collapse inline with a compact animated heading
 * - fenced code with language label + copy + inline expand/collapse
 * - syntax highlight via highlight.js tokens (theme in shell.css)
 */
export function MarkdownContent({ text, streaming = false, className }: MarkdownContentProps) {
  const sections = useMemo(() => splitMarkdownSections(text), [text]);
  return (
    <div className={`shell-md ${className ?? ''}`} data-streaming={streaming ? '1' : '0'}>
      {sections.map((section, index) =>
        section.title ? (
          <CollapsibleSection
            key={`${index}:${section.title}`}
            title={section.title}
            body={section.body}
          />
        ) : (
          <MarkdownRenderer key={`intro:${index}`} text={section.body} />
        ),
      )}
      {streaming ? <span className="shell-md-cursor" aria-hidden="true" /> : null}
    </div>
  );
}
