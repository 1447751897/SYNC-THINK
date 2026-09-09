/**
 * "正在发生什么" 的派生状态，供 DSH 式执行过程面板使用。
 *
 * 全部是对有序过程项的纯投影：面板头部因此能在 Run 结束之前就回答
 * 「现在跑的是哪个工具」和「这是卡住了还是还在跑」。工具命名与参数摘要
 * 也集中在这里，保证面板头部的活动摘要和工具行的文字永远一致。
 */
import { isToolResultFailure, normalizeToolName } from '@sync-think/shared';
import type { InlineProcessItem } from './ChatView.js';

type ToolItem = Extract<InlineProcessItem, { kind: 'tool' }>;

export type ProcessToolVisualKind =
  'read' | 'write' | 'list' | 'command' | 'git' | 'browser' | 'search' | 'mcp' | 'other';

const TOOL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  read: '读取文件',
  read_file: '读取文件',
  write: '写入文件',
  write_file: '写入文件',
  edit: '编辑文件',
  edit_file: '编辑文件',
  apply_patch: '编辑文件',
  file_change: '编辑文件',
  bash: '运行命令',
  execute_command: '运行命令',
  exec_command: '运行命令',
  run_command: '运行命令',
  read_command: '等待命令',
  list_commands: '查看命令会话',
  stop_command: '停止命令',
  command_execution: '命令执行',
  list_files: '查看目录',
  glob: '查找文件',
  grep: '搜索内容',
  search_query: '搜索网页',
  web_search: '搜索网页',
  web_fetch: '获取网页',
  open: '打开网页',
  view_image: '查看图片',
  generate_image: '生成图片',
};

