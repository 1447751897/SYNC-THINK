import { describe, expect, it } from 'vitest';
import { paginateTaskPlanHistory } from './task-plan-history-page.js';

const prepared = () => ({
  version: 'a'.repeat(64),
  snapshot: {
    runs: [],
    selected: {
      runId: 'run',
      sequence: 1,
      updatedSequence: 2,
      updatedAt: '2026-09-06T03:00:00Z',
      source: 'plan' as const,
      status: 'completed' as const,
      title: '计划',
      completed: 1,
      total: 85,
      items: Array.from({ length: 85 }, (_, index) => ({
        title: '任务' + index,
        description: '原生说明' + index,
        status: 'pending' as const,
      })),
    },
  },
});

describe('native task history pages', () => {
  it('preserves complete descriptions and collection totals across bounded pages', () => {
    const original = prepared();
    const first = paginateTaskPlanHistory(original, { offset: 0 });
    expect(first.selected).toMatchObject({ total: 85, completed: 1, offset: 0, nextOffset: 40 });
    expect(first.selected?.items).toHaveLength(40);
    expect(
      paginateTaskPlanHistory(original, {
        runId: 'run',
        offset: 80,
        version: original.version,
      }).selected?.items.map((item) => item.description),
    ).toEqual(['原生说明80', '原生说明81', '原生说明82', '原生说明83', '原生说明84']);
    expect(original.snapshot.selected.items).toHaveLength(85);
  });
  it('rejects stale versions, invalid ranges and oversized individual items instead of truncating', () => {
    expect(() =>
      paginateTaskPlanHistory(prepared(), { offset: 40, version: 'b'.repeat(64) }),
    ).toThrow('history.version-changed');
    expect(() => paginateTaskPlanHistory(prepared(), { offset: 86 })).toThrow(
      'history.invalid-range',
    );
    const oversized = prepared();
    oversized.snapshot.selected.items[0]!.description = '文'.repeat(100_000);
    expect(() => paginateTaskPlanHistory(oversized, { offset: 0 })).toThrow(
      'history.item-too-large',
    );
  });
});
