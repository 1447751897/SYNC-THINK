import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock as AgentCodeBlock, type CodeBlockReadingState } from './CodeBlock.js';
import { Check, ChevronDown, Copy, FolderOpen } from 'lucide-react';
import { MermaidChart } from './MermaidChart.js';
import { HtmlSandbox } from './HtmlSandbox.js';
import { DesignDraftPreview } from './DesignDraftPreview.js';
import { UiDesignPreview } from './UiDesignPreview.js';
import { ExcalidrawDraftPreview } from './ExcalidrawDraftPreview.js';
import { InlineVisualizationPreview } from './InlineVisualizationPreview.js';
import { parseInlineVisualizationSegments } from './inline-visualization.js';
import { normalizeTaggedDesignHtmlBlocks } from './design-draft.js';
import { IncrementalMarkdownParser } from './incremental-markdown.js';
import type { OpenHtmlInBrowser } from './html-browser.js';
import type { ProjectTextLocation } from '../../workspace-tools-contract.js';
import { FileTypeIcon } from './FileTypeIcon.js';
import { WebTextLink } from './WebTextLink.js';

const CodeReadingContext = createContext<Map<number, CodeBlockReadingState> | undefined>(undefined);

function MarkdownPre({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

interface MarkdownContentProps {
  text: string;
  /** When true, show a trailing caret for streaming replies. */
  streaming?: boolean;
  /** File previews disable executable HTML embeds while keeping passive Markdown rendering. */
  interactiveEmbeds?: boolean;
  className?: string;
  projectFolder?: string;
  conversationId?: string;
  modelId?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  onOpenHtmlInBrowser?: OpenHtmlInBrowser;
  onOpenUrl?: (url: string) => void;
}

interface MarkdownSection {
  title?: string;
  body: string;
  start: number;
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
  let offset = 0;
  let bodyStart = 0;
  let fence: { marker: '`' | '~'; length: number } | undefined;

  const flush = () => {
    if (title !== undefined || body.length > 0) {
      sections.push({ title, body: body.join('\n'), start: bodyStart });
    }
    body = [];
  };

  for (const line of lines) {
    offset += line.length + 1;
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[1] ?? '';
      const marker = run[0] as '`' | '~';
      if (!fence) {
        fence = { marker, length: run.length };
      } else if (
        fence.marker === marker &&
        run.length >= fence.length &&
        /^\s*$/.test(line.slice(fenceMatch[0].length))
      ) {
        fence = undefined;
      }
      body.push(line);
      continue;
    }

    const heading = !fence ? /^##(?!#)\s+(.+?)\s*$/.exec(line) : null;
    if (heading) {
      flush();
      title = heading[1];
      bodyStart = offset;
      continue;
    }
    body.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ body: text, start: 0 }];
}

