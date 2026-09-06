import type { InlineProcessItem } from './ChatView.js';
import type { ExecutionProcessView } from './execution-process.js';

export function reconcileProcessItemOutcomes(
  items: InlineProcessItem[] | undefined,
  process: Pick<ExecutionProcessView, 'steps' | 'completedAt'> | undefined,
): InlineProcessItem[] | undefined {
  if (!items || !process) return items;
  const steps = new Map(process.steps.map((step) => [step.id, step]));
  let updated: InlineProcessItem[] | undefined;
  for (const [index, item] of items.entries()) {
    if (item.kind !== 'tool') continue;
    const step = steps.get(item.toolCallId ?? item.id ?? '');
    const endedWithoutResult = !step && process.completedAt && item.status === 'running';
    if (!step && !endedWithoutResult) continue;
    const failed =
      item.failed === true ||
      item.status === 'failed' ||
      step?.status === 'error' ||
      Boolean(endedWithoutResult);
    const status = failed ? 'failed' : step?.status === 'done' ? 'completed' : 'running';
    const result =
      item.result ?? (failed ? (step?.error ?? '运行已结束，工具未报告执行结果') : undefined);
    if (item.status === status && item.failed === failed && item.result === result) continue;
    updated ??= [...items];
    updated[index] = { ...item, status, failed, ...(result !== undefined ? { result } : {}) };
  }
  return updated ?? items;
}
