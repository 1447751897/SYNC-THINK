import type { TaskPlanHistoryPage, TaskPlanHistoryReadOptions } from '@sync-think/protocol';
import type { PreparedTaskPlanHistory } from '@sync-think/storage';
import { selectRunProcessCollection } from './run-process-page.js';

export function paginateTaskPlanHistory(
  prepared: PreparedTaskPlanHistory,
  options: TaskPlanHistoryReadOptions,
): TaskPlanHistoryPage {
  const { snapshot, version } = prepared;
  if (options.version && options.version !== version) throw new Error('history.version-changed');
  const selected = snapshot.selected;
  if (!selected)
    return {
      runs: snapshot.runs,
      ...(snapshot.nextBeforeSequence ? { nextBeforeSequence: snapshot.nextBeforeSequence } : {}),
    };
  const page = selectRunProcessCollection(selected.items, options.offset, 40);
  return {
    ...snapshot,
    selected: {
      ...selected,
      items: page.items,
      offset: page.page.offset,
      ...(page.page.nextOffset === undefined ? {} : { nextOffset: page.page.nextOffset }),
      version,
    },
  };
}
