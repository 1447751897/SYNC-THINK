import type { Event } from '@sync-think/shared';

/** One checklist item as maintained by the model via update_task_plan. */
export interface ModelTaskPlanItem {
  id?: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Latest task checklist snapshot for a thread (NewMax-style todo list). */
export interface ModelTaskPlan {
  items: ModelTaskPlanItem[];
  total: number;
  completed: number;
}

function parseJsonObjectText(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeModelTaskPlan(raw: unknown): ModelTaskPlan | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const items: ModelTaskPlanItem[] = [];
  for (const entry of raw.slice(0, 20)) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    if (!title) continue;
    const status =
      rec.status === 'in_progress' || rec.status === 'completed' ? rec.status : 'pending';
    const description = typeof rec.description === 'string' ? rec.description.trim() : '';
    const id = typeof rec.id === 'string' ? rec.id.trim() : '';
    items.push({ ...(id ? { id } : {}), title, ...(description ? { description } : {}), status });
  }
  if (items.length === 0) return undefined;
  const completed = items.filter((item) => item.status === 'completed').length;
  return { items, total: items.length, completed };
}

/** Read the latest model checklist for one thread from the recent event buffer. */
export function extractLatestTaskPlanFromEvents(
  events: readonly Event[],
  threadId: string,
): ModelTaskPlan | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.category !== 'tool') continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    if (payload.threadId !== threadId || payload.toolName !== 'update_task_plan') continue;
    let rawItems: unknown;
    if (event.type === 'tool.completed' || event.type === 'tool.failed') {
      const result = parseJsonObjectText(payload.result ?? payload.output);
      if (result?.ok === true) {
        const plan = result.plan;
        rawItems =
          plan && typeof plan === 'object' ? (plan as Record<string, unknown>).items : undefined;
      }
    } else if (event.type === 'tool.requested') {
      rawItems =
        payload.arguments && typeof payload.arguments === 'object'
          ? (payload.arguments as Record<string, unknown>).items
          : undefined;
    }
    if (rawItems !== undefined) return normalizeModelTaskPlan(rawItems);
  }
  return undefined;
}

/** Render a model-facing checkbox snapshot without carrying Runtime state. */
export function formatTaskPlanForModel(plan: ModelTaskPlan): string {
  const lines = plan.items.map((item) => {
    const mark =
      item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[~]' : '[ ]';
    return `- ${mark} ${item.title}${item.description ? `\n  ${item.description}` : ''}`;
  });
  return `当前任务清单（${plan.completed}/${plan.total} 已完成）：\n${lines.join('\n')}`;
}
