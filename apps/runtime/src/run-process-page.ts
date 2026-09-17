import { createHash } from 'node:crypto';
import {
  parseRunProcessPageRequest,
  type RunProcessPageRequest,
  type RunProcessView,
  type RunProcessCollectionPage,
} from '@sync-think/protocol';

const COLLECTION_BYTES = 224 * 1024;
/**
 * 内嵌在消息里的过程快照条数上限。
 *
 * 真正的约束是 `COLLECTION_BYTES`（224KB）；条数上限只是极端长跑的兜底，避免一次
 * 把几万条步骤塞进载荷。这里放得足够宽，是为了让绝大多数 run 的过程**一次到位**：
 * 以前固定 40 条，稍长的一轮就会在面板上反复出现「正在读取全部步骤…」，
 * 观感上像是永远读不完（NewMax 没有这个分页入口，它直接给全量）。
 */
const EMBEDDED_COLLECTION_LIMIT = 400;
const descriptions = new WeakMap<RunProcessView, { version: string; bytes: number }>();

export function describeRunProcessSnapshot(process: RunProcessView): {
  version: string;
  bytes: number;
} {
  let description = descriptions.get(process);
  if (!description) {
    const serialized = JSON.stringify(process);
    description = {
      version: createHash('sha256').update(serialized).digest('hex'),
      bytes: Buffer.byteLength(serialized),
    };
    descriptions.set(process, description);
  }
  return description;
}

export function selectRunProcessCollection<Item>(
  items: readonly Item[],
  offset: number,
  limit: number,
): { items: Item[]; page: RunProcessCollectionPage } {
  if (offset > items.length) throw new Error('history.invalid-range');
  const selected: Item[] = [];
  let bytes = 2;
  for (let index = offset; index < items.length && selected.length < limit; index++) {
    const itemBytes = Buffer.byteLength(JSON.stringify(items[index])) + 1;
    if (bytes + itemBytes > COLLECTION_BYTES) {
      if (!selected.length) throw new Error('history.item-too-large');
      break;
    }
    selected.push(items[index]!);
    bytes += itemBytes;
  }
  const end = offset + selected.length;
  return {
    items: selected,
    page: { offset, total: items.length, ...(end < items.length ? { nextOffset: end } : {}) },
  };
}

export function paginateRunProcess(
  process: RunProcessView,
  request?: RunProcessPageRequest,
): RunProcessView {
  if (request && !parseRunProcessPageRequest(request)) throw new Error('history.invalid-range');
  // 没有分页请求 = 内嵌快照：整段给全（受字节上限约束）。有分页请求时，没被请求的
  // 那两段仍取首页，避免每次翻页都顺带搬运几百条无关数据。
  const fallbackLimit = request ? 40 : EMBEDDED_COLLECTION_LIMIT;
  const steps = selectRunProcessCollection(
    process.steps,
    request?.section === 'steps' ? request.offset : 0,
    request?.section === 'steps' ? (request.limit ?? 40) : fallbackLimit,
  );
  const files = selectRunProcessCollection(
    process.fileChanges,
    request?.section === 'fileChanges' ? request.offset : 0,
    request?.section === 'fileChanges' ? (request.limit ?? 40) : fallbackLimit,
  );
  const plan = selectRunProcessCollection(
    process.taskPlan?.items ?? [],
    request?.section === 'taskPlan' ? request.offset : 0,
    request?.section === 'taskPlan' ? (request.limit ?? 40) : fallbackLimit,
  );
  if (!request && [steps, files, plan].every((selected) => selected.page.nextOffset === undefined))
    return process;
  const { version } = describeRunProcessSnapshot(process);
  if (request?.version && request.version !== version) throw new Error('history.version-changed');
  return {
    ...process,
    steps: steps.items,
    fileChanges: files.items,
    ...(process.taskPlan ? { taskPlan: { ...process.taskPlan, items: plan.items } } : {}),
    latestStep: process.steps.at(-1),
    pages: { version, steps: steps.page, fileChanges: files.page, taskPlan: plan.page },
  };
}
