import {
  parseAutomationAcceptanceChecks,
  type AutomationAcceptanceChecks,
} from '../automation-acceptance.js';
/**
 * 定时任务（ScheduledTask）领域类型。
 *
 * 任务 = 绑定执行者（智能体 / 直接模型）的专属会话 + 触发规则（at / every /
 * random / cron）+ 触发时注入的指令。nextRunAt 持久化，runtime 心跳检查到期，
 * 触发 = 向任务专属会话注入用户消息启动普通 run。
 */

export type ScheduledTaskTarget =
  | { kind: 'agent'; agentId: string }
  | { kind: 'model'; modelId: string }
  | { kind: 'team'; teamId: string };

/** 单次触发。 */
export interface TaskRuleAt {
  kind: 'at';
  /** ISO 时间（任务时区语义由 timeZone 承载；存 UTC 绝对时刻）。 */
  runAt: string;
}

/** 固定间隔周期（分钟，≥5）。 */
export interface TaskRuleEvery {
  kind: 'every';
  intervalMinutes: number;
  /** 首次触发时间（可为过去，则按间隔推算下一次）。 */
  firstRunAt?: string;
  /** 每天时段窗口（任务时区 HH:mm）：窗口内才按间隔触发，窗口外顺延到下一窗口开始。 */
  windowStart?: string;
  windowEnd?: string;
}

/** 随机任务：每天时间窗内随机触发 minTimes..maxTimes 次。 */
export interface TaskRuleRandom {
  kind: 'random';
  /** 每天窗口起止（HH:mm，任务时区）。 */
  windowStart: string;
  windowEnd: string;
  minTimes: number;
  maxTimes: number;
  /** 是否每天至少一次（false 时随机次数可为 0）。 */
  atLeastOnce?: boolean;
}

/** cron 表达式（croner 语法，任务时区）。 */
export interface TaskRuleCron {
  kind: 'cron';
  expression: string;
}

/** ISO weekday numbers: Monday=1, Sunday=7. Ranges include both ends and may wrap. */
export type WeeklyDaySelection =
  { mode: 'days'; days: number[] } | { mode: 'range'; start: number; end: number };

/** Once on each selected weekday, at a wall-clock time in the task timezone. */
export interface TaskRuleWeekly {
  kind: 'weekly';
  selection: WeeklyDaySelection;
  /** HH:mm, interpreted in ScheduledTask.timeZone. */
  time: string;
  /** Inclusive YYYY-MM-DD in ScheduledTask.timeZone. */
  startDate: string;
}

export type TaskRule = TaskRuleAt | TaskRuleEvery | TaskRuleWeekly | TaskRuleRandom | TaskRuleCron;

export type ScheduledTaskRunStatus =
  'success' | 'failed' | 'skipped' | 'cancelled' | 'waiting_input' | 'blocked' | 'reconciling';

/** 最近一次执行结果（也用于历史记录）。 */
export interface ScheduledTaskRunResult {
  status: ScheduledTaskRunStatus;
  runId?: string;
  /** 触发时间（UTC）。 */
  firedAt: string;
  /** 失败/跳过原因摘要。 */
  reason?: string;
}

/** Explicit expected capabilities. These bindings are not execution/delivery results. */
export interface ScheduledTaskAutomation {
  /** Task-local permission choice; present automation defaults to workspace, not global trust. */
  executionMode?: 'ask' | 'workspace' | 'full-access';
  /** Missing = reuse the task's dedicated conversation (legacy behavior). */
  conversation?: ScheduledTaskConversationTarget;
  browser?: {
    profileId: string;
    workflowTaskId?: string;
    /** Non-sensitive workflow inputs only; credentials stay in the profile/secure store. */
    variables?: Record<string, string>;
  };
  requiredMcpServerIds?: string[];
  outputs?: Array<'spreadsheet' | 'presentation'>;
  delivery?: {
    kind: 'gmail';
    mcpServerId: string;
    recipient: string;
    /** Exact tool selected by the user; connector/server names are not capability metadata. */
    toolName?: string;
  };
  acceptance?: string;
  /** Host-enforced checks on actual export input, independently of prose. */
  acceptanceChecks?: AutomationAcceptanceChecks;
}

export type ScheduledTaskConversationTarget =
  | { mode: 'task' }
  | { mode: 'new' }
  | { mode: 'existing'; conversationId: string };

