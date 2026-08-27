import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileCode2,
  FileImage,
  FolderOpen,
} from 'lucide-react';
import { MermaidChart } from './MermaidChart.js';
import { HtmlSandbox } from './HtmlSandbox.js';
import { IncrementalMarkdownParser } from './incremental-markdown.js';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';

interface MarkdownContentProps {
  text: string;
  /** When true, show a trailing caret for streaming replies. */
  streaming?: boolean;
  /** File previews disable executable HTML embeds while keeping passive Markdown rendering. */
  interactiveEmbeds?: boolean;
  className?: string;
  projectFolder?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
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

function CodeBlock({ language, children }: { language?: string; children: ReactNode }) {
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
      className={`shell-md-code${canExpand ? ' is-expandable' : ''} ${
        expanded ? 'is-expanded' : 'is-collapsed'
      }`}
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
        {canExpand && !expanded ? <div className="shell-md-code__fade" aria-hidden="true" /> : null}
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

function isAtomicTableCell(children: ReactNode): boolean {
  const value = extractText(children).trim();
  return value.length > 0 && value.length <= 72 && /^[\w./:@#%+~-]+$/.test(value);
}

function MarkdownTable({ children }: { children: ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    const table = tableRef.current;
    if (!table) return;
    const text = Array.from(table.rows)
      .map((row) =>
        Array.from(row.cells)
          .map((cell) => cell.textContent?.trim() ?? '')
          .join('\t'),
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* Clipboard remains best-effort in restricted renderer contexts. */
    }
  }, []);

  return (
    <div className="shell-md-table-wrap">
      <div className="shell-md-table-toolbar">
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label={copied ? '表格已复制' : '复制表格'}
          title={copied ? '已复制' : '复制表格'}
        >
          {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
        </button>
      </div>
      <div className="shell-md-table-scroll">
        <table ref={tableRef}>{children}</table>
      </div>
    </div>
  );
}

/**
 * react-markdown 默认丢弃未知协议；放行 sync-think-image:（AI browser_screenshot
 * 产物走本地保护协议，CSP img-src 已允许），其余仍走默认清洗。
 */
function markdownUrlTransform(url: string): string {
  if (url.startsWith('sync-think-image://')) return url;
  // react-markdown treats Windows drive letters as unknown protocols. Keep
  // local workspace paths intact so ResourceLink can validate them against the
  // bound project folder before exposing an action.
  if (
    /^[A-Za-z]:[\\/]/.test(url) ||
    (!/^[A-Za-z][A-Za-z\d+.-]*:/i.test(url) && !url.startsWith('//'))
  ) {
    return url;
  }
  return defaultUrlTransform(url);
}

interface WorkspaceResource {
  path: string;
  label: string;
  location?: ProjectTextLocation;
  kind: 'code' | 'image' | 'directory';
}

function decodeHref(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function hasParentTraversal(value: string): boolean {
  return value.split('/').some((segment) => segment === '..');
}

function workspaceResourceFromHref(href: string, projectFolder?: string): WorkspaceResource | null {
  if (!projectFolder || /^(?:https?|data|sync-think-image):/i.test(href)) return null;
  const decoded = decodeHref(href.trim());
  const lineMatch = /:(\d+)(?::(\d+))?$/.exec(decoded);
  const rawPath = lineMatch ? decoded.slice(0, lineMatch.index) : decoded;
  const normalizedRoot = normalizePath(projectFolder);
  let normalizedPath = normalizePath(rawPath);
  const rootLower = normalizedRoot.toLowerCase();
  const pathLower = normalizedPath.toLowerCase();
  if (pathLower === rootLower) return null;
  if (pathLower.startsWith(`${rootLower}/`)) {
    normalizedPath = normalizedPath.slice(normalizedRoot.length + 1);
  } else if (!normalizedPath.startsWith('/') && !/^[A-Za-z]:\//.test(normalizedPath)) {
    normalizedPath = normalizedPath.replace(/^\.\//, '');
    if (hasParentTraversal(normalizedPath)) return null;
  } else {
    return null;
  }
  if (!normalizedPath || hasParentTraversal(normalizedPath)) return null;
  const basename = normalizedPath.split('/').at(-1) || normalizedPath;
  const extension = basename.includes('.') ? basename.split('.').at(-1)?.toLowerCase() : '';
  const kind =
    extension && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(extension)
      ? 'image'
      : extension
        ? 'code'
        : 'directory';
  return {
    path: normalizedPath,
    label: basename,
    kind,
    ...(lineMatch
      ? {
          location: {
            line: Number(lineMatch[1]),
            column: lineMatch[2] ? Number(lineMatch[2]) : 1,
          },
        }
      : {}),
  };
}

function ResourceIcon({ kind }: { kind: WorkspaceResource['kind'] | 'external' }) {
  if (kind === 'external') return <ExternalLink size={13} aria-hidden="true" />;
  if (kind === 'image') return <FileImage size={13} aria-hidden="true" />;
  if (kind === 'directory') return <FolderOpen size={13} aria-hidden="true" />;
  return <FileCode2 size={13} aria-hidden="true" />;
}

function ResourceLink({
  href,
  children,
  projectFolder,
  onOpenFile,
}: {
  href?: string;
  children?: ReactNode;
  projectFolder?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
}) {
  const value = href ?? '';
  const workspace = workspaceResourceFromHref(value, projectFolder);
  if (workspace && onOpenFile) {
    const label = extractText(children) || workspace.label;
    return (
      <button
        type="button"
        className="shell-md-resource shell-md-resource--file"
        data-resource-kind={workspace.kind}
        aria-label={`打开文件 ${label}${workspace.location?.line ? `，第 ${workspace.location.line} 行` : ''}`}
        onClick={() => onOpenFile(workspace.path, workspace.location)}
      >
        <ResourceIcon kind={workspace.kind} />
        <span>{children || workspace.label}</span>
      </button>
    );
  }
  if (/^https?:/i.test(value)) {
    const label = extractText(children) || value;
    return (
      <a
        href={value}
        className="shell-md-resource shell-md-resource--external"
        data-resource-kind="external"
        aria-label={`打开网页 ${label}`}
        onClick={(event) => {
          event.preventDefault();
          void window.syncThink?.runtime?.openExternalUrl?.(value);
        }}
      >
        <ResourceIcon kind="external" />
        <span>{children || value}</span>
      </a>
    );
  }
  return (
    <a href={value} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

const MarkdownRenderer = memo(function MarkdownRenderer({
  text,
  streaming,
  interactiveEmbeds,
  projectFolder,
  onOpenFile,
}: {
  text: string;
  streaming: boolean;
  interactiveEmbeds: boolean;
  projectFolder?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={streaming ? undefined : [rehypeHighlight]}
      urlTransform={markdownUrlTransform}
      components={{
        a: ({ href, children }) => (
          <ResourceLink href={href} projectFolder={projectFolder} onOpenFile={onOpenFile}>
            {children}
          </ResourceLink>
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
          if (language === 'mermaid' || language === 'mmd') {
            // Streaming blocks are still being produced — keep them as code so
            // the chart only mounts (and renders) once the block is complete.
            if (streaming) {
              return <CodeBlock language={language}>{children}</CodeBlock>;
            }
            return <MermaidChart code={raw.replace(/\n$/, '')} />;
          }
          if (language === 'html' || language === 'htm') {
            if (streaming || !interactiveEmbeds) {
              return <CodeBlock language={language}>{children}</CodeBlock>;
            }
            return <HtmlSandbox code={raw} />;
          }
          return <CodeBlock language={language}>{children}</CodeBlock>;
        },
        table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
        th: ({ children }) => (
          <th className={isAtomicTableCell(children) ? 'shell-md-table-cell--atomic' : undefined}>
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className={isAtomicTableCell(children) ? 'shell-md-table-cell--atomic' : undefined}>
            {children}
          </td>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
});

const StreamingMarkdownBlock = memo(function StreamingMarkdownBlock({
  text,
  projectFolder,
  onOpenFile,
}: {
  text: string;
  projectFolder?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
}) {
  return (
    <MarkdownRenderer
      text={text}
      streaming
      interactiveEmbeds={false}
      projectFolder={projectFolder}
      onOpenFile={onOpenFile}
    />
  );
});

function IncrementalStreamingMarkdown({
  text,
  projectFolder,
  onOpenFile,
}: {
  text: string;
  projectFolder?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
}) {
  const parserRef = useRef<IncrementalMarkdownParser>();
  if (!parserRef.current) parserRef.current = new IncrementalMarkdownParser();
  const snapshot = parserRef.current.update(text);
  return (
    <>
      {snapshot.blocks.map((block) => (
        <StreamingMarkdownBlock
          key={block.key}
          text={block.text}
          projectFolder={projectFolder}
          onOpenFile={onOpenFile}
        />
      ))}
    </>
  );
}

function CollapsibleSection({
  title,
  body,
  streaming,
  interactiveEmbeds,
  projectFolder,
  onOpenFile,
}: {
  title: string;
  body: string;
  streaming: boolean;
  interactiveEmbeds: boolean;
  projectFolder?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
}) {
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
          <MarkdownRenderer
            text={body}
            streaming={streaming}
            interactiveEmbeds={interactiveEmbeds}
            projectFolder={projectFolder}
            onOpenFile={onOpenFile}
          />
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
export function MarkdownContent({
  text,
  streaming = false,
  interactiveEmbeds = true,
  className,
  projectFolder,
  onOpenFile,
}: MarkdownContentProps) {
  const sections = useMemo(() => (streaming ? [] : splitMarkdownSections(text)), [streaming, text]);
  return (
    <div className={`shell-md ${className ?? ''}`} data-streaming={streaming ? '1' : '0'}>
      {streaming ? (
        <IncrementalStreamingMarkdown
          text={text}
          projectFolder={projectFolder}
          onOpenFile={onOpenFile}
        />
      ) : (
        sections.map((section, index) =>
          section.title ? (
            <CollapsibleSection
              key={`${index}:${section.title}`}
              title={section.title}
              body={section.body}
              streaming={false}
              interactiveEmbeds={interactiveEmbeds}
              projectFolder={projectFolder}
              onOpenFile={onOpenFile}
            />
          ) : (
            <MarkdownRenderer
              key={`intro:${index}`}
              text={section.body}
              streaming={false}
              interactiveEmbeds={interactiveEmbeds}
              projectFolder={projectFolder}
              onOpenFile={onOpenFile}
            />
          ),
        )
      )}
      {streaming ? <span className="shell-md-cursor" aria-hidden="true" /> : null}
    </div>
  );
}
