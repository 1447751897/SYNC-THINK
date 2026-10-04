import { timelineLoadFailureMessage } from './run-timeline-loader.js';
import { useContextMenu, MessageContextActions, selectionContextActions, selectedContextText, copyContextText } from './ContextMenu.js';
import { readContextToolText } from './context-tool-text.js';
/**
 * DeepSeek Harness-style ordered assistant execution flow.
 * Think, commentary and status stay on their own rows in document order.
 * Consecutive tool calls fold into a local action summary that expands in place.
 */
import {
  Fragment,
  lazy,
  Suspense,
  createContext,
  useContext,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Atom,
  Copy,
  Quote,
  Check,
  ChevronDown,
  CircleAlert,
  FileCode2,
  FolderOpen,
  GitBranch,
  Globe,
  PencilLine,
  Plug,
  RotateCw,
  Search,
  Shield,
  SquareTerminal,
  Users,
  Wrench,
} from 'lucide-react';
import type { CommentaryTimelineSegment, ExecutionProcessStep, FileChangeItem } from '@sync-think/protocol';
import type { InlineProcessItem, DelegatedAgentToolEventView } from './conversation-types.js';
import { AgentActivityStateContext, AgentActivityStatus, AgentActivityViewport, agentActivityState } from './AgentActivity.js';
import { useAutoDisclosure } from './auto-disclosure.js';
import { MessageTextContent } from './MessageTextContent.js';
import { FileChangeDiff } from './ExecutionProcessBlock.js';
import type { CodeBlockReadingState } from './CodeBlock.js';
import { ToolResult } from './ToolResult.js';
import { buildExecutionTimeline } from './ExecutionTimeline.js';
import {
  activityFingerprint,
  commandDisplayFromArguments,
  commandDescriptionFromArguments,
  deriveCurrentActivity,
  deriveStallState,
  formatElapsedZh,
  friendlyToolName,
  groupConsecutiveProcessTools,
  extractGeneratedImageSrc,
  isImageGenerationActivity,
  toolVisualKind,
  toolInputSummary,
  toolStatusOf,
  type ConsecutiveProcessBlock,
  type ProcessActivity,
  type ProcessStallState,
  type ProcessToolVisualKind,
} from './process-activity.js';
import { TaskBranch, TaskListIcon, TaskListSection, TaskResourceChip, TaskReveal } from './TaskList.js';
import { AgentThinking, type AgentThinkingVariant } from './AgentThinking.js';
import {
  extractGeneratedImageModelLine,
  normalizeImageGenerationToolResult,
} from './markdown-image-gallery.js';
import { ConversationContentScope, DeferredToolContent } from './DeferredToolContent.js';
import { normalizeToolName } from '@sync-think/shared';

import { isImagePreviewTool } from './tool-image-kind.js';

// Full parameter rendering is only needed when a tool row is expanded.
const ToolPayload = lazy(() => import('./ToolPayload.js').then(m => ({ default: m.ToolPayload })));
const ToolImagePreview = lazy(() => import('./ToolImagePreview.js'));
const GridReveal = lazy(() => import('./GridReveal.js').then(m => ({ default: m.GridReveal })));
const WebSearchToolTrail = lazy(() => import('./WebSearch.js').then(m => ({default:m.WebSearchToolTrail})));

const EMPTY_TOOL_FILE_CHANGES = { byCall: new Map<string, readonly FileChangeItem[]>() };
const ToolFileChangesContext = createContext<{
  byCall: ReadonlyMap<string, readonly FileChangeItem[]>; conversationId?: string; projectFolder?: string;
}>(EMPTY_TOOL_FILE_CHANGES);

function latestLine(text: string): string {
  return (
    text
      .split('\n')
      .filter((part) => part.trim())
      .at(-1)
      ?.trim() ?? ''
  );
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((part) => part.trim())
      ?.trim() ?? ''
  );
}

function toolErrorSummary(text: string): string {
  const fallback = firstLine(text);
  const findMessage = (value: unknown, depth: number): string | undefined => {
    if (depth > 3) return undefined;
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!normalized) return undefined;
      if (normalized.startsWith('{') || normalized.startsWith('[')) {
        try {
          return findMessage(JSON.parse(normalized) as unknown, depth + 1) ?? firstLine(normalized);
        } catch {
          return firstLine(normalized);
        }
      }
      return firstLine(normalized);
    }
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail', 'reason', 'stderr', 'text']) {
      const found = findMessage(record[key], depth + 1);
      if (found) return found;
    }
    return undefined;
  };

  try {
    return findMessage(JSON.parse(text) as unknown, 0) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * 折叠行是纯文本节点，Markdown 标记不会被渲染，只会原样显示成
 * `**分析字段匹配**` 这种噪声。这里只做**展示用**的标记剥离，不改原文
 * （展开体仍走 MarkdownContent 完整渲染）。
 */
function stripInlineMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}[-*+]\s+/, '')
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/** 整行加粗或 ATX 标题 —— Codex 思考块惯用的小标题形态。 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  return /^\*\*[^*]+\*\*$/.test(trimmed) || /^__[^_]+__$/.test(trimmed);
}

/**
 * 把一段思考拆成「折叠行标题」与「展开体正文」。
 *
 * 当首行本身就是小标题时，正文剔除该行——否则折叠行和展开体首行完全重复，
 * 展开后看起来像是同一句被说了两遍。首行不是标题时保留全文，折叠行只作预览。
 */
function splitReasoning(text: string): { title: string; body: string } {
  const lines = text.split('\n');
  const index = lines.findIndex((line) => line.trim());
  if (index < 0) return { title: '', body: '' };
  const head = lines[index] ?? '';
  const title = stripInlineMarkdown(head);
  if (!isHeadingLine(head)) return { title, body: text };
  const body = lines
    .slice(index + 1)
    .join('\n')
    .replace(/^\n+/, '');
  return { title, body: body.trim() ? body : '' };
}

function elapsedLabel(startedAt?: string, completedAt?: string): string | undefined {
  if (!startedAt || !completedAt) return undefined;
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined;
  if (elapsed < 1000) return `${elapsed}ms`;
  return `${(elapsed / 1000).toFixed(elapsed < 10_000 ? 1 : 0)}s`;
}

/**
 * 运行中工具的自增耗时。`elapsedLabel` 要求终态边界，运行中拿不到，
 * 于是「在跑还是卡住」这个最需要时间的阶段反而完全没有时间显示。
 * `now` 来自面板层唯一的那个秒级时钟（不是每行各自的 interval），
 * 这样 running → completed 原位翻转时不会重挂载行（§12.17.17）。
 */
function runningElapsedLabel(startedAt: string | undefined, now: number): string | undefined {
  if (!startedAt) return undefined;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || now < started) return undefined;
  const elapsed = now - started;
  if (elapsed < 1000) return undefined;
  return elapsed < 60_000 ? `${Math.floor(elapsed / 1000)}s` : formatElapsedZh(elapsed);
}

function processDurationLabel(input: {
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  now: number;
  streaming?: boolean;
}): string | undefined {
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) {
    return formatElapsedZh(input.durationMs);
  }
  if (!input.startedAt) return undefined;
  const started = Date.parse(input.startedAt);
  const ended = input.completedAt
    ? Date.parse(input.completedAt)
    : input.streaming
      ? input.now
      : Number.NaN;
  const elapsed = ended - started;
  return Number.isFinite(elapsed) && elapsed >= 0 ? formatElapsedZh(elapsed) : undefined;
}

