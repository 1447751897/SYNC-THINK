import type { PendingToolApproval } from './ToolApprovalCard.js';
import {
  commandDisplayFromArguments,
  friendlyToolName,
  toolVisualKind,
} from './process-activity.js';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function proposedChanges(args: Record<string, unknown>) {
  const item = record(args.item);
  const source = args.changes ?? args.files ?? item?.changes ?? item?.files;
  const entries: [string | undefined, unknown][] = Array.isArray(source)
    ? source.map((value) => [undefined, value])
    : Object.entries(record(source) ?? {});
  return entries.flatMap(([fallbackPath, value]) => {
    const change = record(value);
    const path =
      text(change?.path) ?? text(change?.file) ?? text(change?.file_path) ?? fallbackPath;
    if (!path) return [];
    const kind = text(change?.kind) ?? text(record(change?.kind)?.type) ?? text(change?.type);
    const diff = text(change?.diff) ?? text(change?.unified_diff) ?? text(change?.unifiedDiff);
    const content = text(change?.content);
    return [{ path, kind, diff, content }];
  });
}

// Read literal PowerShell path arguments without interpreting strings as code.
// Variables and expressions are intentionally left to the full command preview.
function commandPaths(code: string, language: string): string[] {
  if (language !== 'powershell') return [];
  const tokens = code.match(/'(?:''|[^'])*'|"(?:`.|[^"`])*"|[^\s;|]+|[;|]/g) ?? [];
  const paths: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!/^-LiteralPath$|^-Path$/i.test(tokens[i])) continue;
    const raw = tokens[++i];
    if (!raw || /^[;|]$/.test(raw)) continue;
    const single = raw.startsWith("'") && raw.endsWith("'");
    const double = raw.startsWith('"') && raw.endsWith('"');
    const value = single ? raw.slice(1, -1).replace(/''/g, "'") : double ? raw.slice(1, -1) : raw;
    if (
      !value ||
      (!single && /[$`(){}]/.test(value)) ||
      (!single && !double && value.startsWith('-'))
    )
      continue;
    if (!paths.includes(value)) paths.push(value);
  }
  return paths;
}

const PARAMETER_LABELS: Record<string, string> = {
  query: '搜索内容',
  search: '搜索内容',
  pattern: '匹配内容',
  replace_all: '替换范围',
  method: '请求方式',
  selector: '页面元素',
  text: '操作文本',
  button: '点击按钮',
  key: '按键',
  keys: '按键组合',
  direction: '滚动方向',
  amount: '数量',
  currency: '币种',
  subject: '主题',
  body: '正文',
  message: '消息内容',
  name: '名称',
  title: '名称',
};

/** This is a display projection only; approval decisions still carry the original request id. */
export function approvalPresentation(approval: PendingToolApproval) {
  const args = approval.arguments ?? {};
  const item = record(args.item);
  const changes = proposedChanges(args);
  const command = commandDisplayFromArguments(
    JSON.stringify({
      ...item,
      ...args,
      ...(approval.command ? { command: approval.command } : {}),
    }),
  );
  const kind = command ? 'command' : toolVisualKind(approval.toolName);
  const path =
    approval.path ??
    text(args.file_path) ??
    text(args.path) ??
    text(args.file) ??
    text(args.filename);
  const diff = text(args.diff) ?? text(args.unified_diff);
  const before = typeof args.old_string === 'string' ? args.old_string : undefined;
  const after = typeof args.new_string === 'string' ? args.new_string : undefined;
  const replacement = before !== undefined && after !== undefined;
  const content = text(args.content) ?? text(args.contents) ?? text(args.patch) ?? text(args.input);
  const reason = text(approval.reason) ?? text(args.reason) ?? text(args.justification);
  const literalPaths = command ? commandPaths(command.code, command.language) : [];
  const firstCommand = command?.code
    .trim()
    .match(/^([a-z]+-[a-z]+)/i)?.[1]
    ?.toLowerCase();
  const isWriteCommand =
    command?.language === 'powershell' &&
    ['set-content', 'add-content', 'out-file'].includes(firstCommand ?? '');
  const meaningfulTitle =
    text(approval.title) &&
    approval.title !== approval.toolName &&
    !approval.title.includes(approval.toolName) &&
    !/^需要批准[：:]|^工具调用$/.test(approval.title);
  const title = meaningfulTitle
    ? approval.title
    : command
      ? isWriteCommand
        ? '通过命令写入文件'
        : '执行命令'
      : changes.length > 1
        ? '编辑 ' + changes.length + ' 个文件'
        : kind === 'write'
          ? friendlyToolName(approval.toolName)
          : /computer[_-]|computer-use/i.test(approval.toolName)
            ? '操作电脑应用'
            : kind === 'browser'
              ? '访问网页'
              : kind === 'read'
                ? '读取文件'
                : kind === 'list'
                  ? '查看文件列表'
                  : kind === 'search'
                    ? '搜索内容'
                    : '使用工具';
  const commandValues = [
    approval.command,
    text(args.command),
    text(args.cmd),
    text(item?.command),
    command?.code,
  ].filter(Boolean);
  const descriptionCandidate = text(args.description) ?? text(approval.detail);
  const descriptionCommand = descriptionCandidate
    ? commandDisplayFromArguments(JSON.stringify({ command: descriptionCandidate }))?.code
    : undefined;
  const description =
    descriptionCandidate &&
    !/^[{[]/.test(descriptionCandidate.trim()) &&
    descriptionCandidate !== '需要你的批准' &&
    descriptionCandidate !== reason &&
    descriptionCandidate !== title &&
    descriptionCandidate !== approval.toolName &&
    descriptionCandidate !== path &&
    !commandValues.includes(descriptionCandidate) &&
    !(command && descriptionCommand === command.code)
      ? descriptionCandidate
      : undefined;
  const targets: { label: string; value: string }[] = [];
  const paths = path
    ? [path]
    : changes.length
      ? changes.map((change) => change.path)
      : literalPaths;
  if (paths.length)
    targets.push({
      label: command
        ? '涉及路径'
        : paths.length > 1
          ? '目标文件'
          : kind === 'list'
            ? '目标目录'
            : '目标文件',
      value: [...new Set(paths)].join('\n'),
    });
  const url = text(args.url) ?? text(args.startUrl) ?? text(args.uri);
  if (url) targets.push({ label: '目标网址', value: url });
  const app = text(args.app_id) ?? text(args.app) ?? text(args.application);
  if (app) targets.push({ label: '目标应用', value: app });
  const recipient = text(args.recipient) ?? text(args.to);
  if (recipient) targets.push({ label: '接收对象', value: recipient });
  const parameters = command
    ? []
    : Object.entries(args).flatMap(([key, value]) => {
        const label = Object.hasOwn(PARAMETER_LABELS, key) ? PARAMETER_LABELS[key] : undefined;
        if (
          !label ||
          value === null ||
          value === undefined ||
          (typeof value === 'object' && !Array.isArray(value))
        )
          return [];
        if (Array.isArray(value) && value.some((v) => typeof v === 'object')) return [];
        const display =
          key === 'replace_all' && typeof value === 'boolean'
            ? value
              ? '全部匹配位置'
              : '仅替换一处'
            : Array.isArray(value)
              ? value.map(String).join('、')
              : String(value);
        return [{ label, value: display }];
      });
  const hasDetails = Boolean(
    command || diff || changes.length || replacement || content || parameters.length,
  );
  const detailLabel = command
    ? '命令'
    : diff || changes.length || replacement
      ? '文件变更'
      : content
        ? '拟写入内容'
        : '操作详情';
  return {
    title,
    reason,
    description,
    targets,
    parameters,
    command,
    path,
    diff,
    changes,
    replacement,
    before,
    after,
    content,
    hasDetails,
    detailLabel,
    toolLabel: title === '使用工具' ? friendlyToolName(approval.toolName) : undefined,
  };
}
