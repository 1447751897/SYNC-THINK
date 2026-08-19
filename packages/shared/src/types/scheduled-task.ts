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

export type TaskRule = TaskRuleAt | TaskRuleEvery | TaskRuleRandom | TaskRuleCron;

export type ScheduledTaskRunStatus = 'success' | 'failed' | 'skipped' | 'cancelled';

/** 最近一次执行结果（也用于历史记录）。 */
export interface ScheduledTaskRunResult {
  status: ScheduledTaskRunStatus;
  runId?: string;
  /** 触发时间（UTC）。 */
  firedAt: string;
  /** 失败/跳过原因摘要。 */
  reason?: string;
}

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