function ThinkRow({
  item,
  streaming,
  open,
  onToggle,
}: {
  item: Extract<InlineProcessItem, { kind: 'reasoning' }>;
  streaming?: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const isStreaming = item.status === 'streaming' || (item.status === undefined && streaming);
  const split = useMemo(() => splitReasoning(item.text), [item.text]);
  // 流式期间跟随最新一行（进度感），完成后固定为该段思考的标题。
  const summary =
    (isStreaming ? stripInlineMarkdown(latestLine(item.text)) : split.title) || '正在思考…';
  const body = isStreaming ? item.text : split.body;
  return (
    <div
      className={`shell-inline-process__think${open ? ' is-open' : ''}${isStreaming ? ' is-running' : ''}`}
      data-testid="inline-process-reasoning"
    >
      <button
        type="button"
        className="shell-inline-process__think-toggle"
        data-testid="think-row-toggle"
        data-highlight-band={isStreaming ? 'true' : undefined}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="shell-inline-process__row-leading" aria-hidden="true">
          <Atom size={14} className="shell-inline-process__row-symbol" />
          <ChevronDown
            size={14}
            className={`shell-inline-process__row-disclosure${open ? ' is-open' : ''}`}
          />
        </span>
        <span
          className={`shell-inline-process__think-label${isStreaming ? ' shell-text-shimmer' : ''}`}
          data-label={isStreaming ? 'Think' : undefined}
        >
          Think
        </span>
        <span className="shell-inline-process__separator" aria-hidden="true">
          ·
        </span>
        <span
          className={`shell-inline-process__think-summary${isStreaming ? ' shell-text-shimmer' : ''}`}
          data-testid="think-row-summary"
          data-label={isStreaming ? summary : undefined}
        >
          {summary}
        </span>
      </button>
      {open && body ? (
        <div className="shell-inline-process__think-body" data-testid="think-row-body">
          <MessageTextContent
            text={body}
            parts={item.contentRef ? [{ text: body, contentRef: item.contentRef }] : undefined}
            sourceStreaming={isStreaming}
          />
        </div>
      ) : null}
    </div>
  );
}

function ToolKindIcon({ kind }: { kind: ProcessToolVisualKind }) {
  if (kind === 'read') return <FileCode2 size={14} />;
  if (kind === 'write') return <PencilLine size={14} />;
  if (kind === 'list') return <FolderOpen size={14} />;
  if (kind === 'command') return <SquareTerminal size={14} />;
  if (kind === 'git') return <GitBranch size={14} />;
  if (kind === 'browser') return <Globe size={14} />;
  if (kind === 'search') return <Search size={14} />;
  if (kind === 'mcp') return <Plug size={14} />;
  return <Wrench size={14} />;
}

const TOOL_STATUS_TEXT: Readonly<Record<'running' | 'completed' | 'failed', string>> = {
  running: '运行中',
  completed: '完成',
  failed: '失败',
};

/**
 * One tool row of a delegated child Agent.
 *
 * A child's tool calls are shown with exactly the parent's row surface (kind
 * icon, friendly name, input summary, 参数/输出 with structured JSON fields and
 * copy buttons) instead of a bespoke `<code>`/`<pre>` dump, so the same call
 * reads the same way wherever it came from.
 */
export function DelegatedAgentToolRow({ event, projectFolder }: { event: DelegatedAgentToolEventView; projectFolder?: string }) {
  const parentFiles = useContext(ToolFileChangesContext);
  const [open, setOpen] = useState(false);
  const item = useMemo(() => delegatedToolEventToProcessItem(event), [event]);
  return (
    // The wrapper keeps the child log's own row divider; every other pixel of the
    // row is the shared ToolRow surface.
    <ToolFileChangesContext.Provider value={{ ...EMPTY_TOOL_FILE_CHANGES, projectFolder: projectFolder ?? parentFiles.projectFolder, conversationId: parentFiles.conversationId }}>
      <div className="shell-delegated-agent__tool" data-testid="delegated-agent-tool">
        <ToolRow
          item={item}
          // Child tool events carry no live progress frames, and a settled history
          // must never tick against a stale clock.
          liveClock={false}
          now={0}
          open={open}
          onToggle={() => setOpen((value) => !value)}
        />
      </div>
    </ToolFileChangesContext.Provider>
  );
}

function delegatedToolEventToProcessItem(
  event: DelegatedAgentToolEventView,
): Extract<InlineProcessItem, { kind: 'tool' }> {
  const status: 'running' | 'completed' | 'failed' =
    event.status === 'failed' ? 'failed' : event.status === 'running' ? 'running' : 'completed';
  // A bounded log must not look complete: say how much output was left out.
  const result =
    event.output === undefined
      ? event.argumentsTruncated
        ? `…输入已截断，原文 ${event.argumentsCharacters ?? '更多'} 字符（其余调用仍保留）`
        : undefined
      : (event.outputTruncated ?? (event.truncated && !event.argumentsTruncated))
        ? `${event.output}\n\n…输出已截断，原文 ${event.outputCharacters ?? '更多'} 字符（为保持委派结果可解析）`
        : event.argumentsTruncated
          ? `${event.output}\n\n…输入已截断，原文 ${event.argumentsCharacters ?? '更多'} 字符（其余调用仍保留）`
          : event.output;
  return {
    kind: 'tool',
    name: event.toolName,
    argumentsJson: event.arguments ?? '{}',
    ...(result !== undefined ? { result } : {}),
    status,
    ...(event.startedAt ? { startedAt: event.startedAt } : {}),
    ...(event.completedAt ? { completedAt: event.completedAt } : {}),
  };
}

/** Keep the full path as the click target while showing just its parent and file. */
function resourceLabel(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.slice(-2).join('/') || path;
}

function fullReadPath(argumentsJson: string): string | undefined {
  try {
    const fields = JSON.parse(argumentsJson) as Record<string, unknown>;
    const path =
      fields.path ?? fields.file_path ?? fields.filePath ?? fields.dir ?? fields.directory;
    return typeof path === 'string' && path.trim() ? path.trim() : undefined;
  } catch {
    return undefined;
  }
}

function ToolRow({
  item,
  liveClock,
  now,
  open,
  onToggle,
  onRead,
  onOpenChange,
}: {
  item: Extract<InlineProcessItem, { kind: 'tool' }>;
  /** 面板本次挂载中活过才展示实时计时；历史消息里残留的 running 行不走时钟。 */
  liveClock?: boolean;
  /** 面板层的秒级时钟；仅运行中的行会用到。 */
  now: number;
  open: boolean;
  onToggle: () => void;
  onRead?: () => void;
  onOpenChange?: (path: string) => void;
}) {
  const openContextMenu = useContextMenu();
  const messageActions = useContext(MessageContextActions);
  const fileChanges = useContext(ToolFileChangesContext);
  const changedFiles = item.toolCallId ? fileChanges.byCall.get(item.toolCallId) : undefined;
  const status = toolStatusOf(item);
  const runState = useContext(AgentActivityStateContext);
  const suspendedStatus = status === 'running' && runState && runState !== 'working' && runState !== 'recorded'
    ? runState === 'approval' ? 'waiting' : runState === 'paused' ? 'paused'
      : runState === 'cancelled' ? 'cancelled' : 'interrupted'
    : undefined;
  const displayStatus = suspendedStatus ?? status;
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const previewTool = isImagePreviewTool(item.name) && status !== 'failed';
  const resultReadingState = useRef<CodeBlockReadingState>({ expanded: false, following: true, scrollTop: 0, scrollLeft: 0 });
  const visualKind = toolVisualKind(item.name);
  const fileRead = ['read', 'read_file', 'file_read'].includes(normalizeToolName(item.name));
  const fileDiffOnly = visualKind === 'write' && Boolean(changedFiles?.length);
  const summary =
    fileDiffOnly && changedFiles
      ? changedFiles.length === 1
        ? changedFiles[0].path
        : `${changedFiles[0].path} 等 ${changedFiles.length} 个文件`
      : toolInputSummary(item);
  const commandDescription =
    visualKind === 'command' ? commandDescriptionFromArguments(item.argumentsJson) : undefined;

  const elapsed = elapsedLabel(item.startedAt, item.completedAt);
  const liveElapsed =
    status === 'running' && liveClock ? runningElapsedLabel(item.startedAt, now) : undefined;
  const displayName = item.displayName?.trim() || friendlyToolName(item.name);
  const statusText = suspendedStatus ? ({ waiting: '等待批准', paused: '已暂停', cancelled: '已停止', interrupted: '未收到完成结果' }[suspendedStatus]) : TOOL_STATUS_TEXT[status];
  const progressLine = status === 'running' ? item.progressLine?.trim() : undefined;
  const errorSummary =
    status === 'failed' ? toolErrorSummary(item.result ?? '') || '工具执行失败' : '';
  const detailResult = status === 'running'
    ? (item.progressOutput ?? item.result)
    : status === 'failed' && !(item.result ?? '').trim() ? '工具未返回错误详情' : item.result;
  const renderResult = (text?: string) => (
    <ToolResult
      output={text}
      status={suspendedStatus ?? (status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'running')}
      kind={fileRead ? 'file' : visualKind === 'command' ? 'terminal' : 'request'}
      filename={fileRead ? fullReadPath(item.argumentsJson) : undefined}
      truncated={status === 'running' && item.progressTruncated}
      readingState={resultReadingState.current}
      onRead={onRead}
      testId={item.resultRef ? undefined : 'inline-process-tool-result'}
    />
  );
  const visibleSummary = errorSummary || (previewTool ? '' : summary);
  const resourcePath = fileDiffOnly
    ? changedFiles?.length === 1
      ? changedFiles[0].path
      : undefined
    : summary && (visualKind === 'read' || visualKind === 'write' || visualKind === 'list')
      ? (fullReadPath(item.argumentsJson) ?? summary)
      : undefined;
  const imageTool = isImageGenerationActivity(item);
  const generatedSrc = status === 'completed' ? extractGeneratedImageSrc(item.result ?? '') : null;
  const generationModel = item.result
    ? extractGeneratedImageModelLine(normalizeImageGenerationToolResult(item.result))
    : undefined;
  const showGridReveal = imageTool && status !== 'failed' && !suspendedStatus;
  return (
    <div
      className={`shell-inline-process__tool is-${displayStatus} is-kind-${visualKind}`}
      data-testid="inline-process-tool"
      onContextMenu={event => {
        const selected = selectedContextText(event.currentTarget);
        const output = status === 'running' ? item.progressOutput ?? item.result ?? '' : item.result ?? '';
        const outputRef = status === 'running' ? undefined : item.resultRef;
        const readOutput = () => readContextToolText(output, outputRef, fileChanges.conversationId);
        const command = commandDisplayFromArguments(item.argumentsJson)?.code;
        openContextMenu(event, [
          ...selectionContextActions(selected, messageActions.quote),
          ...(visualKind === 'command' ? [{ id: 'command', label: '复制命令', icon: <Copy size={14} />, disabled: !command && !item.argumentsRef, separator: !!selected,
            run: async () => {
              const args = await readContextToolText(item.argumentsJson, item.argumentsRef, fileChanges.conversationId);
              const code = commandDisplayFromArguments(args)?.code;
              if (!code) throw new Error('命令内容尚未就绪');
              await copyContextText(code);
            } }] : []),
          { id: 'output', label: status === 'running' ? (item.progressTruncated ? '复制当前日志片段' : '复制当前输出') : '复制输出', icon: <Copy size={14} />,
            disabled: !output && !outputRef, run: async () => copyContextText(await readOutput()) },
          ...(status === 'failed' && messageActions.quote ? [{ id: 'quote-error', label: '引用错误并提问', icon: <Quote size={14} />,
            disabled: !output && !outputRef, run: async () => messageActions.quote?.((command ? '命令：' + command + '\n\n' : '') + await readOutput(), '请分析以下执行错误并给出修复建议') }] : []),
          ...(resourcePath ? [
            { id: 'copy-path', label: '复制文件路径', icon: <FileCode2 size={14} />, separator: true, run: () => copyContextText(resourcePath) },
            ...(onOpenChange ? [{ id: 'open-file', label: '打开对应文件', icon: <FolderOpen size={14} />, run: () => onOpenChange(resourcePath) }] : []),
          ] : []),
          { id: 'toggle', label: open ? '收起详情' : '展开详情', icon: <ChevronDown size={14} />, separator: true, run: onToggle },
        ]);
      }}
      data-failed={status === 'failed' ? 'true' : 'false'}
    >
      <button
        type="button"
        className="shell-inline-process__tool-toggle"
        data-highlight-band={status === 'running' && !suspendedStatus ? 'true' : undefined}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="shell-inline-process__row-leading" aria-hidden="true">
          {status === 'failed' ? (
            <span className="shell-inline-process__state-dot" />
          ) : (
            <span
              className="shell-inline-process__tool-icon shell-inline-process__row-symbol"
              data-testid="process-tool-kind"
              data-kind={visualKind}
            >
              <ToolKindIcon kind={visualKind} />
            </span>
          )}
          <ChevronDown
            size={14}
            className={`shell-inline-process__row-disclosure${open ? ' is-open' : ''}`}
          />
        </span>
        <span className="shell-inline-process__tool-name">{displayName}</span>
        {visibleSummary ? (
          <span className="shell-inline-process__separator" aria-hidden="true">
            ·
          </span>
        ) : null}
        {visibleSummary ? (
          <span
            className={`shell-inline-process__tool-summary${status === 'failed' ? ' is-failed' : ''}${resourcePath ? ' is-resource' : ''}`}
            title={resourcePath && visualKind === 'read' ? resourcePath : undefined}
            data-testid={status === 'failed' ? 'inline-process-tool-error-summary' : undefined}
            {...(resourcePath && onOpenChange
              ? {
                  role: 'link',
                  tabIndex: 0,
                  onClick: (event: React.MouseEvent<HTMLSpanElement>) => {
                    event.stopPropagation();
                    onOpenChange(resourcePath);
                  },
                  onKeyDown: (event: React.KeyboardEvent<HTMLSpanElement>) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenChange(resourcePath);
                  },
                }
              : {})}
          >
            {resourcePath && status !== 'failed'
              ? <TaskResourceChip label={resourceLabel(resourcePath)} path={resourcePath} />
              : visibleSummary}
          </span>
        ) : null}
        {commandDescription && visibleSummary ? (
          <span className="shell-inline-process__separator" aria-hidden="true">
            ·
          </span>
        ) : null}
        {commandDescription ? (
          <span className="shell-inline-process__tool-description" title={commandDescription}>
            {commandDescription}
          </span>
        ) : null}
        {(status === 'running' ? liveElapsed : elapsed) ? (
          <span
            className="shell-inline-process__tool-elapsed"
            data-testid="inline-process-tool-elapsed"
          >
            {status === 'running' ? liveElapsed : elapsed}
          </span>
        ) : null}
        <span
          className="shell-inline-process__tool-status"
          data-testid="inline-process-tool-status"
          data-status={displayStatus}
          title={statusText}
          aria-label={statusText}
        />
      </button>
      {progressLine && (!open || !item.progressOutput) ? (
        <div
          className="shell-inline-process__tool-progress"
          data-testid="inline-process-tool-progress"
        >
          {progressLine}
        </div>
      ) : null}
      {previewTool ? (
        <Suspense fallback={<p role="status">正在读取图片…</p>}>
          <ToolImagePreview item={item} root={fileChanges.projectFolder} />
        </Suspense>
      ) : null}
      {showGridReveal ? (
        <div className="shell-inline-process__grid-reveal" data-testid="inline-process-grid-reveal">
          <Suspense fallback={null}><GridReveal
            src={generatedSrc}
            alt={summary || '生成图片'}
            caption={
              status === 'running'
                ? '生成中'
                : generationModel
                  ? `生图模型 · ${generationModel}`
                  : undefined
            }
            aspect={1}
          /></Suspense>
        </div>
      ) : null}
      {open ? (
        <div
          className="shell-inline-process__tool-body"
          data-testid="inline-process-tool-details"
          tabIndex={0}
          aria-label={`${displayName}详情`}
        >
          {previewTool ? <button type="button" className="shell-tool-image__details-toggle" aria-label="技术详情" aria-expanded={technicalOpen}
            onClick={() => setTechnicalOpen(value => !value)}>技术详情</button> : null}
          {!previewTool || technicalOpen ? <>
          {!fileDiffOnly ? (
            <div className="shell-inline-process__detail-row">
              <span>原始工具</span>
              <code>{item.name}</code>
            </div>
          ) : null}
          {changedFiles?.length ? (
            <section
              className="shell-tool-file-diffs"
              aria-label="本次调用的文件变更"
              data-testid="tool-file-diffs"
            >
              {changedFiles.map((change, index) => (
                <div key={change.path + ':' + index} className="shell-tool-file-diffs__item">
                  <div className="shell-tool-file-diffs__header">
                    <FileCode2 size={14} aria-hidden="true" />
                    <button
                      type="button"
                      onClick={() => onOpenChange?.(change.path)}
                      disabled={!onOpenChange}
                      title={change.path}
                    >
                      {change.path}
                    </button>
                    <span>
                      {suspendedStatus ? statusText : status === 'running'
                        ? '执行中'
                        : status === 'failed'
                          ? '执行失败 · 已记录差异'
                          : '已记录差异'}
                    </span>
                  </div>
                  <FileChangeDiff
                    item={change}
                    conversationId={fileChanges.conversationId}
                    streaming={status === 'running' && !suspendedStatus}
                  />
                </div>
              ))}
            </section>
          ) : null}
          {!fileDiffOnly && item.argumentsJson ? (
            <div className="shell-inline-process__detail-block">
              <span>参数</span>
              <Suspense fallback={<p role="status">正在读取参数…</p>}>
                <ToolPayload
                  text={item.argumentsJson}
                  toolName={item.name}
                  testId="inline-process-tool-arguments"
                  label="参数"
                  deferred={item.argumentsRef}
                />
              </Suspense>
            </div>
          ) : null}
          {!fileDiffOnly && item.detailsRef ? (
            <DeferredToolContent
              deferred={item.detailsRef}
              preview="包含较大的附加字段；完整事件展示数据按需读取。"
              label="事件详情"
              testId="inline-process-event-details"
            />
          ) : null}
          {(detailResult !== undefined || item.resultRef || status === 'running' || status === 'completed') &&
          (!fileDiffOnly || status === 'failed') &&
          (!item.delegationAnchor || status === 'failed') ? (
            <div className="shell-inline-process__detail-block">
              {item.resultRef && status !== 'running' ? (
                <DeferredToolContent
                  deferred={item.resultRef}
                  preview={detailResult ?? ''}
                  label={status === 'failed' ? '错误' : '输出'}
                  testId="inline-process-tool-result"
                  failed={status === 'failed'}
                  renderContent={renderResult}
                />
              ) : renderResult(detailResult)}
            </div>
          ) : null}
          {/*
            A delegation's raw result is its internal payload (child run id, tool
            log, usage) — the reader cannot use it, and the card right below is
            the readable form. Point there instead of dumping the payload; a
            failed delegation still shows its own error text.
          */}
          {item.delegationAnchor && status !== 'failed' ? (
            <div className="shell-inline-process__detail-block">
              <span>结果</span>
              <p
                className="shell-inline-process__delegation-note"
                data-testid="delegation-anchor-note"
              >
                结果见下方智能体卡片。
              </p>
            </div>
          ) : null}
          </> : null}
        </div>
      ) : null}
    </div>
  );
}

function describeStatusDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  switch (detail) {
    case 'transient':
      return '暂时失败';
    case 'timeout':
      return '超时';
    case 'rate-limit':
      return '限流';
    case 'auth':
      return '认证失败';
    case 'protocol':
      return '协议错误';
    case 'unknown':
      return '未知错误';
    default:
      return detail;
  }
}

function StatusRow({ item }: { item: Extract<InlineProcessItem, { kind: 'status' }> }) {
  const failed =
    (item.statusType === 'connection' &&
      /失败|断开|error|failed/i.test(`${item.label} ${item.detail ?? ''}`)) ||
    /^工具审批：已(拒绝|失效)$/.test(item.label);
  const detail = describeStatusDetail(item.detail);
  return (
    <div
      className={`shell-inline-process__status${failed ? ' is-failed' : ''}`}
      data-testid="inline-process-status"
      role="status"
    >
      {item.statusType === 'retry' || item.statusType === 'model_switch' ? (
        <RotateCw size={12} aria-hidden="true" />
      ) : failed ? (
        <CircleAlert size={12} aria-hidden="true" />
      ) : (
        <Check size={12} aria-hidden="true" />
      )}
      <span className="shell-inline-process__status-label">{item.label}</span>
      {detail ? (
        <>
          <span className="shell-inline-process__separator" aria-hidden="true">
            ·
          </span>
          <span className="shell-inline-process__status-detail">{detail}</span>
        </>
      ) : null}
    </div>
  );
}

