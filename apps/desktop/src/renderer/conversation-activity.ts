// 对话活动状态(运行中 / 未读)纯逻辑模块。
// 由主线(ShellApp)接入:根据全局 eventHistory 推导每个对话是否在跑、
// 最近一次结束的位置,并用 localStorage 记录用户"已查看"进度以计算未读。
// 事件类型以 m0-projection.ts 为准:run.started 开始,
// run.completed / run.failed / run.cancelled / run.paused 结束。

import type { Event } from '@sync-think/shared';

/** 判定为 Run 开始的事件类型。 */
const RUN_STARTED_TYPE = 'run.started';

/**
 * 判定为 Run 结束(终态)的事件类型。
 * 与 m0-projection.ts 中 runTerminal 的写入点一致;
 * run.recovered 在投影中不落终态,故此处同样不计入。
 */
const RUN_FINISHED_TYPES: ReadonlySet<string> = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.paused',
]);

/** 单个对话的活动状态。 */
export interface ConversationActivity {
  /** 是否正在运行(sequence 最大的 run.* 生命周期事件是 run.started)。 */
  running: boolean;
  /** 最近一次结束事件的时间戳(ms since epoch);无结束事件或时间无法解析时为 null。 */
  lastFinishedAt: number | null;
  /** 最近一次结束事件的 sequence;无结束事件时为 null。用于未读判定。 */
  lastFinishedSequence: number | null;
}

/** taskId 为空或从未产生 run 事件的对话的默认状态(idle)。 */
const IDLE_ACTIVITY: ConversationActivity = {
  running: false,
  lastFinishedAt: null,
  lastFinishedSequence: null,
};

/** 按 taskId 归并的 run 生命周期事件极值。 */
interface TaskRunFacts {
  /** 所有 run 生命周期事件(started + 终态)中 sequence 最大者的信息。 */
  latestSequence: number;
  latestIsStarted: boolean;
  /** 终态事件中 sequence 最大者。 */
  finishedSequence: number | null;
  finishedAt: number | null;
}

/**
 * 单次遍历全局事件流,为每个对话产出活动状态。
 *
 * 事件可能未按 sequence 排序,因此不排序,而是对每个 taskId
 * 直接取 sequence 最大的生命周期事件做判定(等价于按序处理的终值)。
 *
 * @param events 全局事件历史(可能乱序,按 sequence 判定)
 * @param conversations 对话列表(仅需 id 与 taskId;taskId 为空给默认 idle)
 * @returns conversationId → ConversationActivity
 */
export function buildConversationActivity(
  events: readonly Event[],
  conversations: readonly { id: string; taskId?: string }[],
): Map<string, ConversationActivity> {
  const factsByTask = new Map<string, TaskRunFacts>();

  for (const event of events) {
    const taskId = event.taskId;
    if (!taskId) continue;
    const isStarted = event.type === RUN_STARTED_TYPE;
    const isFinished = RUN_FINISHED_TYPES.has(event.type);
    if (!isStarted && !isFinished) continue;

    let facts = factsByTask.get(taskId);
    if (!facts) {
      facts = {
        latestSequence: -Infinity,
        latestIsStarted: false,
        finishedSequence: null,
        finishedAt: null,
      };
      factsByTask.set(taskId, facts);
    }

    if (event.sequence > facts.latestSequence) {
      facts.latestSequence = event.sequence;
      facts.latestIsStarted = isStarted;
    }
    if (isFinished && (facts.finishedSequence === null || event.sequence > facts.finishedSequence)) {
      facts.finishedSequence = event.sequence;
      const parsed = Date.parse(event.occurredAt);
      facts.finishedAt = Number.isFinite(parsed) ? parsed : null;
    }
  }

  const result = new Map<string, ConversationActivity>();
  for (const conversation of conversations) {
    const facts = conversation.taskId ? factsByTask.get(conversation.taskId) : undefined;
    if (!facts) {
      result.set(conversation.id, IDLE_ACTIVITY);
      continue;
    }
    result.set(conversation.id, {
      running: facts.latestIsStarted,
      lastFinishedAt: facts.finishedAt,
      lastFinishedSequence: facts.finishedSequence,
    });
  }
  return result;
}

