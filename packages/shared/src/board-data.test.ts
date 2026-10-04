import { describe, expect, it } from 'vitest';
import { BOARD_DATA_TYPES, BOARD_DATA_OUTPUT_CONTRACT, boardDataHtml } from './board-data.js';
describe('data display contract', () => {
  it('covers every chart card family and the data/table/stat blocks from the referenced catalog', () => {
    for (const key of [
      'table',
      'data-table',
      'data-grid',
      'stat-cards',
      'activity-rings-card',
      'area-chart-card',
      'bar-list-card',
      'combo-chart-card',
      'contributions-card',
      'earnings-chart-card',
      'funnel-chart-card',
      'heatmap-chart-card',
      'line-chart-card',
      'most-active-days-card',
      'orders-chart-card',
      'radar-chart-card',
      'radial-chart-card',
      'revenue-chart-card',
      'sankey-chart-card',
      'scatter-chart-card',
      'sleep-score-card',
      'stage-bars-card',
      'steps-card',
    ])
      expect(BOARD_DATA_TYPES).toHaveProperty(key);
  });
  it('preserves user overrides, source accuracy and the inert-data boundary', () => {
    expect(BOARD_DATA_OUTPUT_CONTRACT).toContain('explicit user formats');
    expect(BOARD_DATA_OUTPUT_CONTRACT).toContain('application/json');
    expect(BOARD_DATA_OUTPUT_CONTRACT).toContain('never simulated or fetched data');
    expect(BOARD_DATA_OUTPUT_CONTRACT).toContain('Gaps are null');
    expect(BOARD_DATA_OUTPUT_CONTRACT).toContain('0.25=25%');
    expect(BOARD_DATA_OUTPUT_CONTRACT).toContain('one component per small html fence');
    expect(BOARD_DATA_OUTPUT_CONTRACT).toContain('main chat owns vertical scrolling');
    expect(BOARD_DATA_OUTPUT_CONTRACT).toContain('data-boardui-layout="custom"');
  });
  it('escapes script-closing and HTML-shaped user values without changing the JSON data', () => {
    const input = {
      type: 'stats' as const,
      title: '</script><img onerror=x>',
      items: [{ label: 'A&B', value: 0 }],
    };
    const html = boardDataHtml(input);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    const raw = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(raw)).toEqual(input);
  });
});
