import { useCallback, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';

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
  const text = useMemo(() => extractText(children).replace(/\n$/, ''), [children]);

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
    <div className="shell-md-code" data-language={language || 'text'}>
      <div className="shell-md-code__bar">
        <span className="shell-md-code__lang">{language || 'text'}</span>
        <button
          type="button"
          className="shell-md-code__copy"
          onClick={() => void handleCopy()}
          title="复制代码"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre className="shell-md-code__pre">
        <code className={language ? `hljs language-${language}` : 'hljs'}>{children}</code>
      </pre>
    </div>
  );
}

/**
 * NewMax-aligned message markdown renderer:
 * - GFM (tables, task lists, strikethrough, autolink)
 * - fenced code with language label + copy
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
