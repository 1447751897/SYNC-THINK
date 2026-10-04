/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { boardDataHtml } from '@sync-think/shared';
import { boardDataBlockInitialHeight, splitBoardDataBlocks } from './board-data-blocks.js';
const a = { type: 'line' as const, title: '趋势', data: [{ label: '一', value: 1 }] };
const b = {
  type: 'table' as const,
  title: '明细',
  columns: [{ key: 'name', label: '名称' }],
  rows: [{ name: 'A' }],
};
function payload(source: string) {
  return JSON.parse(
    new DOMParser()
      .parseFromString(source, 'text/html')
      .querySelector('[data-boardui]')!
      .getAttribute('data-boardui')!,
  );
}
describe('independent inline data blocks', () => {
  it('retrofits old multi-component documents in order, keeping common metadata once', () => {
    const groups = splitBoardDataBlocks(
      boardDataHtml({
        version: 1,
        title: '数据概览',
        description: '说明',
        source: '实际来源',
        timeRange: '2026-10-03',
        components: [a, b],
      }),
    )!;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      title: '数据概览',
      description: '说明',
      source: '实际来源',
      timeRange: '2026-10-03',
    });
    expect(groups[0]!.blocks.map(payload)).toEqual([
      { version: 1, components: [a] },
      { version: 1, components: [b] },
    ]);
  });
  it('supports multiple markers and prepared escaped attributes', () => {
    const attr = document.createElement('main');
    attr.setAttribute('data-boardui', JSON.stringify({ components: [a, b] }));
    const groups = splitBoardDataBlocks(boardDataHtml(a) + attr.outerHTML)!;
    expect(groups.map((g) => g.blocks.length)).toEqual([1, 2]);
    expect(payload(groups[0]!.blocks[0]!)).toEqual(a);
  });
  it('does not copy authored CSS, scripts, wrappers or event handlers into inspection blocks', () => {
    const groups = splitBoardDataBlocks(
      '<style>body{height:9999px}</style><script>window.authored=true</script><div style="height:960px">' +
        boardDataHtml({ components: [a, b] }) +
        '</div>',
    )!;
    expect(groups[0]!.blocks.join('')).not.toMatch(/style=|window.authored|<script|9999px/);
  });
  it('keeps HTML-shaped data inert and exact after splitting', () => {
    const input = { ...a, title: '</script><img onerror=x>', source: 'A&B' };
    const block = splitBoardDataBlocks(boardDataHtml({ components: [input] }))![0]!.blocks[0]!;
    expect(
      new DOMParser().parseFromString(block, 'text/html').querySelector('script,img'),
    ).toBeNull();
    expect(payload(block).components[0]).toEqual(input);
  });
  it('preserves invalid and future-version payloads for visible renderer errors instead of dropping data', () => {
    for (const raw of ['{bad', 'null', '{"version":2,"components":[]}', '{"components":"wrong"}']) {
      const groups = splitBoardDataBlocks(
        '<script type="application/json" data-boardui>' + raw + '</script>',
      )!;
      const marker = new DOMParser()
        .parseFromString(groups[0]!.blocks[0]!, 'text/html')
        .querySelector('[data-boardui]')!;
      expect(marker.getAttribute('data-boardui')).toBe(raw);
    }
  });
  it('enforces the aggregate 32-component bound without silent truncation', () => {
    expect(() =>
      splitBoardDataBlocks(boardDataHtml({ components: Array.from({ length: 33 }, () => a) })),
    ).toThrow('32');
    expect(() =>
      splitBoardDataBlocks(Array.from({ length: 33 }, () => boardDataHtml(a)).join('')),
    ).toThrow('32');
    expect(() =>
      splitBoardDataBlocks(
        Array.from(
          { length: 31 },
          () => '<script type="application/json" data-boardui>{bad</script>',
        ).join('') + boardDataHtml({ components: [a, b] }),
      ),
    ).toThrow('32');
  });
  it('preserves deliberately designed pages only with an explicit layout opt-out', () => {
    expect(
      splitBoardDataBlocks(
        '<main data-boardui-layout="custom">' + boardDataHtml({ components: [a, b] }) + '</main>',
      ),
    ).toBeNull();
    expect(splitBoardDataBlocks('<p>ordinary page without data</p>')).toEqual([]);
  });
});

it('reserves measured card sizes at first paint and keeps responsive multi-row stats useful', () => {
  const block = (component: Parameters<typeof boardDataHtml>[0]) =>
    splitBoardDataBlocks(boardDataHtml(component))![0]!.blocks[0]!;
  expect(
    boardDataBlockInitialHeight(
      block({
        type: 'stats',
        title: '指标',
        items: [
          { label: 'A', value: 1 },
          { label: 'B', value: 2 },
        ],
      }),
    ),
  ).toBe(148);
  expect(
    boardDataBlockInitialHeight(
      block({
        type: 'stat-cards',
        title: '指标',
        items: Array.from({ length: 4 }, () => ({ label: 'A', value: 1 })),
      }),
      true,
    ),
  ).toBe(296);
  expect(boardDataBlockInitialHeight(block(a))).toBe(345);
  expect(boardDataBlockInitialHeight(block({ ...a, type: 'orders-chart-card', unit: '笔' }))).toBe(
    384,
  );
  expect(boardDataBlockInitialHeight('<div data-boardui="bad"></div>')).toBe(420);
});

it.each([
  ['activity-rings-card', 330],
  ['area-chart-card', 365],
  ['bar-list-card', 177],
  ['combo-chart-card', 365],
  ['contributions-card', 337],
  ['earnings-chart-card', 329],
  ['funnel-chart-card', 329],
  ['heatmap-chart-card', 329],
  ['line-chart-card', 329],
  ['most-active-days-card', 330],
  ['orders-chart-card', 344],
  ['radar-chart-card', 465],
  ['radial-chart-card', 465],
  ['revenue-chart-card', 344],
  ['sankey-chart-card', 480],
  ['scatter-chart-card', 397],
  ['sleep-score-card', 330],
  ['stage-bars-card', 430],
  ['steps-card', 330],
] as const)(
  'reserves the public-preview default height for %s without a generic-chart placeholder',
  (type, height) => {
    const block = splitBoardDataBlocks(
      boardDataHtml({ type, title: '验收', data: [{ label: 'A', value: 1 }] }),
    )![0]!.blocks[0]!;
    expect(boardDataBlockInitialHeight(block)).toBe(height + 16);
  },
);
