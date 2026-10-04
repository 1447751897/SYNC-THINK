/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { BOARD_DATA_TYPES, boardDataHtml, type BoardDataComponent } from '@sync-think/shared';
import { mountBoardData, buildBoardDataBootstrap } from './board-data.js';
import { BOARD_DATA_STYLES } from './board-data-styles.js';
import fixtures from '../../../scripts/fixtures/board-data-catalog.json' with { type: 'json' };
function render(c: object) {
  document.body.innerHTML = boardDataHtml(c as BoardDataComponent);
  mountBoardData(BOARD_DATA_TYPES, 'test');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  return document.querySelector<HTMLElement>('.bd-root')!;
}
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
    f(0);
    return 1;
  });
});
afterEach(() => {
  document.body.replaceChildren();
  delete (window as Window & { SyncThinkData?: unknown }).SyncThinkData;
  vi.unstubAllGlobals();
});
const columns = [
  { key: 'name', label: 'Account', editable: true },
  {
    key: 'arr',
    label: 'ARR',
    format: 'currency',
    currency: 'USD',
    editable: true,
    aggregate: 'sum',
  },
  { key: 'stage', label: 'Stage', cell: 'select', options: ['Won', 'Proposal'], editable: true },
  { key: 'health', label: 'Health', cell: 'progress', format: 'percent' },
];
const records = [
  { name: 'Northwind', arr: 9600, stage: 'Won', health: 0.49 },
  { name: 'Lumen', arr: 37800, stage: 'Proposal', health: 0.9 },
];
describe('full BoardUI catalog', () => {
  it.each(fixtures.components)('renders the complete $type acceptance fixture', (c) => {
    const r = render(c);
    expect(r.querySelector('[role="alert"]')).toBeNull();
    expect(r.textContent).toContain(c.title);
    expect(r.querySelector('script,iframe')).toBeNull();
  });
  it('renders an independently editable grid with summaries, without mutating source', () => {
    const r = render({ type: 'data-grid', title: 'Renewals', columns, rows: records });
    expect(r.querySelector('[role="grid"]')).toBeTruthy();
    expect(r.querySelector('.bd-grid-summary')?.textContent).toContain('47,400');
    const c = r.querySelector<HTMLElement>('[data-row="0"][data-col="arr"]')!;
    fireEvent.doubleClick(c);
    const e = c.querySelector('input')!;
    fireEvent.input(e, { target: { value: '10000' } });
    fireEvent.keyDown(e, { key: 'Enter' });
    expect(r.querySelector('.bd-grid-summary')?.textContent).toContain('47,800');
    expect(records[0]!.arr).toBe(9600);
    fireEvent.click([...r.querySelectorAll('button')].find((b) => b.textContent === '重置')!);
    expect(r.querySelector('.bd-grid-summary')?.textContent).toContain('47,400');
  });
  it('preserves the native click-click-dblclick target and handles quoted column keys', () => {
    const r = render({
      type: 'data-grid',
      title: 'Grid',
      columns: [{ key: 'a"b', label: 'Quoted', editable: true }],
      rows: [{ 'a"b': 'One' }],
    });
    const cell = r.querySelector<HTMLElement>('[data-row="0"]')!;
    fireEvent.click(cell);
    expect(cell.isConnected).toBe(true);
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
    expect(cell.querySelector('input')).toBeTruthy();
  });
  it('filters typed columns, hides columns and selects rows', () => {
    const r = render({ type: 'data-table', title: 'Customers', columns, rows: records });
    const filter = r.querySelector<HTMLSelectElement>('select[aria-label="筛选 Stage"]')!;
    expect(filter).toBeTruthy();
    fireEvent.change(filter, { target: { value: 'Won' } });
    expect(r.querySelectorAll('tbody tr')).toHaveLength(1);
    fireEvent.click(r.querySelector<HTMLInputElement>('input[aria-label="选择本页"]')!);
    expect(r.textContent).toContain('已选 1');
    fireEvent.click([...r.querySelectorAll('button')].find((b) => b.textContent === '列')!);
    fireEvent.click(r.querySelector('input[aria-label="显示 Health"]')!);
    expect(r.querySelector('th[data-key="health"]')).toBeNull();
  });
  it('uses concentric radial progress, not a pie chart', () => {
    const r = render({
      type: 'radial-chart-card',
      title: 'Visitors',
      data: [
        { label: 'Other', value: 90 },
        { label: 'Edge', value: 173 },
      ],
      max: 300,
    });
    expect(r.querySelectorAll('[data-radial-ring]')).toHaveLength(2);
    expect(r.querySelector('[data-template="radial-chart-card"]')).toBeTruthy();
    expect(r.querySelector('.bd-tiles')).toBeTruthy();
  });
  it('renders a daily ring calendar rather than bars and navigates real months', () => {
    const r = render({
      type: 'most-active-days-card',
      title: 'Most active days',
      data: [
        { date: '2026-01-01', value: 1200, target: 6000 },
        { date: '2026-02-01', value: 3600, target: 6000 },
      ],
    });
    expect(r.querySelector('.bd-day-ring')).toBeTruthy();
    expect(r.querySelector('[data-bar]')).toBeNull();
    fireEvent.click(r.querySelector('button[aria-label="下个月"]')!);
    expect(r.querySelector('.bd-calendar-month')?.textContent).toContain('2026-02');
  });
  it('creates a date-aligned contribution calendar with missing days separate from zero', () => {
    const r = render({
      type: 'contributions-card',
      title: 'Contributions',
      data: [
        { date: '2026-01-01', value: 2 },
        { date: '2026-01-03', value: 0 },
      ],
    });
    expect(r.querySelector('[data-date="2026-01-01"]')).toBeTruthy();
    expect(r.querySelector('[data-date="2026-01-02"]')?.getAttribute('data-missing')).toBe('true');
    expect(r.querySelector('[data-date="2026-01-03"]')?.getAttribute('data-missing')).toBe('false');
  });
  it('uses a horizontal flow funnel and separate stage pills', () => {
    let r = render({
      type: 'funnel-chart-card',
      title: 'Funnel',
      data: [
        { label: 'Visits', value: 100 },
        { label: 'Paid', value: 20 },
      ],
    });
    expect(r.querySelectorAll('[data-funnel-stage]')).toHaveLength(2);
    delete (window as Window & { SyncThinkData?: unknown }).SyncThinkData;
    r = render({
      type: 'stage-bars-card',
      title: 'Pipeline',
      data: [
        { label: 'Visits', value: 100 },
        { label: 'Paid', value: 20 },
      ],
    });
    expect(r.querySelectorAll('.bd-stage-pill')).toHaveLength(2);
  });
  it('gives health cards their own layouts and uses real metric scores', () => {
    let r = render({
      type: 'activity-rings-card',
      title: 'Activity',
      items: [
        { label: 'Move', value: 50, target: 100 },
        { label: 'Exercise', value: 20, target: 30 },
      ],
    });
    expect(r.querySelectorAll('.bd-activity-ring')).toHaveLength(2);
    expect(r.querySelector('.bd-activity-tiles')).toBeTruthy();
    delete (window as Window & { SyncThinkData?: unknown }).SyncThinkData;
    r = render({
      type: 'sleep-score-card',
      title: 'Sleep score',
      value: 98,
      max: 100,
      description: 'Excellent',
      items: [
        { label: 'Duration', value: 49, target: 50 },
        { label: 'Bedtime', value: 29, target: 30 },
        { label: 'Interruptions', value: 20, target: 20 },
      ],
    });
    expect(r.querySelector('.bd-sleep-metrics')?.textContent).toContain('49/50');
    expect(r.querySelectorAll('[data-sleep-segment]')).toHaveLength(3);
  });
  it('does not clip a long CNY stat or invent irrelevant icons', () => {
    const r = render({
      type: 'stat-cards',
      title: 'Stats',
      items: [{ label: '营收', value: 486000, format: 'currency', currency: 'CNY', delta: 8.1 }],
    });
    expect(r.querySelector('.bd-value')?.textContent).toBe('¥486,000');
    expect(BOARD_DATA_STYLES).toContain('min-height:132px');
    expect(r.querySelector('.bd-stat-icon')?.getAttribute('data-icon')).toBe('revenue');
  });
  it.each(['contributions-card', 'most-active-days-card'])(
    'rejects invalid and duplicate dates for %s',
    (type) => {
      const r = render({ type, title: 'Dates', data: [{ date: '2026-02-31', value: 1 }] });
      expect(r.querySelector('[role="alert"]')).toBeTruthy();
      delete (window as Window & { SyncThinkData?: unknown }).SyncThinkData;
      const duplicate = render({
        type,
        title: 'Dates',
        data: [
          { date: '2026-01-01', value: 1 },
          { date: '2026-01-01', value: 2 },
        ],
      });
      expect(duplicate.querySelector('[role="alert"]')?.textContent).toContain('重复日期');
    },
  );
  it('serializes extension renderers into the isolated guest without external imports', () => {
    const s = buildBoardDataBootstrap();
    expect(s).toContain('data-radial-ring');
    expect(s).toContain('bd-grid-summary');
    expect(s).not.toContain('require(');
  });
});

