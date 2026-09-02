import { describe, expect, it } from 'vitest';
import {
  buildVisualizationDocument,
  hasInlineVisualization,
  parseInlineVisualizationSegments,
} from './inline-visualization.js';

describe('inline visualization contract', () => {
  it('parses NewMax and codex file directives while preserving markdown segments', () => {
    const parts = parseInlineVisualizationSegments(
      '结果如下：\n\n::newmax-inline-vis{file="./visualizations/overview.html"}\n\n结束。',
    );
    expect(parts).toEqual([
      { type: 'markdown', content: '结果如下：\n\n' },
      { type: 'visualization', file: 'visualizations/overview.html' },
      { type: 'markdown', content: '\n\n结束。' },
    ]);
    expect(
      parseInlineVisualizationSegments("::codex-inline-vis{file='charts/today.htm'}"),
    ).toEqual([{ type: 'visualization', file: 'charts/today.htm' }]);
    expect(hasInlineVisualization('::newmax-inline-vis{file="charts/today.html"}')).toBe(true);
  });

  it('does not execute directives inside fences or unsafe paths', () => {
    expect(
      parseInlineVisualizationSegments('```md\n::newmax-inline-vis{file="x.html"}\n```'),
    ).toEqual([
      { type: 'markdown', content: '```md\n::newmax-inline-vis{file="x.html"}\n```' },
    ]);
    expect(hasInlineVisualization('::newmax-inline-vis{file="../outside.html"}')).toBe(false);
    expect(hasInlineVisualization('::newmax-inline-vis{file="C:/outside.html"}')).toBe(false);
    expect(hasInlineVisualization('::newmax-inline-vis{file="charts/data.json"}')).toBe(false);
    expect(hasInlineVisualization('::newmax-inline-vis{file="charts/unfinished.html"')).toBe(false);
  });

  it('keeps authored HTML documents valid and injects the shared viz root', () => {
    const encoded = buildVisualizationDocument(
      '<!doctype html><html><head><title>Report</title></head><body><section>Chart</section></body></html>',
      { theme: 'dark' },
    );
    const documentSource = decodeURIComponent(encoded.replace(/^data:text\/html[^,]*,/, ''));
    expect(documentSource).toContain('<!doctype html>');
    expect(documentSource).toContain('<main class="viz-root"><section>Chart</section></main>');
    expect(documentSource).toContain('Content-Security-Policy');
    expect(documentSource.indexOf('<style>')).toBeLessThan(documentSource.indexOf('</head>'));
  });
});