/** Shared validation for protocol, SQLite writes and daemon dispatch. No instruction inference. */
export function parseScheduledTaskAutomation(value: unknown): ScheduledTaskAutomation | undefined {
  const record = (item: unknown): item is Record<string, unknown> =>
    item !== null &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null);
  const only = (item: Record<string, unknown>, keys: readonly string[]): boolean =>
    Object.keys(item).every((key) => keys.includes(key));
  const id = (item: unknown): item is string =>
    typeof item === 'string' &&
    item.trim().length > 0 &&
    // eslint-disable-next-line no-control-regex -- Persisted identifiers intentionally reject control bytes.
    !/[\s\u0000-\u001f\u007f]/u.test(item.trim());
  if (
    !record(value) ||
    !only(value, [
      'executionMode',
      'conversation',
      'browser',
      'requiredMcpServerIds',
      'outputs',
      'delivery',
      'acceptance',
      'acceptanceChecks',
    ])
  )
    return undefined;
  const executionMode = value.executionMode === undefined ? 'workspace' : value.executionMode;
  if (executionMode !== 'ask' && executionMode !== 'workspace' && executionMode !== 'full-access')
    return undefined;
  const result: ScheduledTaskAutomation = { executionMode };
  if (value.conversation !== undefined) {
    const conversation = value.conversation;
    if (!record(conversation)) return undefined;
    if (conversation.mode === 'task' || conversation.mode === 'new') {
      if (!only(conversation, ['mode'])) return undefined;
      result.conversation = { mode: conversation.mode };
    } else if (conversation.mode === 'existing') {
      if (!only(conversation, ['mode', 'conversationId']) || !id(conversation.conversationId)) return undefined;
      result.conversation = { mode: 'existing', conversationId: conversation.conversationId.trim() };
    } else return undefined;
  }
  if (value.browser !== undefined) {
    const browser = value.browser;
    if (
      !record(browser) ||
      !only(browser, ['profileId', 'workflowTaskId', 'variables']) ||
      !id(browser.profileId)
    )
      return undefined;
    result.browser = { profileId: browser.profileId.trim() };
    if (browser.workflowTaskId !== undefined) {
      if (!id(browser.workflowTaskId)) return undefined;
      result.browser.workflowTaskId = browser.workflowTaskId.trim();
    }
    if (browser.variables !== undefined) {
      if (!record(browser.variables) || Object.keys(browser.variables).length > 50)
        return undefined;
      const entries = Object.entries(browser.variables);
      if (
        !entries.every(
          ([key, text]) =>
            key.trim().length > 0 &&
            !/password|cookie|token|secret/i.test(key) &&
            typeof text === 'string' &&
            text.length <= 4_000,
        )
      )
        return undefined;
      result.browser.variables = Object.fromEntries(entries) as Record<string, string>;
    }
  }
  if (value.requiredMcpServerIds !== undefined) {
    if (
      !Array.isArray(value.requiredMcpServerIds) ||
      !Array.from(value.requiredMcpServerIds).every(id)
    )
      return undefined;
    result.requiredMcpServerIds = [
      ...new Set(value.requiredMcpServerIds.map((item) => item.trim())),
    ];
  }
  if (value.outputs !== undefined) {
    if (
      !Array.isArray(value.outputs) ||
      !Array.from(value.outputs).every(
        (output) => output === 'spreadsheet' || output === 'presentation',
      )
    )
      return undefined;
    result.outputs = [...new Set(value.outputs)] as NonNullable<ScheduledTaskAutomation['outputs']>;
  }
  if (value.delivery !== undefined) {
    const delivery = value.delivery;
    if (
      !record(delivery) ||
      !only(delivery, ['kind', 'mcpServerId', 'recipient', 'toolName']) ||
      delivery.kind !== 'gmail' ||
      !id(delivery.mcpServerId) ||
      (delivery.toolName !== undefined && !id(delivery.toolName)) ||
      typeof delivery.recipient !== 'string' ||
      !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(delivery.recipient.trim())
    )
      return undefined;
    result.delivery = {
      kind: 'gmail',
      mcpServerId: delivery.mcpServerId.trim(),
      recipient: delivery.recipient.trim(),
      ...(delivery.toolName !== undefined ? { toolName: delivery.toolName.trim() } : {}),
    };
  }
  if (value.acceptance !== undefined) {
    if (typeof value.acceptance !== 'string') return undefined;
    result.acceptance = value.acceptance;
  }
  if (value.acceptanceChecks !== undefined) {
    const checks = parseAutomationAcceptanceChecks(value.acceptanceChecks);
    if (!checks) return undefined;
    const needsSheet =
      checks.minimumRows !== undefined ||
      checks.requiredColumns !== undefined ||
      checks.dateColumn !== undefined ||
      checks.sourceUrlColumn !== undefined;
    if (
      (needsSheet && !result.outputs?.includes('spreadsheet')) ||
      (checks.minimumSlides !== undefined && !result.outputs?.includes('presentation'))
    )
      return undefined;
    result.acceptanceChecks = checks;
  }
  return result;
}

/** Compatibility alias for callers using the protocol parser naming convention. */
export const tryParseScheduledTaskAutomation = parseScheduledTaskAutomation;

export interface ScheduledTask {
  id: string;
  name: string;
  instruction: string;
  target: ScheduledTaskTarget;
  rule: TaskRule;
  timeZone: string;
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  lastResult?: ScheduledTaskRunResult;
  /** 任务专属会话 id（触发时惰性创建）。 */
  conversationId?: string;
  /** 绑定工作区 id；缺省 = 全局任务（收件箱工作区上下文执行）。 */
  workspaceId?: string;
  /** 触发时注入的 skill 版本 id（空数组 = 不注入）。 */
  skillVersionIds?: string[];
  /** Optional structured capability bindings, independent of the free-form instruction. */
  automation?: ScheduledTaskAutomation;
  createdAt: string;
  updatedAt: string;
}

/** 任务历史条目（最近执行记录，含消息摘要与 runId）。 */
export interface ScheduledTaskHistoryEntry {
  id: string;
  taskId: string;
  status: ScheduledTaskRunStatus;
  firedAt: string;
  runId?: string;
  /** 执行后会话内助手消息摘要（取最后一条非空文本前 200 字）。 */
  summary?: string;
  reason?: string;
}