// Choose by the derived activity, not its localized or reasoning-preview label.
const PROCESS_ACTIVITY_VARIANTS: Readonly<Record<Exclude<ProcessActivity['kind'], 'approval'>, AgentThinkingVariant>> = {
  waiting: 'wave',
  thinking: 'infinity',
  tool: 'spin',
  answering: 'wave',
  status: 'wave',
};

function ProcessActivityRow({
  activity,
  stall,
  elapsed,
}: {
  activity: ProcessActivity;
  stall?: ProcessStallState;
  elapsed?: string;
}) {
  return (
    <div
      className="shell-process-panel__activity"
      data-testid="process-panel-activity"
      data-kind={activity.kind}
      data-stall={stall?.level ?? 'active'}
      role="status"
      aria-live="polite"
    >
      {activity.kind === 'approval' ? <>
        <Shield size={16} aria-hidden="true" />
        <span className="shell-process-panel__activity-label" data-label={activity.label} data-testid="process-activity-label">
          {activity.label}
        </span>
        {elapsed ? <span className="shell-process-panel__activity-elapsed">{elapsed}</span> : null}
      </> : <AgentThinking variant={PROCESS_ACTIVITY_VARIANTS[activity.kind]} tone="primary" label={activity.label} showTimer={Boolean(elapsed)}
        elapsedLabel={elapsed} announce={false} testId="process-activity" className="shell-process-panel__thinking" />}

      {stall && stall.level !== 'active' ? (
        <span className="shell-process-panel__activity-idle">
          {stall.hint ?? `${Math.floor(stall.idleMs / 1000)}s 无输出`}
        </span>
      ) : null}
    </div>
  );
}

function ProcessItemView({
  item,
  streaming,
  liveClock,
  now,
  open,
  onToggle,
  onRead,
  onOpenChange,
}: {
  item: InlineProcessItem;
  streaming?: boolean;
  liveClock?: boolean;
  now: number;
  open: boolean;
  onToggle: () => void;
  onRead?: () => void;
  onOpenChange?: (path: string) => void;
}) {
  if (item.kind === 'reasoning') {
    return <ThinkRow item={item} streaming={streaming} open={open} onToggle={onToggle} />;
  }
  if (item.kind === 'tool') {
    return (
      <ToolRow
        item={item}
        liveClock={liveClock}
        now={now}
        open={open}
        onToggle={onToggle}
        onRead={onRead}
        onOpenChange={onOpenChange}
      />
    );
  }
  if (item.kind === 'status') return <StatusRow item={item} />;
  return (
    <div
      className="shell-inline-process__markdown"
      data-testid={item.kind === 'commentary' ? 'inline-process-commentary' : 'inline-process-text'}
    >
      <MessageTextContent
        text={item.text}
        parts={item.contentRef ? [{ text: item.text, contentRef: item.contentRef }] : undefined}
        sourceStreaming={item.status === 'streaming'}
      />
    </div>
  );
}

