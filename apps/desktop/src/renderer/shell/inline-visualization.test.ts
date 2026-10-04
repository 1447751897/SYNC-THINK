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
      '<main class="viz-root" data-ui-kit="sync-think-v2"><section>Chart</section></main>',
    );
    expect(documentSource).toContain('data-reduce-motion="true"');
    expect(documentSource).toContain('sync-think-visualization');
  });
});

it.each(['visualizations/longguo-command-center.html', 'reports/ui/preview_v2.html', '可视化/控制台.html'])('renders a safe project-relative HTML file: %s', file => {
  expect(parseInlineVisualizationSegments('::newmax-inline-vis{file="' + file + '"}')).toEqual([{ type: 'visualization', start: 0, file }]);
});
it.each(['../outside.html','visualizations/../outside.html','/tmp/out.html','C:/out.html','//host/out.html','visualizations\\out.html','https://site/out.html','%2e%2e/out.html','out.html?x=1','out.html#x','a//out.html'])('leaves an unsafe path passive: %s', file => {
  expect(hasInlineVisualization('::newmax-inline-vis{file="' + file + '"}')).toBe(false);
});

it('injects the UI baseline before authored styles so complete HTML retains its own theme', () => {
  const authored = '<!doctype html><html><head><style id="authored">body{background:#070a12;color:#e8edf7;padding:32px}</style></head><body><h1>清晰可读</h1></body></html>';
  const url = buildVisualizationDocument(authored);
  const html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
  expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('id="authored"'));
  expect(html.indexOf('html, body { margin: 0')).toBeLessThan(html.indexOf('id="authored"'));
  expect(html).toContain('body{background:#070a12;color:#e8edf7;padding:32px}');
});

it('keeps custom buttons in a standalone page and enforces kit buttons only for explicit kit roots', () => {
  const decode = (source: string) => { const url = buildVisualizationDocument(source); return decodeURIComponent(url.slice(url.indexOf(',') + 1)); };
  const standalone = decode('<html><head><style>button{background:gold;color:black}</style></head><body><button>口号</button></body></html>');
  expect(standalone).not.toContain('appearance: none !important');
  expect(standalone).toContain('button{background:gold;color:black}');
  const kit = decode('<html><head></head><body><main class="viz-root"><button>按钮</button></main></body></html>');
  expect(kit).toContain('appearance: none !important');
});