function CodeBlock({
  language,
  children,
  streaming = false,
  sourceOffset,
}: {
  language?: string;
  children: ReactNode;
  streaming?: boolean;
  sourceOffset?: number;
}) {
  const text = useMemo(() => extractText(children).replace(/\n$/, ''), [children]);
  const states = useContext(CodeReadingContext);
  let readingState = sourceOffset === undefined ? undefined : states?.get(sourceOffset);
  if (states && sourceOffset !== undefined && !readingState) {
    readingState = { expanded: false, following: true, scrollTop: 0, scrollLeft: 0 };
    states.set(sourceOffset, readingState);
  }
  return (
    <AgentCodeBlock
      code={text}
      language={language}
      streaming={streaming}
      readingState={readingState}
    />
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

function ResourceLink({
  href,
  children,
  projectFolder,
  onOpenFile,
  onOpenUrl,
}: {
  href?: string;
  children?: ReactNode;
  projectFolder?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const value = href ?? '';
  const workspace = workspaceResourceFromHref(value, projectFolder);
  if (workspace && onOpenFile) {
    const label = extractText(children) || workspace.label;
    const text =
      workspace.location?.line && !/\(\s*line\s+\d+\s*\)/i.test(label)
        ? `${label} (line ${workspace.location.line})`
        : label;
    const hoverPath = projectFolder
      ? `${normalizePath(projectFolder)}/${workspace.path}`
      : workspace.path;
    const title = workspace.location?.line
      ? `${hoverPath} (line ${workspace.location.line})`
      : hoverPath;
    return (
      <button
        type="button"
        className="shell-md-resource shell-md-resource--file"
        data-resource-kind={workspace.kind}
        title={title}
        aria-label={`打开文件 ${label}${workspace.location?.line ? `，第 ${workspace.location.line} 行` : ''}`}
        onClick={() => onOpenFile(workspace.path, workspace.location)}
      >
        {workspace.kind === 'directory' ? (
          <FolderOpen size={13} aria-hidden="true" />
        ) : (
          <FileTypeIcon path={workspace.path} size={13} />
        )}
        <span>{text}</span>
      </button>
    );
  }
  if (/^https?:/i.test(value)) {
    return <WebTextLink url={value} label={extractText(children)} onOpen={onOpenUrl} />;
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
  conversationId,
  modelId,
  onOpenFile,
  onOpenHtmlInBrowser,
  onOpenUrl,
  skipVisualizations = false,
  sourceOffset = 0,
}: {
  text: string;
  streaming: boolean;
  interactiveEmbeds: boolean;
  projectFolder?: string;
  conversationId?: string;
  modelId?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  onOpenHtmlInBrowser?: OpenHtmlInBrowser;
  onOpenUrl?: (url: string) => void;
  skipVisualizations?: boolean;
  sourceOffset?: number;
}) {
  const visualizationSegments = useMemo(() => parseInlineVisualizationSegments(text), [text]);
  const renderCode = useMemo<Components['code']>(
    () =>
      ({ className, children, node, ...props }) => {
        const language = languageFromClassName(className);
        const codeOffset = node?.position?.start.offset;
        const readingOffset = codeOffset === undefined ? undefined : sourceOffset + codeOffset;
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
            return (
              <CodeBlock language={language} streaming={streaming} sourceOffset={readingOffset}>
                {children}
              </CodeBlock>
            );
          }
          return <MermaidChart code={raw.replace(/\n$/, '')} />;
        }
        if (language === 'design-html') {
          if (streaming || !interactiveEmbeds) {
            return (
              <CodeBlock language={language} streaming={streaming} sourceOffset={readingOffset}>
                {children}
              </CodeBlock>
            );
          }
          return (
            <DesignDraftPreview
              code={raw}
              projectFolder={projectFolder}
              onOpenInBrowser={onOpenHtmlInBrowser}
            />
          );
        }
        if (language === 'design-ui' || language === 'ui-design') {
          if (streaming || !interactiveEmbeds) {
            return (
              <CodeBlock language={language} streaming={streaming} sourceOffset={readingOffset}>
                {children}
              </CodeBlock>
            );
          }
          return <UiDesignPreview code={raw} />;
        }
        if (language === 'excalidraw' || language === 'excalidraw-json') {
          if (streaming || !interactiveEmbeds) {
            return (
              <CodeBlock language={language} streaming={streaming} sourceOffset={readingOffset}>
                {children}
              </CodeBlock>
            );
          }
          return (
            <ExcalidrawDraftPreview
              code={raw}
              projectFolder={projectFolder}
              modelId={modelId}
              onOpenInBrowser={onOpenHtmlInBrowser}
            />
          );
        }
        if (language === 'html' || language === 'htm') {
          if (streaming || !interactiveEmbeds) {
            return (
              <CodeBlock language={language} streaming={streaming} sourceOffset={readingOffset}>
                {children}
              </CodeBlock>
            );
          }
          return <HtmlSandbox code={raw} onOpenInBrowser={onOpenHtmlInBrowser} />;
        }
        return (
          <CodeBlock language={language} streaming={streaming} sourceOffset={readingOffset}>
            {children}
          </CodeBlock>
        );
      },
    [streaming, interactiveEmbeds, projectFolder, modelId, onOpenHtmlInBrowser, sourceOffset],
  );
  if (
    !skipVisualizations &&
    visualizationSegments.some((segment) => segment.type === 'visualization')
  ) {
    return (
      <>
        {visualizationSegments.map((segment, index) => {
          if (segment.type === 'visualization') {
            return interactiveEmbeds ? (
              <InlineVisualizationPreview
                key={`visualization:${index}:${segment.file}`}
                file={segment.file}
                projectFolder={projectFolder}
                conversationId={conversationId}
                onOpenInBrowser={onOpenHtmlInBrowser}
              />
            ) : (
              <CodeBlock key={`visualization-text:${index}`} language="text">
                {`::newmax-inline-vis{file="${segment.file}"}`}
              </CodeBlock>
            );
          }
          if (!segment.content) return null;
          return (
            <MarkdownRenderer
              key={`markdown:${index}`}
              text={segment.content}
              sourceOffset={sourceOffset + segment.start}
              streaming={streaming}
              interactiveEmbeds={interactiveEmbeds}
              projectFolder={projectFolder}
              conversationId={conversationId}
              modelId={modelId}
              onOpenFile={onOpenFile}
              onOpenHtmlInBrowser={onOpenHtmlInBrowser}
              onOpenUrl={onOpenUrl}
              skipVisualizations
            />
          );
        })}
      </>
    );
  }
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={markdownUrlTransform}
      components={{
        a: ({ href, children }) => (
          <ResourceLink
            href={href}
            projectFolder={projectFolder}
            onOpenFile={onOpenFile}
            onOpenUrl={onOpenUrl}
          >
            {children}
          </ResourceLink>
        ),
        pre: MarkdownPre,
        code: renderCode,
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
  sourceOffset,
  projectFolder,
  conversationId,
  modelId,
  onOpenFile,
  onOpenHtmlInBrowser,
  onOpenUrl,
}: {
  text: string;
  sourceOffset: number;
  projectFolder?: string;
  conversationId?: string;
  modelId?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  onOpenHtmlInBrowser?: OpenHtmlInBrowser;
  onOpenUrl?: (url: string) => void;
}) {
  return (
    <MarkdownRenderer
      text={text}
      sourceOffset={sourceOffset}
      streaming
      interactiveEmbeds={false}
      projectFolder={projectFolder}
      conversationId={conversationId}
      modelId={modelId}
      onOpenFile={onOpenFile}
      onOpenHtmlInBrowser={onOpenHtmlInBrowser}
      onOpenUrl={onOpenUrl}
    />
  );
});

function IncrementalStreamingMarkdown({
  text,
  projectFolder,
  conversationId,
  modelId,
  onOpenFile,
  onOpenHtmlInBrowser,
  onOpenUrl,
}: {
  text: string;
  projectFolder?: string;
  conversationId?: string;
  modelId?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  onOpenHtmlInBrowser?: OpenHtmlInBrowser;
  onOpenUrl?: (url: string) => void;
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
          sourceOffset={block.start}
          projectFolder={projectFolder}
          conversationId={conversationId}
          modelId={modelId}
          onOpenFile={onOpenFile}
          onOpenHtmlInBrowser={onOpenHtmlInBrowser}
          onOpenUrl={onOpenUrl}
        />
      ))}
    </>
  );
}