function ProcessEntry({
  item,
  index,
  streaming,
  liveClock,
  now,
  expandedItemKeys,
  toggleItem,
  keepItemOpen,
  onOpenChange,
}: {
  item: InlineProcessItem;
  index: number;
  streaming?: boolean;
  liveClock?: boolean;
  now: number;
  expandedItemKeys: ReadonlySet<string>;
  toggleItem(itemKey: string): void;
  keepItemOpen(itemKey: string): void;
  onOpenChange?: (path: string) => void;
}) {
  // Stable key first (toolCallId / id / sequence) so status updates reuse the
  // row instead of remounting it.
  const itemKey = processItemKey(item, index);
  return (
    <TaskReveal className="shell-inline-process__entry" data-testid="process-entry" key={itemKey} role="listitem" reveal={streaming}>
      <TaskBranch />
      <div className="shell-inline-process__entry-content">
        <ProcessItemView
          item={item}
          streaming={streaming}
          liveClock={liveClock}
          now={now}
          open={expandedItemKeys.has(itemKey)}
          onToggle={() => {
            if (expandedItemKeys.has(itemKey)) toggleItem(itemKey);
            else keepItemOpen(itemKey);
          }}
          onRead={() => keepItemOpen(itemKey)}
          onOpenChange={onOpenChange}
        />
      </div>
    </TaskReveal>
  );
}

function processItemKey(item: InlineProcessItem, index: number): string {
  if (item.kind === 'tool' && item.toolCallId) return `tool-${item.toolCallId}`;
  if (item.id) return item.id;
  if (item.sequence !== undefined) return `${item.kind}-${item.sequence}`;
  return `${item.kind}-${index}`;
}

function processStepItem(step: ExecutionProcessStep): Extract<InlineProcessItem, { kind: 'tool' }> {
  return {
    kind: 'tool', toolCallId: step.id, sequence: step.sequence,
    name: step.toolName ?? step.label ?? '工具',
    argumentsJson: step.command ?? step.url ?? step.path ?? '',
    result: step.preview ?? step.error ?? '',
    ...(step.outputRef ? { resultRef: step.outputRef } : {}),
    ...(step.detailsRef ? { detailsRef: step.detailsRef } : {}),
    ...(step.argumentsRef ? { argumentsRef: step.argumentsRef } : {}),
    status: step.status === 'error' ? 'failed' : step.completedAt ? 'completed' : 'running',
    ...(step.status === 'error' ? { failed: true } : {}),
    ...(step.startedAt ? { startedAt: step.startedAt } : {}),
    ...(step.completedAt ? { completedAt: step.completedAt } : {}),
  };
}

function enrichToolBoundaries(
  items: readonly InlineProcessItem[],
  steps: readonly ExecutionProcessStep[] | undefined,
): InlineProcessItem[] {
  if (!steps?.length) return [...items];
  const usedSteps = new Set<number>();
  let nextStepIndex = 0;

  return items.map((item) => {
    if (item.kind !== 'tool') return item;
    let matchedIndex = steps.findIndex(
      (step, index) =>
        !usedSteps.has(index) &&
        ((item.toolCallId && step.id === item.toolCallId) || (item.id && step.id === item.id)),
    );
    if (matchedIndex < 0) {
      matchedIndex = steps.findIndex(
        (step, index) =>
          index >= nextStepIndex && !usedSteps.has(index) && step.toolName === item.name,
      );
    }
    if (matchedIndex < 0) {
      matchedIndex = steps.findIndex((_, index) => index >= nextStepIndex && !usedSteps.has(index));
    }
    if (matchedIndex < 0) return item;

    usedSteps.add(matchedIndex);
    nextStepIndex = Math.max(nextStepIndex, matchedIndex + 1);
    const step = steps[matchedIndex];
    if (!step) return item;
    return {
      ...item,
      ...(item.sequence === undefined && step.sequence !== undefined
        ? { sequence: step.sequence }
        : {}),
      ...(!item.startedAt && (step.startedAt ?? step.occurredAt)
        ? { startedAt: step.startedAt ?? step.occurredAt }
        : {}),
      ...(!item.completedAt && step.completedAt ? { completedAt: step.completedAt } : {}),
    };
  });
}

function mergeMissingCommentary(
  items: readonly InlineProcessItem[],
  steps: readonly ExecutionProcessStep[] | undefined,
  commentarySegments: readonly CommentaryTimelineSegment[] | undefined,
): readonly InlineProcessItem[] {
  if (!commentarySegments?.length) return items;
  const ordered = enrichToolBoundaries(items, steps);
  const existingIds = new Set<string>();
  const existingTextCounts = new Map<string, number>();
  for (const item of ordered) {
    if (item.kind !== 'text' && item.kind !== 'commentary') continue;
    if (item.id) existingIds.add(item.id);
    const text = item.text.trim();
    if (text) existingTextCounts.set(text, (existingTextCounts.get(text) ?? 0) + 1);
  }
  const consumeExistingText = (text: string): boolean => {
    const count = existingTextCounts.get(text) ?? 0;
    if (count <= 0) return false;
    if (count === 1) existingTextCounts.delete(text);
    else existingTextCounts.set(text, count - 1);
    return true;
  };

  const missing = commentarySegments.flatMap((segment, originalIndex) => {
    const text = segment.text.trim();
    if (!text) return [];
    if (existingIds.has(segment.id)) {
      consumeExistingText(text);
      return [];
    }
    if (consumeExistingText(text)) return [];
    return [{ segment, originalIndex }];
  });
  if (missing.length === 0) return ordered;
  missing.sort((left, right) => {
    if (left.segment.afterSequence !== undefined && right.segment.afterSequence !== undefined) {
      return (
        left.segment.afterSequence - right.segment.afterSequence ||
        left.originalIndex - right.originalIndex
      );
    }
    const leftTime = Date.parse(left.segment.startedAt);
    const rightTime = Date.parse(right.segment.startedAt);
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.originalIndex - right.originalIndex;
  });

  for (const { segment } of missing) {
    const sequence = segment.afterSequence === undefined ? undefined : segment.afterSequence + 0.5;
    const item: InlineProcessItem = {
      kind: 'commentary',
      id: segment.id,
      text: segment.text,
      status: segment.completedAt ? 'completed' : 'streaming',
      ...(sequence === undefined ? {} : { sequence }),
    };
    let insertionIndex = -1;
    if (sequence !== undefined) {
      insertionIndex = ordered.findIndex(
        (candidate) => candidate.sequence !== undefined && candidate.sequence > sequence,
      );
      if (insertionIndex < 0) {
        for (let index = ordered.length - 1; index >= 0; index -= 1) {
          const candidate = ordered[index];
          if (candidate?.sequence !== undefined && candidate.sequence <= sequence) {
            insertionIndex = index + 1;
            break;
          }
        }
      }
    }
    if (insertionIndex < 0) {
      const segmentTime = Date.parse(segment.startedAt);
      if (Number.isFinite(segmentTime)) {
        insertionIndex = ordered.findIndex((candidate) => {
          if (candidate.kind !== 'tool' || !candidate.startedAt) return false;
          const candidateTime = Date.parse(candidate.startedAt);
          return Number.isFinite(candidateTime) && candidateTime > segmentTime;
        });
      }
    }
    if (insertionIndex < 0) {
      const firstBoundary = ordered.findIndex(
        (candidate) => candidate.kind === 'tool' || candidate.kind === 'status',
      );
      insertionIndex = firstBoundary < 0 ? ordered.length : firstBoundary;
    }
    ordered.splice(insertionIndex, 0, item);
  }
  return ordered;
}

function ProcessActionSummary({ summary, open, running, iconKind, onToggle, children }: {
  summary: string; open: boolean; running: boolean; iconKind: 'search' | 'file' | 'command';
  onToggle: () => void; children?: ReactNode;
}) {
  return <TaskListSection title={summary} icon={<TaskListIcon kind={iconKind} />} open={open} running={running}
    onToggle={onToggle} testId="process-action-summary" toggleTestId="process-action-summary-toggle">{children}</TaskListSection>;
}

