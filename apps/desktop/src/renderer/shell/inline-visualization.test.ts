import { describe, expect, it } from 'vitest';
import {
  buildVisualizationDocument,
  hasInlineVisualization,
  parseInlineVisualizationSegments,
} from './inline-visualization.js';

describe('inline visualization contract', () => {
  it('parses NewMax and codex file directives while preserving markdown segments', () => {
    const parts = parseInlineVisualizationSegments(
      '结果如下：\n\n::newmax-inline-vis{file="overview.html"}\n\n结束。',
    );
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({ type: 'markdown', start: 0, content: '结果如下：\n\n' });
    expect(parts[1]).toMatchObject({ type: 'visualization', file: 'overview.html' });
    expect(parts[2]).toMatchObject({ type: 'markdown', content: '\n结束。' });
    expect(parseInlineVisualizationSegments('::codex-inline-vis{file="today.html"}')).toEqual([
      { type: 'visualization', start: 0, file: 'today.html' },
    ]);
    expect(hasInlineVisualization('::newmax-inline-vis{file="today.html"}')).toBe(true);
  });

  it('does not execute directives inside fences or unsafe paths', () => {
    expect(
      parseInlineVisualizationSegments('```md\n::newmax-inline-vis{file="x.html"}\n```'),
    ).toEqual([
      { type: 'markdown', start: 0, content: '```md\n::newmax-inline-vis{file="x.html"}\n```' },
    ]);
    expect(hasInlineVisualization('::newmax-inline-vis{file="../outside.html"}')).toBe(false);
    expect(hasInlineVisualization('::newmax-inline-vis{file="C:/outside.html"}')).toBe(false);
    expect(hasInlineVisualization('::newmax-inline-vis{file="charts/data.json"}')).toBe(false);
    expect(hasInlineVisualization('::newmax-inline-vis{file="charts/unfinished.html"')).toBe(false);
  });

  it('keeps authored HTML documents valid and injects the NewMax guest UI kit', () => {
    const encoded = buildVisualizationDocument(
      '<!doctype html><html><head><title>Report</title></head><body><section>Chart</section></body></html>',
      { theme: 'dark' },
    );
    const documentSource = decodeURIComponent(encoded.replace(/^data:text\/html[^,]*,/, ''));
    expect(documentSource).toContain('<!doctype html>');
    expect(documentSource).toContain('<main class="viz-root"><section>Chart</section></main>');
    expect(documentSource).toContain('Content-Security-Policy');
    expect(documentSource.indexOf('<style>')).toBeLessThan(documentSource.indexOf('</head>'));
    // Guest design-system vocabulary and dark theme are applied to the root.
    expect(documentSource).toContain('--ds-text-primary');
    expect(documentSource).toMatch(/<html[^>]*data-theme="dark"/);
  });

  it('wraps bare fragments in the NewMax document shell', () => {
    const encoded = buildVisualizationDocument('<section>Chart</section>', {
      theme: 'light',
      reduceMotion: true,
    });
    const documentSource = decodeURIComponent(encoded.replace(/^data:text\/html[^,]*,/, ''));
    expect(documentSource).toContain(
      '<main class="viz-root" data-ui-kit="sync-think-v1"><section>Chart</section></main>',
    );
    expect(documentSource).toContain('data-reduce-motion="true"');
    expect(documentSource).toContain('sync-think-visualization');
  });
});