export function friendlyToolName(name: string): string {
  const trimmed = name.trim();
  const mcp = /^mcp__([a-z0-9-]+)__([a-z0-9_]+)$/i.exec(trimmed);
  if (mcp?.[1] === 'capability-broker') {
    return `capability-broker · ${mcp[2].replace(/_/g, ' ')}`;
  }
  const normalized = normalizeToolName(trimmed).toLowerCase();
  if (normalized === 'search_capability') return 'capability-broker · search capability';
  if (normalized === 'use_capability') return 'capability-broker · use capability';
  const exact = TOOL_DISPLAY_NAMES[normalized];
  if (exact) return exact;
  const suffix = normalized.split(/[.:/]/).at(-1) ?? normalized;
  const mapped = TOOL_DISPLAY_NAMES[suffix];
  if (mapped) return mapped;
  return (
    suffix
      .split(/[_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || '工具'
  );
}

function actionFileKey(item: ToolItem, bucket: 'read' | 'write' | 'list'): string {
  const summary = toolInputSummary(item);
  if (summary) return `${bucket}:${summary}`;
  return `${bucket}:${item.toolCallId ?? item.name}`;
}

/**
 * 执行过程里给用户看的动作盘点：探索/编辑按路径去重，搜索和命令按调用次数。
 * 零次的类别直接省略，避免「探索了 0 个文件」这种空话。
 */
export function summarizeProcessActions(items: readonly InlineProcessItem[]): string | undefined {
  const explored = new Set<string>();
  const edited = new Set<string>();
  let searches = 0;
  let commands = 0;
  let browses = 0;
  let other = 0;

  for (const item of items) {
    if (item.kind !== 'tool' || toolStatusOf(item) !== 'completed') continue;
    const kind = toolVisualKind(item.name);
    if (kind === 'read' || kind === 'list') {
      explored.add(actionFileKey(item, kind === 'list' ? 'list' : 'read'));
    } else if (kind === 'write') {
      edited.add(actionFileKey(item, 'write'));
    } else if (kind === 'search') {
      searches += 1;
    } else if (kind === 'command' || kind === 'git') {
      commands += 1;
    } else if (kind === 'browser') {
      browses += 1;
    } else {
      other += 1;
    }
  }

  const parts: string[] = [];
  if (explored.size > 0) parts.push(`探索了 ${explored.size} 个文件`);
  if (edited.size > 0) parts.push(`编辑了 ${edited.size} 个文件`);
  if (searches > 0) parts.push(`搜索了 ${searches} 次`);
  if (commands > 0) parts.push(`运行了 ${commands} 个命令`);
  if (browses > 0) parts.push(`浏览了 ${browses} 次`);
  if (other > 0) parts.push(`调用了 ${other} 个工具`);
  return parts.length > 0 ? parts.join('，') : undefined;
}

export type ConsecutiveProcessItemBlock = {
  kind: 'item';
  index: number;
  item: InlineProcessItem;
};

export type ConsecutiveProcessToolBlock = {
  kind: 'tools';
  key: string;
  summary: string;
  entries: Array<{ index: number; item: Extract<InlineProcessItem, { kind: 'tool' }> }>;
};

export type ConsecutiveProcessBlock = ConsecutiveProcessItemBlock | ConsecutiveProcessToolBlock;

const MIN_CONSECUTIVE_TOOLS_TO_FOLD = 2;

/**
 * 只折叠被思考 / 说明 / 状态隔开的连续工具段。整轮不收成一条总摘要；
 * 单独一条工具仍直接出现在时间线里。
 */
export function groupConsecutiveProcessTools(
  items: readonly InlineProcessItem[],
): ConsecutiveProcessBlock[] {
  const blocks: ConsecutiveProcessBlock[] = [];
  let pending: ConsecutiveProcessToolBlock['entries'] = [];

  const flushPending = () => {
    if (pending.length === 0) return;
    if (pending.length < MIN_CONSECUTIVE_TOOLS_TO_FOLD) {
      for (const entry of pending) {
        blocks.push({ kind: 'item', index: entry.index, item: entry.item });
      }
    } else {
      const first = pending[0]!;
      const summary =
        summarizeProcessActions(pending.map((entry) => entry.item)) ??
        `运行了 ${pending.length} 个命令`;
      blocks.push({
        kind: 'tools',
        key: first.item.toolCallId
          ? `tool-run:${first.item.toolCallId}`
          : `tool-run:${first.item.id ?? first.index}`,
        summary,
        entries: pending,
      });
    }
    pending = [];
  };

  items.forEach((item, index) => {
    if (item.kind === 'tool') {
      pending.push({ index, item });
      return;
    }
    flushPending();
    blocks.push({ kind: 'item', index, item });
  });
  flushPending();
  return blocks;
}

/** Stable visual category for the compact icon shown on each tool row. */
export function toolVisualKind(name: string): ProcessToolVisualKind {
  const normalized = normalizeToolName(name.trim()).toLowerCase();
  if (/^(read|read_file|file_read|view_image)$/.test(normalized)) return 'read';
  if (/^(write|write_file|file_write|edit|edit_file|apply_patch|file_change)$/.test(normalized)) {
    return 'write';
  }
  if (/^(list_files|file_list|glob)$/.test(normalized)) return 'list';
  if (/^(bash|execute_command|exec_command|run_command|command_execution)$/.test(normalized)) {
    return 'command';
  }
  if (normalized.startsWith('git_')) return 'git';
  if (/^(search_query|web_search|search_web|grep|file_search)$/.test(normalized)) return 'search';
  if (/^(open|web_fetch|browser_)/.test(normalized)) return 'browser';
  if (name.trim().toLowerCase().startsWith('mcp__')) return 'mcp';
  return 'other';
}

export function isGenerateImageToolName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === 'generate_image') return true;
  return /^mcp__[a-z0-9-]+__generate_image$/i.test(trimmed);
}

export function isUseCapabilityToolName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === 'use_capability') return true;
  return /^mcp__[a-z0-9-]+__use_capability$/i.test(trimmed);
}

export function isImageGenerationActivity(item: {
  name: string;
  argumentsJson?: string;
  result?: string;
}): boolean {
  if (isGenerateImageToolName(item.name)) return true;
  if (!isUseCapabilityToolName(item.name)) return false;
  if (extractGeneratedImageSrc(item.result ?? '')) return true;
  try {
    const parsed = JSON.parse(item.argumentsJson || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    let inner: unknown = record.arguments ?? record;
    if (typeof inner === 'string') inner = JSON.parse(inner) as unknown;
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return false;
    const prompt = (inner as Record<string, unknown>).prompt;
    return typeof prompt === 'string' && prompt.trim().length > 0;
  } catch {
    return false;
  }
}

export function extractGeneratedImageSrc(markdown: string): string | null {
  const match = /!\[[^\]]*]\((sync-think-image:\/\/generated\/[^)\s]+)\)/.exec(markdown);
  return match?.[1] ?? null;
}

function compactValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.slice(0, 3).map(compactValue).filter(Boolean).join(', ');
  return undefined;
}

/**
 * `run_command` 的参数是 `{command, args[], cwd}`——只读 `command` 会把
 * 「pnpm -s test」显示成「pnpm」，等于看不出在跑什么。命令行必须连着参数
 * 一起还原，这是「现在在执行什么」的全部信息量所在。
 */
export function formatCommandLine(command: string, args?: unknown): string {
  const head = command.trim();
  if (!Array.isArray(args)) return head;
  const tail = args
    .filter((arg): arg is string => typeof arg === 'string')
    .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
    .filter(Boolean);
  return [head, ...tail].filter(Boolean).join(' ');
}

const SUMMARY_MAX = 120;

function clampToolSummary(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 3)}…` : text;
}

export function toolInputSummary(item: ToolItem): string {
  if (item.inputSummary?.trim()) return item.inputSummary.trim();
  const raw = item.argumentsJson.trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      let nested = record.arguments;
      if (typeof nested === 'string') {
        try {
          nested = JSON.parse(nested) as unknown;
        } catch {
          nested = undefined;
        }
      }
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        const prompt = compactValue((nested as Record<string, unknown>).prompt);
        if (prompt) return clampToolSummary(prompt);
      }
      for (const key of [
        'path',
        'file_path',
        'cmd',
        'command',
        'query',
        'url',
        'pattern',
        'target',
        'prompt',
      ]) {
        const value = compactValue(record[key]);
        if (!value) continue;
        // 命令类参数带上 argv，其余键按原样摘要。
        const summary =
          key === 'command' || key === 'cmd' ? formatCommandLine(value, record.args) : value;
        return clampToolSummary(summary);
      }
      const first = Object.entries(record).find(([, value]) => compactValue(value));
      if (first) {
        const value = compactValue(first[1]) ?? '';
        return clampToolSummary(`${first[0]}: ${value}`);
      }
    }
  } catch {
    // Raw non-JSON arguments are already the most useful compact summary.
  }
  return clampToolSummary(raw);
}

/** 面板头部的活动摘要要短，工具行才展示完整参数。 */
const ACTIVITY_SUMMARY_MAX = 48;

function latestNonEmptyLine(text: string): string {
  return (
    text
      .split('\n')
      .filter((part) => part.trim())
      .at(-1)
      ?.trim() ?? ''
  );
}

function stripActivityMarkdown(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s{0,3}[-*+]\s+/, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .trim();
}

/** Bottom activity uses the same latest Think line the Think row would show. */
export function thinkingActivityLabel(text: string): string {
  const line = stripActivityMarkdown(latestNonEmptyLine(text));
  return line ? clampSummary(line) : '思考中';
}

/**
 * 摘要过长时保留尾部：命令的可执行文件名信息量最低（`pnpm`、`node`），
 * 真正区分「在跑什么」的是后面的子命令与参数；路径同理，文件名在末尾。
 */
function clampSummary(text: string): string {
  if (text.length <= ACTIVITY_SUMMARY_MAX) return text;
  return `…${text.slice(-(ACTIVITY_SUMMARY_MAX - 1))}`;
}

/** 中文时长，与面板头部总耗时同一套格式。 */
export function formatElapsedZh(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

export function toolStatusOf(item: ToolItem): 'running' | 'completed' | 'failed' {
  if (item.failed || item.status === 'failed' || isToolResultFailure(item.result)) {
    return 'failed';
  }
  return item.status ?? (item.result !== undefined ? 'completed' : 'running');
}

export type ProcessActivityKind =
  'tool' | 'thinking' | 'answering' | 'status' | 'waiting' | 'approval';

export interface ProcessActivity {
  kind: ProcessActivityKind;
  /** 用户可读的当前动作，如「运行命令 pnpm test」。 */
  label: string;
  /** running 工具的 toolCallId，便于把摘要和具体行对应起来。 */
  toolCallId?: string;
  /** 该活动的起始时间（ISO）。 */
  since?: string;
}

/**
 * 当前活动。优先级从「最具体」到「最兜底」：运行中的工具 → 思考 → 正在回复
 * → 运行状态 → 等待模型响应。终态返回 undefined。
 */
export function deriveCurrentActivity(
  items: readonly InlineProcessItem[],
  input: { streaming?: boolean; waitingForApproval?: boolean },
): ProcessActivity | undefined {
  if (input.waitingForApproval) return { kind: 'approval', label: '等待你的批准' };
  if (!input.streaming) return undefined;

  // 运行中的工具是对「在做什么」最具体的回答，即使它不是最后一项
  // （工具执行期间模型可能已经吐出后续说明文字）。
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.kind !== 'tool' || toolStatusOf(item) !== 'running') continue;
    const name = item.displayName?.trim() || friendlyToolName(item.name);
    const summary = toolInputSummary(item);
    return {
      kind: 'tool',
      label: summary ? `${name} ${clampSummary(summary)}` : name,
      ...(item.toolCallId ? { toolCallId: item.toolCallId } : {}),
      ...(item.startedAt ? { since: item.startedAt } : {}),
    };
  }

  const last = items.at(-1);
  if (last?.kind === 'reasoning') {
    return { kind: 'thinking', label: thinkingActivityLabel(last.text) };
  }
  if ((last?.kind === 'text' || last?.kind === 'commentary') && last.status !== 'completed') {
    return { kind: 'answering', label: '正在回复' };
  }
  if (last?.kind === 'status') return { kind: 'status', label: last.label };

  const lastReasoning = [...items]
    .reverse()
    .find((item) => item.kind === 'reasoning' && item.text.trim());
  if (lastReasoning?.kind === 'reasoning') {
    return { kind: 'thinking', label: thinkingActivityLabel(lastReasoning.text) };
  }

  // 请求已发出但首个 token 还没到，或一轮结束后模型还在决定下一步。
  return { kind: 'waiting', label: '等待模型响应' };
}

export type ProcessStallLevel = 'active' | 'slow' | 'stalled';

export interface ProcessStallState {
  level: ProcessStallLevel;
  idleMs: number;
  hint?: string;
}

/**
 * 工具执行本身可能就很慢（build / test 跑几分钟是正常的），所以工具活动的
 * 阈值放得很宽，措辞也保持中性——不能把正常的长命令说成「卡住」。
 */
const TOOL_SLOW_MS = 120_000;
const TOOL_STALLED_MS = 300_000;
/** 没有工具在跑却什么都收不到，才是真正可疑的情况。 */
const IDLE_SLOW_MS = 15_000;
const IDLE_STALLED_MS = 60_000;

export function deriveStallState(input: {
  activity?: ProcessActivity;
  /** 最后一次可见进展的时间戳（毫秒）。 */
  lastProgressAt: number;
  now: number;
}): ProcessStallState {
  const idleMs = Math.max(0, input.now - input.lastProgressAt);
  if (!input.activity || input.activity.kind === 'approval') return { level: 'active', idleMs };
  const patient = input.activity.kind === 'tool';
  const stalledAt = patient ? TOOL_STALLED_MS : IDLE_STALLED_MS;
  const slowAt = patient ? TOOL_SLOW_MS : IDLE_SLOW_MS;
  if (idleMs >= stalledAt) return { level: 'stalled', idleMs, hint: '长时间无输出' };
  if (idleMs >= slowAt) return { level: 'slow', idleMs };
  return { level: 'active', idleMs };
}

/**
 * 「有没有新进展」的廉价指纹。任何可见变化（新项、文本增长、工具状态翻转、
 * 工具进度推进）都会改变它，用来刷新 lastProgressAt。
 */
export function activityFingerprint(items: readonly InlineProcessItem[]): string {
  const parts: string[] = [String(items.length)];
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    if (toolStatusOf(item) !== 'running') continue;
    parts.push(
      `r:${item.toolCallId ?? item.name}:${item.progressBytes ?? 0}:${item.progressLine ?? ''}`,
    );
  }
  const last = items.at(-1);
  if (last) {
    parts.push(last.kind);
    if (last.kind === 'tool') {
      parts.push(last.toolCallId ?? last.name, toolStatusOf(last));
    } else if (last.kind === 'status') {
      parts.push(last.label, last.detail ?? '');
    } else {
      parts.push(String(last.text.length), last.status ?? '');
    }
  }
  return parts.join('|');
}