function consecutiveToolRunShouldOpen(
  block: Extract<ConsecutiveProcessBlock, { kind: 'tools' }>,
  input: {
    defaultOpen?: boolean;
    userToggled: ReadonlySet<string>;
    currentlyOpen: ReadonlySet<string>;
  },
): boolean {
  if (input.userToggled.has(block.key)) return input.currentlyOpen.has(block.key);
  if (input.defaultOpen === true) return true;
  return block.entries.some((entry) => toolStatusOf(entry.item) !== 'completed');
}

function nextOpenToolRuns(
  blocks: readonly ConsecutiveProcessBlock[],
  input: {
    defaultOpen?: boolean;
    userToggled: ReadonlySet<string>;
    currentlyOpen: ReadonlySet<string>;
  },
): Set<string> {
  const next = new Set<string>();
  for (const block of blocks) {
    if (block.kind !== 'tools') continue;
    if (consecutiveToolRunShouldOpen(block, input)) next.add(block.key);
  }
  return next;
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

/**
 * Interleave two already-ordered streams on their shared wall clock.
 *
 * While a run streams the panel merges two sources: Think rows come from the
 * run's assistant timeline, tool/commentary rows from the paged process view.
 * Each row carries the clock of the segment it came from, so a stable merge on
 * `startedAt` reconstructs the real `Think → tool → Think → tool` order.
 *
 * Appending the tail wholesale instead (the previous behaviour) hoisted every
 * Think row above every tool row, which is what made a long run look like "all
 * commands and tools, no thinking". Rows with no usable clock keep their
 * relative position at the head of the stream they came from.
 */
function interleaveByStartedAt(
  leading: readonly InlineProcessItem[],
  trailing: readonly InlineProcessItem[],
): InlineProcessItem[] {
  const clockOf = (item: InlineProcessItem): number | undefined => {
    const value = 'startedAt' in item ? item.startedAt : undefined;
    const parsed = Date.parse(value ?? '');
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const out: InlineProcessItem[] = [];
  const rest = [...trailing];
  for (const item of leading) {
    const clock = clockOf(item);
    if (clock === undefined) {
      out.push(item);
      continue;
    }
    while (rest.length > 0) {
      const nextClock = clockOf(rest[0]!);
      // An untimed trailing row cannot be compared, so emit it in place rather
      // than letting it stall the merge for every later row.
      if (nextClock !== undefined && nextClock > clock) break;
      out.push(rest.shift()!);
    }
    out.push(item);
  }
  return [...out, ...rest];
}

function ThinkVisibilitySwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange?: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label="显示 Think"
      aria-checked={checked}
      data-testid="process-think-switch"
      className={`shell-process-panel__think-switch${checked ? ' is-checked' : ''}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onChange?.(!checked);
      }}
    >
      <span className="shell-process-panel__think-switch-label">Think</span>
      <span className="shell-process-panel__think-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export const InlineProcessFlow = memo(function InlineProcessFlow({
  items,
  steps,
  fileChanges,
  totalFailedTools,
  totalTools,
  pageControls,
  commentarySegments,
  streaming,
  waitingForApproval = false,
  terminalState,
  answerStarted = false,
  runId,
  conversationId,
  projectFolder,
  startedAt,
  completedAt,
  durationMs,
  defaultOpen,
  collapseExecutionProcess = true,
  showToolUse = true,
  showThinking = true,
  onShowThinkingChange,
  toolCallExpandedByDefault = false,
  agentTaskContent,
  renderInlineAgentTask,
  supplementalContent,
  onOpenChange,
  onPanelOpen,
  timelineLoadState = 'idle',
  timelineLoadError,
  timelineHasMore = false,
  onLoadMoreTimeline,
  onRetryTimelineLoad,
}: {
  items: readonly InlineProcessItem[];
  steps?: readonly ExecutionProcessStep[];
  fileChanges?: readonly FileChangeItem[];
  totalFailedTools?: number;
  totalTools?: number;
  pageControls?: ReactNode;
  commentarySegments?: readonly CommentaryTimelineSegment[];
  streaming?: boolean;
  waitingForApproval?: boolean;
  terminalState?: 'failed' | 'cancelled' | 'paused';
  answerStarted?: boolean;
  runId?: string;
  conversationId?: string;
  projectFolder?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  /** Deterministic fixture override; production follows the run phase. */
  defaultOpen?: boolean;
  /** Merge the completed trace behind an execution summary row. */
  collapseExecutionProcess?: boolean;
  /** Keep tool rows in the conversation trace. */
  showToolUse?: boolean;
  /** Keep Think rows in the conversation trace. */
  showThinking?: boolean;
  onShowThinkingChange?: (value: boolean) => void;
  /** Open each newly observed tool's input/output until the user toggles it. */
  toolCallExpandedByDefault?: boolean;
  /** Reserved for real delegated task projections; omitted when no tasks exist. */
  agentTaskContent?: ReactNode;
  /**
   * 让某一项在时间线上换成专属卡片（子智能体委派就是这样：卡片留在委派发生的那
   * 一刻，而不是被抽到面板顶部）。返回 `undefined` 表示按普通条目渲染。
   */
  renderInlineAgentTask?: (item: InlineProcessItem) => ReactNode;
  supplementalContent?: ReactNode;
  onOpenChange?: (path: string) => void;
  /** Lazy detail seam: invoked once when this run's folded panel first opens. */
  onPanelOpen?: () => void;
  timelineLoadState?: 'idle' | 'loading' | 'loaded' | 'error';
  timelineLoadError?: string;
  /** 保留给调用方与测试；面板不再展示补页进度（补页是静默后台行为）。 */
  timelineLoadedCount?: number;
  timelineTotalSegments?: number;
  timelineHasMore?: boolean;
  onLoadMoreTimeline?: () => void;
  onRetryTimelineLoad?: () => void;
}) {
  const fileChangesContext = useMemo(() => {
    const byCall = new Map<string, FileChangeItem[]>();
    for (const change of fileChanges ?? []) {
      if (!change.toolCallId) continue;
      const group = byCall.get(change.toolCallId) ?? [];
      group.push(change); byCall.set(change.toolCallId, group);
    }
    return { byCall, conversationId, projectFolder };
  }, [fileChanges, conversationId, projectFolder]);
  const orderedItems = useMemo<readonly InlineProcessItem[]>(() => {
    const stepsById = new Map(steps?.map((step) => [step.id, step]));
    const visibleItems = items
      .filter((item) => {
        if (!showToolUse && item.kind === 'tool') return false;
        if (!showThinking && item.kind === 'reasoning') return false;
        return true;
      })
      .map((item) => {
        if (item.kind !== 'tool') return item;
        const step =
          (item.toolCallId ? stepsById.get(item.toolCallId) : undefined) ??
          (item.id ? stepsById.get(item.id) : undefined);
        if (!step?.outputRef && !step?.argumentsRef && !step?.detailsRef) return item;
        return {
          ...item,
          detailsRef: step.detailsRef ?? item.detailsRef,
          resultRef:
            !item.resultRef || item.resultRef.reference.source === 'message'
              ? (step.outputRef ?? item.resultRef)
              : item.resultRef,
          argumentsRef:
            !item.argumentsRef || item.argumentsRef.reference.source === 'message'
              ? (step.argumentsRef ?? item.argumentsRef)
              : item.argumentsRef,
        };
      });
    const visibleSteps = showToolUse ? steps : undefined;
    if (visibleItems.some((item) => item.kind === 'tool' || item.kind === 'status')) {
      const ids = new Set(visibleItems.flatMap(item => item.kind === 'tool' ? [item.toolCallId, item.id] : []));
      // Image preparation is host-owned and absent from the model's tool timeline.
      const images = visibleSteps?.filter(step => step.toolName === 'image_input' && !ids.has(step.id)).map(processStepItem) ?? [];
      return mergeMissingCommentary(interleaveByStartedAt(visibleItems, images), visibleSteps, commentarySegments);
    }
    if (!visibleSteps?.length && !commentarySegments?.length) return visibleItems;
    const merged: InlineProcessItem[] = [];
    for (const item of buildExecutionTimeline({ steps: visibleSteps, commentarySegments })) {
      if (item.type === 'commentary') {
        if (item.text.trim())
          merged.push({
            kind: 'commentary',
            text: item.text,
            // Keep the segment clock so the summary can be interleaved against
            // the Think rows sharing the same timeline.
            ...(item.startedAt ? { startedAt: item.startedAt } : {}),
            ...(item.completedAt ? { completedAt: item.completedAt } : {}),
          });
        continue;
      }
      for (const step of item.steps) {
        merged.push(processStepItem(step));
      }
    }
    return interleaveByStartedAt(
      // Commentary is re-added by `buildExecutionTimeline` from the segments
      // (which carry the durable boundary it must be placed against), so drop
      // the item copies to avoid rendering each summary twice. When there are no
      // segments the items are the only carrier — keep them.
      commentarySegments?.length
        ? visibleItems.filter((item) => item.kind !== 'commentary')
        : [...visibleItems],
      merged,
    );
  }, [commentarySegments, items, showThinking, showToolUse, steps]);
  const timelineBlocks = useMemo(() => groupConsecutiveProcessTools(orderedItems), [orderedItems]);

  const [expandedItemKeys, setExpandedItemKeys] = useState<ReadonlySet<string>>(() => new Set());
  const userToggledItemKeysRef = useRef<Set<string>>(new Set());
  const expandedRunIdRef = useRef(runId);
  useEffect(() => {
    const runChanged = expandedRunIdRef.current !== runId;
    if (runChanged) {
      expandedRunIdRef.current = runId;
      userToggledItemKeysRef.current.clear();
    }
    setExpandedItemKeys((current) => {
      const next = runChanged ? new Set<string>() : new Set(current);
      for (const [index, item] of orderedItems.entries()) {
        if (item.kind !== 'tool') continue;
        const itemKey = processItemKey(item, index);
        if (userToggledItemKeysRef.current.has(itemKey)) continue;
        if ((toolCallExpandedByDefault && toolStatusOf(item) !== 'failed') ||
          (toolStatusOf(item) === 'running' && (Boolean(item.result) || item.progressOutput !== undefined)))
          next.add(itemKey);
        else next.delete(itemKey);
      }
      return sameStringSet(next, current) ? current : next;
    });
  }, [orderedItems, runId, toolCallExpandedByDefault]);
  const toggleItem = useCallback((itemKey: string) => {
    userToggledItemKeysRef.current.add(itemKey);
    setExpandedItemKeys((current) => {
      const next = new Set(current);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  }, []);
  const [clockNow, setClockNow] = useState(() => Date.now());
  // 面板层唯一的秒级时钟，驱动总耗时、每行运行耗时和停滞分级。运行中就必须
  // 走（不能再要求 startedAt）——工具行的耗时只依赖各自的 startedAt。
  const ticking = Boolean(streaming) && !completedAt && !terminalState;
  // 本次挂载中面板是否活过：活过再 settle 时冻结显示最后的计时；而挂载时
  // 就已 settle 的历史消息里若残留 status=running 的工具行，绝不能拿当前
  // 时间对着几天前的 startedAt 计时（会显示几百小时）。
  const everStreamedRef = useRef(Boolean(streaming));
  if (streaming) everStreamedRef.current = true;
  const liveClock = everStreamedRef.current;
  useEffect(() => {
    if (!ticking) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  // A final response is the end of the live execution phase, even if tools
  // failed or the run ended with a terminal notice. Reset running-time manual
  // overrides at that boundary; after completion the user can reopen freely.
  const settled = !streaming && !waitingForApproval && Boolean(answerStarted || terminalState);
  const activityState = agentActivityState({ streaming, waitingForApproval, terminalState, answerStarted, completedAt });
  const automaticPanelOpen = settled ? false : defaultOpen ?? Boolean(streaming || waitingForApproval || !answerStarted);
  const { open: disclosedPanelOpen, toggle: togglePanel, keepOpen: keepPanelOpen } = useAutoDisclosure({
    autoOpen: automaticPanelOpen,
    resetKey: JSON.stringify([runId, settled]),
  });
  const collapsible = settled || collapseExecutionProcess;
  const panelOpen = collapsible ? disclosedPanelOpen : true;
  const userToggledToolRunsRef = useRef(new Set<string>());
  const toolRunResetKeyRef = useRef(runId);
  const [openToolRuns, setOpenToolRuns] = useState<ReadonlySet<string>>(() =>
    nextOpenToolRuns(timelineBlocks, {
      defaultOpen,
      userToggled: new Set(),
      currentlyOpen: new Set(),
    }),
  );
  if (toolRunResetKeyRef.current !== runId) {
    toolRunResetKeyRef.current = runId;
    userToggledToolRunsRef.current.clear();
  }
  useEffect(() => {
    setOpenToolRuns((current) => {
      const next = nextOpenToolRuns(timelineBlocks, {
        defaultOpen,
        userToggled: userToggledToolRunsRef.current,
        currentlyOpen: current,
      });
      return sameStringSet(next, current) ? current : next;
    });
  }, [defaultOpen, runId, timelineBlocks]);
  const toggleToolRun = useCallback((key: string) => {
    userToggledToolRunsRef.current.add(key);
    setOpenToolRuns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const keepItemOpen = useCallback((itemKey: string) => {
    userToggledItemKeysRef.current.add(itemKey);
    setExpandedItemKeys((current) => current.has(itemKey) ? current : new Set([...current, itemKey]));
    keepPanelOpen();
    const block = timelineBlocks.find((candidate) => candidate.kind === 'tools' &&
      candidate.entries.some((entry) => processItemKey(entry.item, entry.index) === itemKey));
    if (block?.kind === 'tools') {
      userToggledToolRunsRef.current.add(block.key);
      setOpenToolRuns((current) => current.has(block.key) ? current : new Set([...current, block.key]));
    }
  }, [keepPanelOpen, timelineBlocks]);
  const notifiedOpenRunRef = useRef<string>();
  useEffect(() => {
    if (!panelOpen) {
      notifiedOpenRunRef.current = undefined;
      return;
    }
    // Live events already provide the running turn; read its durable history after completion.
    if (streaming || !onPanelOpen) return;
    const key = runId ?? 'anonymous-run';
    if (notifiedOpenRunRef.current === key) return;
    notifiedOpenRunRef.current = key;
    onPanelOpen();
  }, [onPanelOpen, panelOpen, runId, streaming]);
  useEffect(() => {
    if (!panelOpen || timelineLoadState !== 'loaded' || !timelineHasMore || !onLoadMoreTimeline)
      return;
    onLoadMoreTimeline();
  }, [onLoadMoreTimeline, panelOpen, timelineHasMore, timelineLoadState]);
  const durationLabel = processDurationLabel({
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    now: clockNow,
    streaming,
  });
  const hasActiveRow = orderedItems.some(
    (item) =>
      (item.kind === 'reasoning' && item.status === 'streaming') ||
      (item.kind === 'tool' && toolStatusOf(item) === 'running'),
  );
  // 活动摘要始终落在执行流最下方，作为这一轮的实时落点。BoardUI 波纹与流光
  // 是进程活着的视觉证据；停滞分级只在长时间无输出时追加中性提示。
  // Activity still reads hidden Think rows so the bottom status can show the
  // latest reasoning line after the user turns the Think switch off.
  const activity = deriveCurrentActivity(items, {
    streaming: Boolean(streaming) && !terminalState,
    waitingForApproval: waitingForApproval && !terminalState,
  });
  const lastTimelineBlock = timelineBlocks.at(-1);
  const researchOwnsActivity = activity?.kind === 'tool' && lastTimelineBlock?.kind === 'web' && lastTimelineBlock.entries.some(entry => entry.item.toolCallId === activity.toolCallId && toolStatusOf(entry.item) === 'running');
  const fingerprint = useMemo(() => activityFingerprint(orderedItems), [orderedItems]);
  const [lastProgressAt, setLastProgressAt] = useState(() => Date.now());
  useEffect(() => {
    setLastProgressAt(Date.now());
  }, [fingerprint, waitingForApproval]);
  const stall = activity
    ? deriveStallState({ activity, lastProgressAt, now: clockNow })
    : undefined;
  const showWaiting = Boolean(streaming && !answerStarted && !hasActiveRow);
  const failedToolCount =
    totalFailedTools ??
    orderedItems.reduce(
      (count, item) => count + (item.kind === 'tool' && toolStatusOf(item) === 'failed' ? 1 : 0),
      0,
    );
  const hasHiddenThinking = !showThinking && items.some((item) => item.kind === 'reasoning');
  if (
    orderedItems.length === 0 &&
    !waitingForApproval &&
    !showWaiting &&
    !agentTaskContent &&
    !supplementalContent &&
    !terminalState &&
    !hasHiddenThinking
  ) {
    return null;
  }
  const recordedToolCount = totalTools ?? new Set(orderedItems.flatMap((item, index) =>
    item.kind === 'tool' ? [processItemKey(item, index)] : []
  )).size;
  const processMeta =
    failedToolCount > 0 || durationLabel || recordedToolCount > 0 ? (
      <span className="shell-agent-activity__metrics">
        {recordedToolCount > 0 ? <span className="shell-agent-activity__count">{recordedToolCount} 次工具调用</span> : null}
        {failedToolCount > 0 ? (
          <>
            <span className="shell-process-panel__separator" aria-hidden="true">
              ·
            </span>
            <span className="shell-process-panel__failure">{failedToolCount} 项失败</span>
          </>
        ) : null}
        {durationLabel ? (
          <>
            <span className="shell-process-panel__separator" aria-hidden="true">
              ·
            </span>
            <span className="shell-process-panel__elapsed">{durationLabel}</span>
          </>
        ) : null}
      </span>
    ) : null;
  const renderProcessEntry = (item: InlineProcessItem, index: number) => {
    // A delegated child Agent keeps its card at the exact point of the timeline
    // where the delegation happened instead of floating above the whole panel.
    const inlineAgentTask = renderInlineAgentTask?.(item);
    if (inlineAgentTask) {
      return <Fragment key={processItemKey(item, index)}>{inlineAgentTask}</Fragment>;
    }
    return (
      <ProcessEntry
        key={`${runId ?? 'current'}:${processItemKey(item, index)}`}
        item={item}
        index={index}
        streaming={streaming && !terminalState && !waitingForApproval}
        liveClock={liveClock}
        now={clockNow}
        expandedItemKeys={expandedItemKeys}
        toggleItem={toggleItem}
        keepItemOpen={keepItemOpen}
        onOpenChange={onOpenChange}
      />
    );
  };
  return (
    <ConversationContentScope.Provider value={conversationId}>
      <ToolFileChangesContext.Provider value={fileChangesContext}>
      <AgentActivityStateContext.Provider value={activityState}>
      <section
        className="shell-process-panel shell-harness-trace shell-agent-activity-panel shell-task-list-flow"
        data-activity-state={activityState}
        data-testid="process-panel"
        data-streaming={streaming ? '1' : '0'}
        data-failed={failedToolCount > 0 ? 'true' : 'false'}
      >
        <div className="shell-process-panel__header">
          {collapsible ? (
            <button
              type="button"
              className="shell-process-panel__toggle"
              data-testid="process-panel-toggle"
              aria-expanded={panelOpen}
              onClick={togglePanel}
            >
              <span className="shell-process-panel__title">执行过程</span>
              <AgentActivityStatus state={activityState} hasFailures={failedToolCount > 0} />
              {processMeta}
              <ChevronDown
                size={13}
                className={`shell-process-panel__chevron${panelOpen ? ' is-open' : ''}`}
                aria-hidden="true"
              />
            </button>
          ) : (
            <div className="shell-process-panel__heading">
              <span className="shell-process-panel__title">执行过程</span>
              <AgentActivityStatus state={activityState} hasFailures={failedToolCount > 0} />
              {processMeta}
            </div>
          )}
          <ThinkVisibilitySwitch checked={showThinking} onChange={onShowThinkingChange} />
        </div>
        {/*
          Terminal / pause notice sits ABOVE the step list. It used to render
          after the body, which buried it under every tool row — a 4-minute run
          with a dozen commands put "why it stopped" far below the fold, so a
          provider outage looked like a silent stop.
        */}
        {supplementalContent ? (
          <div className="shell-process-panel__supplemental">{supplementalContent}</div>
        ) : null}
        {panelOpen ? (
          <div className="shell-process-panel__body" data-testid="process-panel-body">
            <AgentActivityViewport state={activityState} runId={runId} onInspect={keepPanelOpen}>
            {pageControls}
            {agentTaskContent ? (
              <section className="shell-process-agent-tasks" data-testid="process-agent-tasks">
                <div className="shell-process-agent-tasks__header">
                  <Users size={13} aria-hidden="true" />
                  <span>智能体任务</span>
                </div>
                <div className="shell-process-agent-tasks__body">{agentTaskContent}</div>
              </section>
            ) : null}
            {orderedItems.length > 0 ? (
              <div className="shell-inline-process" data-testid="inline-process-flow">
                {timelineBlocks.map((block) => {
                  if (block.kind === 'item') return renderProcessEntry(block.item, block.index);
                  if (block.kind === 'web') return <Suspense key={block.key} fallback={<div role="status">载入搜索过程…</div>}><WebSearchToolTrail items={block.entries.map(e=>e.item)} conversationId={conversationId} settled={settled || activityState === 'complete'}/></Suspense>;
                  const open = openToolRuns.has(block.key);
                  return (
                    <ProcessActionSummary
                      key={block.key}
                      summary={activityState === 'working' && block.entries.some(entry => toolStatusOf(entry.item) === 'running')
                        ? friendlyToolName(block.entries.find(entry => toolStatusOf(entry.item) === 'running')!.item.name) + '…' : block.summary}
                      running={activityState === 'working' && block.entries.some(entry => toolStatusOf(entry.item) === 'running')}
                      iconKind={block.entries.some(entry => toolVisualKind(entry.item.name) === 'write') ? 'file'
                        : block.entries.some(entry => ['command', 'git'].includes(toolVisualKind(entry.item.name))) ? 'command' : 'search'}
                      open={open}
                      onToggle={() => toggleToolRun(block.key)}
                    >
                      {open
                        ? block.entries.map((entry) => renderProcessEntry(entry.item, entry.index))
                        : null}
                    </ProcessActionSummary>
                  );
                })}
              </div>
            ) : null}
            {/* 补页是后台行为：过程中不插任何「正在读取 / 继续加载」提示（NewMax 从
                不暴露这一步，读者只该看到步骤本身）。只有真的读失败才给一次重试。 */}
            {timelineLoadState === 'error' ? (
              <div className="shell-process-panel__load-error" role="status" title={timelineLoadError}>
                <span>{timelineLoadFailureMessage(timelineLoadError)}，已显示的步骤会保留。</span>
                <button
                  type="button"
                  className="shell-process-panel__lazy-retry"
                  onClick={onRetryTimelineLoad}
                >
                  <RotateCw size={12} aria-hidden="true" />
                  <span>重新加载完整执行过程</span>
                </button>
              </div>
            ) : null}
            </AgentActivityViewport>
          </div>
        ) : null}
        {activity && !researchOwnsActivity ? (
          <ProcessActivityRow activity={activity} stall={stall} elapsed={durationLabel} />
        ) : null}
      </section>
      </AgentActivityStateContext.Provider>
      </ToolFileChangesContext.Provider>
    </ConversationContentScope.Provider>
  );
});