it.each([
  ['earnings-chart-card', 32, 6],
  ['steps-card', 50, 10],
] as const)('uses the reference wide rounded track for %s', (type, width, radius) => {
  const root = render({
    type,
    title: '验收',
    data: [
      { label: 'A', value: 10 },
      { label: 'B', value: 20 },
    ],
  });
  const track = root.querySelector('[data-bar-track]')!;
  const bar = root.querySelector('[data-bar]')!;
  expect(Number(track.getAttribute('width'))).toBe(width);
  expect(Number(track.getAttribute('rx'))).toBe(radius);
  expect(bar.tagName.toLowerCase()).toBe('rect');
  expect(bar.getAttribute('width')).toBe(track.getAttribute('width'));
});

it('keeps activity tile colors aligned with the corresponding rings', () => {
  const root = render({
    type: 'activity-rings-card',
    title: 'Activity',
    items: [
      { label: 'Move', value: 10, target: 20 },
      { label: 'Exercise', value: 5, target: 10 },
      { label: 'Running', value: 1, target: 2 },
    ],
  });
  const dots = [...root.querySelectorAll<HTMLElement>('.bd-dot')].map((e) => e.style.background);
  const rings = [...root.querySelectorAll('[data-radial-ring]')].map((e) =>
    e.getAttribute('stroke'),
  );
  expect(dots).toEqual(rings);
});