function CollapsibleSection({
  title,
  body,
  sourceOffset,
  streaming,
  interactiveEmbeds,
  projectFolder,
  conversationId,
  modelId,
  onOpenFile,
  onOpenHtmlInBrowser,
  onOpenUrl,
}: {
  title: string;
  body: string;
  sourceOffset: number;
  streaming: boolean;
  interactiveEmbeds: boolean;
  projectFolder?: string;
  conversationId?: string;
  modelId?: string;
  onOpenFile?: (path: string, location?: ProjectTextLocation) => void;
  onOpenHtmlInBrowser?: OpenHtmlInBrowser;
  onOpenUrl?: (url: string) => void;
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
            sourceOffset={sourceOffset}
            streaming={streaming}
            interactiveEmbeds={interactiveEmbeds}
            projectFolder={projectFolder}
            conversationId={conversationId}
            modelId={modelId}
            onOpenFile={onOpenFile}
            onOpenHtmlInBrowser={onOpenHtmlInBrowser}
            onOpenUrl={onOpenUrl}
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
  conversationId,
  modelId,
  onOpenFile,
  onOpenHtmlInBrowser,
  onOpenUrl,
}: MarkdownContentProps) {
  const normalizedText = useMemo(() => normalizeTaggedDesignHtmlBlocks(text), [text]);
  const readingRef = useRef({
    source: normalizedText,
    states: new Map<number, CodeBlockReadingState>(),
  });
  if (!normalizedText.startsWith(readingRef.current.source)) {
    readingRef.current = { source: normalizedText, states: new Map() };
  }
  readingRef.current.source = normalizedText;
  const sections = useMemo(
    () => (streaming ? [] : splitMarkdownSections(normalizedText)),
    [normalizedText, streaming],
  );
  return (
    <CodeReadingContext.Provider value={readingRef.current.states}>
      <div className={`shell-md ${className ?? ''}`} data-streaming={streaming ? '1' : '0'}>
        {streaming ? (
          <IncrementalStreamingMarkdown
            text={normalizedText}
            projectFolder={projectFolder}
            conversationId={conversationId}
            modelId={modelId}
            onOpenFile={onOpenFile}
            onOpenHtmlInBrowser={onOpenHtmlInBrowser}
            onOpenUrl={onOpenUrl}
          />
        ) : (
          sections.map((section, index) =>
            section.title ? (
              <CollapsibleSection
                key={`${index}:${section.title}`}
                title={section.title}
                body={section.body}
                sourceOffset={section.start}
                streaming={false}
                interactiveEmbeds={interactiveEmbeds}
                projectFolder={projectFolder}
                conversationId={conversationId}
                modelId={modelId}
                onOpenFile={onOpenFile}
                onOpenHtmlInBrowser={onOpenHtmlInBrowser}
                onOpenUrl={onOpenUrl}
              />
            ) : (
              <MarkdownRenderer
                key={`intro:${index}`}
                text={section.body}
                sourceOffset={section.start}
                streaming={false}
                interactiveEmbeds={interactiveEmbeds}
                projectFolder={projectFolder}
                conversationId={conversationId}
                modelId={modelId}
                onOpenFile={onOpenFile}
                onOpenHtmlInBrowser={onOpenHtmlInBrowser}
                onOpenUrl={onOpenUrl}
              />
            ),
          )
        )}
        {streaming ? <span className="shell-md-cursor" aria-hidden="true" /> : null}
      </div>
    </CodeReadingContext.Provider>
  );
}