/** localStorage key:conversationId → 用户最后查看到的事件 sequence。 */
export const CONVERSATION_LAST_SEEN_KEY = 'sync-think.conversationLastSeen';

function safeGet(key: string, storage?: Pick<Storage, 'getItem'>): string | null {
  try {
    if (storage) return storage.getItem(key);
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string, storage?: Pick<Storage, 'setItem'>): void {
  try {
    if (storage) {
      storage.setItem(key, value);
      return;
    }
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式 / 配额不足:静默忽略 */
  }
}

/**
 * 读取"最后查看"映射(conversationId → sequence)。
 * localStorage 不可用或 JSON 解析失败时返回 {};非法条目会被过滤。
 */
export function readConversationLastSeen(
  storage?: Pick<Storage, 'getItem'>,
): Record<string, number> {
  const raw = safeGet(CONVERSATION_LAST_SEEN_KEY, storage);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const result: Record<string, number> = {};
  for (const [conversationId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const id = conversationId.trim();
    if (!id || typeof value !== 'number' || !Number.isFinite(value)) continue;
    result[id] = value;
  }
  return result;
}

/**
 * 持久化"最后查看"映射。localStorage 不可用时静默忽略。
 */
export function writeConversationLastSeen(
  map: Record<string, number>,
  storage?: Pick<Storage, 'setItem'>,
): void {
  safeSet(CONVERSATION_LAST_SEEN_KEY, JSON.stringify(map), storage);
}

/**
 * 将某对话标记为已查看至指定 sequence。
 * 返回新对象;若已记录的 sequence 不小于传入值(无实际变化)则返回原引用,
 * 便于调用方用引用相等跳过 setState / 写盘。
 */
export function markConversationSeen(
  map: Record<string, number>,
  conversationId: string,
  sequence: number,
): Record<string, number> {
  const id = conversationId.trim();
  if (!id || !Number.isFinite(sequence)) return map;
  const current = map[id];
  if (typeof current === 'number' && current >= sequence) return map;
  return { ...map, [id]: sequence };
}

/**
 * 未读判定:对话已跑完(非 running)、存在结束事件、
 * 且其 sequence 大于用户最后查看到的 sequence(缺省 -1)时为未读。
 * 运行中不算未读(等跑完且用户未查看才提示)。
 */
export function isConversationUnread(
  activity: ConversationActivity | undefined,
  lastSeen: Record<string, number>,
  conversationId: string,
): boolean {
  if (!activity || activity.running) return false;
  if (activity.lastFinishedSequence === null) return false;
  return activity.lastFinishedSequence > (lastSeen[conversationId] ?? -1);
}

/** 工作区级聚合活动状态。 */
export interface WorkspaceActivity {
  /** 该工作区下任一对话正在运行。 */
  running: boolean;
  /** 该工作区下任一对话有未读的完成结果。 */
  unread: boolean;
}

/**
 * 按 workspaceId 聚合对话活动:任一对话 running → running,
 * 任一对话未读 → unread。无 workspaceId 的对话不参与聚合。
 *
 * @param conversations 对话列表(仅需 id 与 workspaceId)
 * @param activity buildConversationActivity 的产出
 * @param lastSeen readConversationLastSeen 的产出
 * @returns workspaceId → WorkspaceActivity
 */
export function buildWorkspaceActivity(
  conversations: readonly { id: string; workspaceId?: string }[],
  activity: Map<string, ConversationActivity>,
  lastSeen: Record<string, number>,
): Map<string, WorkspaceActivity> {
  const result = new Map<string, WorkspaceActivity>();
  for (const conversation of conversations) {
    const workspaceId = conversation.workspaceId;
    if (!workspaceId) continue;
    const entry = result.get(workspaceId) ?? { running: false, unread: false };
    const conversationActivity = activity.get(conversation.id);
    if (conversationActivity?.running) entry.running = true;
    if (isConversationUnread(conversationActivity, lastSeen, conversation.id)) {
      entry.unread = true;
    }
    result.set(workspaceId, entry);
  }
  return result;
}
