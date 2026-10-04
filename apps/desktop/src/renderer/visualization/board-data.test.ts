/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { BOARD_DATA_TYPES, boardDataHtml, type BoardDataComponent } from '@sync-think/shared';
import { mountBoardData } from './board-data.js';
import { buildVisualizationDocumentHtml } from './ui-kit.js';
import { BOARD_DATA_STYLES } from './board-data-styles.js';

const canonical: Record<string, object> = {
  table: {
    columns: [
      { key: 'label', label: '项目' },
      { key: 'value', label: '数量', format: 'number' },
    ],
    rows: [
      { label: '甲', value: 12 },
      { label: '乙', value: 3 },
    ],
  },
  stats: {
    items: [
      { label: '浏览量', value: 120, delta: 9.4 },
      { label: '零值', value: 0 },
    ],
  },
  line: {
    series: [{ key: 'value', label: '浏览量' }],
    data: [
      { label: '周一', value: 12 },
      { label: '周二', value: 23 },
    ],
  },
  area: {
    data: [
      { label: '周一', value: 12 },
      { label: '周二', value: 23 },
    ],
  },
  bar: {
    data: [
      { label: '周一', value: -12 },
      { label: '周二', value: 23 },
    ],
  },
  combo: {
    series: [
      { key: 'a', label: '访问', type: 'bar' },
      { key: 'b', label: '收入', type: 'line', axis: 'right' },
    ],
    data: [
      { label: '周一', a: 12, b: 250 },
      { label: '周二', a: 23, b: 190 },
    ],
  },
  'bar-list': {
    data: [
      { label: '甲', value: -12 },
      { label: '乙', value: 23 },
    ],
  },
  donut: {
    data: [
      { label: '甲', value: 12 },
      { label: '乙', value: 23 },
    ],
  },
  radar: {
    series: [
      { key: 'a', label: '方案 A' },
      { key: 'b', label: '方案 B' },
    ],
    data: [
      { label: '成本', a: 12, b: 15 },
      { label: '速度', a: 23, b: 20 },
      { label: '可靠性', a: 25, b: 19 },
    ],
  },
  scatter: {
    data: [
      { label: '甲', x: 2, y: 3 },
      { label: '乙', x: 5, y: 7 },
    ],
  },
  funnel: {
    data: [
      { label: '曝光', value: 120 },
      { label: '点击', value: 23 },
      { label: '转化', value: 10 },
    ],
  },
  heatmap: {
    data: [
      { row: '周一', column: '上午', value: 2 },
      { row: '周一', column: '下午', value: 0 },
      { row: '周二', column: '下午', value: 6 },
    ],
  },
  sankey: {
    nodes: [
      { id: 'a', label: '曝光' },
      { id: 'b', label: '点击' },
      { id: 'c', label: '购买' },
    ],
    links: [
      { source: 'a', target: 'b', value: 20 },
      { source: 'b', target: 'c', value: 10 },
    ],
  },
  rings: {
    items: [
      { label: '步数', value: 1200, target: 6000 },
      { label: '运动', value: 20, target: 30 },
    ],
  },
  gauge: { value: 82, max: 100 },
  stages: {
    data: [
      { label: '完成', value: 6 },
      { label: '进行中', value: 2 },
    ],
  },
};
function renderData(config: object): HTMLElement {
  document.body.innerHTML = boardDataHtml(config as BoardDataComponent);
  mountBoardData(BOARD_DATA_TYPES, 'test-kit');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  return document.querySelector('.bd-root')!;
}
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
});
afterEach(() => {
  document.body.replaceChildren();
  delete (window as Window & { SyncThinkData?: unknown }).SyncThinkData;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('local BoardUI-style data adapters', () => {
  it.each(Object.entries(BOARD_DATA_TYPES))(
    'renders %s without a network dependency or placeholder',
    (name, kind) => {
      const root = renderData({
        type: name,
        title: '数据核验',
        source: '测试示例数据',
        timeRange: '2026-10-01 — 2026-10-03',
        ...canonical[kind],
        ...(name === 'most-active-days-card'
          ? {
              data: [
                { date: '2026-10-01', value: 1200, target: 6000 },
                { date: '2026-10-02', value: 2300, target: 6000 },
              ],
            }
          : {}),
      });
      expect(root).toBeTruthy();
      expect(root.textContent).toContain('数据核验');
      expect(root.textContent).toContain('测试示例数据');
      expect(root.querySelector('[role="alert"]')).toBeNull();
      expect(root.querySelector('script,iframe,img')).toBeNull();
    },
  );
  it('sorts numerically, searches, paginates and preserves source rows', () => {
    const data = Array.from({ length: 24 }, (_, i) => ({ label: '商品 ' + i, value: 24 - i }));
    const root = renderData({
      type: 'table',
      title: '商品',
      columns: [
        { key: 'label', label: '商品' },
        { key: 'value', label: '数量', format: 'number' },
      ],
      rows: data,
    });
    expect(root.querySelectorAll('tbody tr')).toHaveLength(20);
    fireEvent.click(
      Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.startsWith('数量'))!,
    );
    expect(root.querySelector('tbody tr td:last-child')?.textContent).toBe('1');
    fireEvent.click(
      Array.from(root.querySelectorAll('button')).find((b) => b.textContent === '下一页')!,
    );
    expect(root.querySelectorAll('tbody tr')).toHaveLength(4);
    fireEvent.input(root.querySelector('input')!, { target: { value: '商品 23' } });
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(root.textContent).toContain('筛选结果 1 / 24 项');
    expect(data[0]!.value).toBe(24);
  });
  it('uses a provided dataset for each period, with no invented or fetched values', () => {
    const root = renderData({
      type: 'line',
      title: '浏览量',
      periods: [
        { label: '本周', value: 12, data: [{ label: '周一', value: 12 }] },
        { label: '上周', value: 8, data: [{ label: '周一', value: 8 }] },
      ],
    });
    expect(root.querySelector('.bd-value')?.textContent).toBe('12');
    fireEvent.click(
      Array.from(root.querySelectorAll('button')).find((b) => b.textContent === '上周')!,
    );
    expect(root.querySelector('.bd-value')?.textContent).toBe('8');
    expect(root.querySelector('[aria-pressed="true"]')?.textContent).toBe('上周');
  });
  it('keeps long edge dates and axis captions inside the SVG viewport', () => {
    const root = renderData({
      type: 'line',
      title: '趋势',
      yLabel: '浏览量',
      data: [
        { label: '2026-10-01', value: 1 },
        { label: '2026-10-03', value: 2 },
      ],
    });
    const texts = Array.from(root.querySelectorAll('svg text'));
    expect(texts.find((e) => e.textContent === '2026-10-01')?.getAttribute('text-anchor')).toBe(
      'start',
    );
    expect(texts.find((e) => e.textContent === '2026-10-03')?.getAttribute('text-anchor')).toBe(
      'end',
    );
    expect(texts.find((e) => e.textContent === '浏览量')?.getAttribute('y')).toBe('12');
    const yTicks = texts.filter((e) => e.getAttribute('data-axis') === 'y');
    expect(yTicks.length).toBeGreaterThan(2);
    expect(yTicks.every((e) => Number(e.getAttribute('y')) > 28)).toBe(true);
  });
  it('renders missing values as gaps and reports them honestly in keyboard tooltips', () => {
    const root = renderData({
      type: 'line',
      title: '访问',
      unit: '次',
      data: [
        { label: '甲', value: 1 },
        { label: '乙', value: null },
        { label: '丙', value: 3 },
      ],
    });
    const chart = root.querySelector('svg')!;
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    const tooltip = root.querySelector('[role="tooltip"]')!;
    expect(tooltip.hasAttribute('hidden')).toBe(false);
    expect(tooltip.textContent).toContain('乙');
    expect(tooltip.textContent).toContain('—');
    expect(root.querySelector('path.bd-line')?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
  });
  it('leaves malformed periods visible as an error instead of throwing out of the event handler', () => {
    const root = renderData({
      type: 'line',
      title: '访问',
      periods: [
        { label: '可用', data: [{ label: '甲', value: 1 }] },
        { label: '缺失', data: [] },
      ],
    });
    expect(() =>
      fireEvent.click(
        Array.from(root.querySelectorAll('button')).find((b) => b.textContent === '缺失')!,
      ),
    ).not.toThrow();
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    fireEvent.click(
      Array.from(root.querySelectorAll('button')).find((b) => b.textContent === '可用')!,
    );
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
  it('formats fraction-based stats and chart headlines as percentages', () => {
    const root = renderData({
      type: 'stats',
      title: '比例',
      items: [{ label: '转化率', value: 0.00767, format: 'percent' }],
    });
    expect(root.querySelector('.bd-value')?.textContent).toBe('0.77%');
  });
  it('accepts an empty optional period list and rejects dual-axis stacked bars', () => {
    const root = renderData({
      type: 'bar',
      title: '统计',
      periods: [],
      data: [{ label: '甲', value: 1 }],
    });
    expect(root.querySelector('[role="alert"]')).toBeNull();
    const invalid = renderData({
      type: 'bar',
      title: '双轴',
      stacked: true,
      series: [
        { key: 'a', label: '甲' },
        { key: 'b', label: '乙', axis: 'right' },
      ],
      data: [{ label: '项目', a: 1, b: 2 }],
    });
    expect(invalid.querySelector('[role="alert"]')).not.toBeNull();
  });
  it.each([
    { type: 'line', title: '缺失', data: [{ label: '甲', value: 'not a number' }] },
    { type: 'donut', title: '负数', data: [{ label: '甲', value: -1 }] },
    {
      type: 'heatmap',
      title: '重复',
      data: [
        { row: '甲', column: '乙', value: 1 },
        { row: '甲', column: '乙', value: 2 },
      ],
    },
    {
      type: 'sankey',
      title: '循环',
      nodes: [
        { id: 'a', label: '甲' },
        { id: 'b', label: '乙' },
      ],
      links: [
        { source: 'a', target: 'b', value: 1 },
        { source: 'b', target: 'a', value: 1 },
      ],
    },
    { type: 'constructor', title: '未知' },
    { type: 'gauge', title: '越界', value: 120, max: 100 },
  ])('shows a bounded data error for invalid configuration: $title', (config) => {
    const root = renderData(config);
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
  });
  it('treats data text as text, including HTML and script-shaped values', () => {
    const hostile = '<img src=x onerror="window.pwned=true"><script>window.pwned=true</script>';
    const root = renderData({
      type: 'stats',
      title: hostile,
      items: [{ label: hostile, value: 1 }],
    });
    expect(root.querySelector('img,script')).toBeNull();
    expect(root.textContent).toContain(hostile);
    expect((window as Window & { pwned?: boolean }).pwned).toBeUndefined();
  });
  it('keeps the measured card frame free of injected legends, disclosures and source footers', () => {
    const root = renderData({
      type: 'line-chart-card',
      title: 'Revenue',
      format: 'currency',
      currency: 'USD',
      value: 18240,
      delta: 9.4,
      source: '公开示例',
      timeRange: '2026',
      data: [
        { label: 'Jan', value: 1400 },
        { label: 'Jun', value: 3100 },
        { label: 'Dec', value: 5200 },
      ],
    });
    const card = root.querySelector('.bd-card')!;
    expect(card.getAttribute('data-frame')).toBe('cartesian');
    expect(card.querySelector('.bd-caption,.bd-chart-data,.bd-legend')).toBeNull();
    expect(root.querySelector('.bd-caption')?.textContent).toContain('公开示例');
    expect(root.querySelector('.bd-value')?.textContent).toBe('$18,240');
    expect(card.querySelector('.bd-grid-line')).toBeNull();
    expect(BOARD_DATA_STYLES).toContain('height:329px; padding:16px 16px 12px');
    expect(BOARD_DATA_STYLES).toContain("[data-component='bar'] { height:344px; }");
    expect(BOARD_DATA_STYLES).not.toContain('data:font/woff2;base64,');
  });
  it('matches hover readouts and hides the pulse while idle, without fabricating values', () => {
    const root = renderData({
      type: 'line',
      title: 'Revenue',
      value: 18240,
      format: 'currency',
      currency: 'USD',
      delta: 9.4,
      data: [
        { label: 'Jan', value: 1400 },
        { label: 'Jun', value: 3100 },
        { label: 'Dec', value: null },
      ],
    });
    const chart = root.querySelector('.bd-plot svg')!;
    expect((root.querySelector('.bd-pulse') as SVGElement).style.display).toBe('none');
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(root.querySelector('.bd-title')?.textContent).toBe('June');
    expect(root.querySelector('.bd-value')?.textContent).toBe('$3,100');
    expect((root.querySelector('.bd-delta') as HTMLElement).hidden).toBe(true);
    fireEvent.keyDown(chart, { key: 'ArrowRight' });
    expect(root.querySelector('.bd-value')?.textContent).toBe('—');
    expect((root.querySelector('.bd-pulse') as SVGElement).style.display).toBe('none');
    fireEvent.blur(chart);
    expect(root.querySelector('.bd-title')?.textContent).toBe('Revenue');
    expect(root.querySelector('.bd-value')?.textContent).toBe('$18,240');
  });
  it('provides both stat variants with fixed local icons and independent comparison captions', () => {
    const root = renderData({
      type: 'stats',
      title: 'Summary',
      variant: 'footer',
      items: [
        {
          label: 'Revenue',
          value: 152313.92,
          format: 'currency',
          currency: 'USD',
          icon: 'revenue',
          caption: 'From last month',
          delta: '16%',
          deltaColor: 'lime',
          hint: 'Gross revenue',
        },
      ],
    });
    expect(root.querySelector('.bd-stat')?.getAttribute('data-variant')).toBe('footer');
    expect(root.querySelector('.bd-stat-icon svg')).not.toBeNull();
    expect(root.querySelector('.bd-value')?.textContent).toBe('$152,313.92');
    expect(root.querySelector('.bd-stat-footer')?.textContent).toContain('From last month');
    expect(root.querySelector('.bd-delta')?.getAttribute('data-direction')).toBe('up');
    expect(root.querySelector('.bd-info')?.getAttribute('aria-label')).toBe('Gross revenue');
  });
  it('uses fractional layout bounds rather than rounded client width to avoid native scrollbar feedback', () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('bd-plot'))
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 597.6,
          bottom: 257,
          width: 597.6,
          height: 257,
          toJSON: () => ({}),
        };
      return original.call(this);
    });
    const root = renderData({
      type: 'line',
      title: '缩放',
      data: [
        { label: '甲', value: 1 },
        { label: '乙', value: 2 },
      ],
    });
    expect(root.querySelector('.bd-plot svg')?.getAttribute('width')).toBe('597');
    expect(root.querySelector('.bd-plot svg')?.getAttribute('height')).toBe('257');
  });
  it('offers genuine numbered pagination with a current-page indicator', () => {
    const root = renderData({
      type: 'table',
      title: 'Rows',
      pageSize: 2,
      columns: [{ key: 'value', label: 'Value', format: 'number' }],
      rows: [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }],
    });
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
    fireEvent.click(root.querySelector('[aria-label="第 3 页"]')!);
    expect(root.querySelector('tbody td')?.textContent).toBe('5');
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('3');
  });
  it('styles native tables without forcing authored layout or injecting chart scripts', () => {
    const html = buildVisualizationDocumentHtml(
      '<html><head><style>body{background:purple}</style></head><body><table><tr><td>真实内容</td></tr></table></body></html>',
    );
    expect(html).toContain('class="board-table"');
    expect(html).toContain('body:has(.bd-root),body:has(.board-table) { overflow-y:auto;');
    expect(html).toContain('body{background:purple}');
    expect(html).not.toContain('sync-think-board-data-runtime');
  });
  it('injects the renderer into saved data visualizations with the existing offline CSP', () => {
    const html = buildVisualizationDocumentHtml(
      boardDataHtml({ type: 'bar', title: '示例', data: [{ label: '甲', value: 1 }] }),
    );
    expect(html).toContain('sync-think-board-data-runtime');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('data-theme="light"');
  });
});
