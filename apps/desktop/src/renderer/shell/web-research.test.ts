import { describe, expect, it } from 'vitest';
import {
  isWebResearchTool,
  projectResearchTool,
  researchSources,
  researchUrl,
} from './web-research.js';
const tool = {
  kind: 'tool' as const,
  name: 'web_search',
  toolCallId: 'one',
  argumentsJson: '{"query":"今日BGM"}',
  status: 'completed' as const,
};
describe('real research projection', () => {
  it('projects real query/results and deduplicates URLs', () => {
    const result = JSON.stringify({
      ok: true,
      results: [
        { title: 'A', url: 'https://example.test/a' },
        { title: 'duplicate', url: 'https://example.test/a' },
      ],
    });
    expect(projectResearchTool({ ...tool, result })).toMatchObject({
      id: 'one',
      query: '今日BGM',
      meta: '1 result',
      status: 'completed',
      sources: [{ title: 'A', domain: 'example.test' }],
    });
  });
  it('keeps failure and running states truthful and never invents sources', () => {
    expect(
      projectResearchTool({ ...tool, result: '{"ok":false,"error":"offline"}' }),
    ).toMatchObject({ status: 'failed', detail: 'offline' });
    expect(projectResearchTool({ ...tool, status: 'running' })).toMatchObject({
      status: 'running',
      label: 'Searching for',
    });
    expect(researchSources('https://not-a-source.test')).toEqual([]);
  });
  it('handles page reads, batched queries, MCP JSON and blocked protocols', () => {
    expect(
      projectResearchTool({
        ...tool,
        name: 'web_fetch',
        argumentsJson: '{"url":"https://example.test"}',
      }),
    ).toMatchObject({ label: 'Read page', url: 'https://example.test/' });
    expect(
      projectResearchTool({
        ...tool,
        argumentsJson: '{"search_query":[{"q":"first"},{"q":"second"}]}',
      }).query,
    ).toBe('first · second');
    expect(
      researchSources({
        content: [{ text: '{"results":[{"title":"nested","url":"https://example.test"}]}' }],
      }),
    ).toHaveLength(1);
    for (const url of ['javascript:alert(1)', 'file:///secret', 'https://user:pass@example.test'])
      expect(researchUrl(url)).toBeUndefined();
    expect(isWebResearchTool('grep')).toBe(false);
    expect(isWebResearchTool('mcp__gmail__send')).toBe(false);
  });
});
describe('missing vs empty research results', () => {
  it('does not claim zero results for truncated or deferred output', () => {
    expect(projectResearchTool({ ...tool, result: 'truncated preview' }).meta).toBeUndefined();
    expect(projectResearchTool({ ...tool, result: '{"ok":true}' }).meta).toBeUndefined();
    expect(projectResearchTool({ ...tool, result: '{"results":[]}' }).meta).toBe('0 results');
  });
  it('keeps local open tools out of web research', () => {
    expect(isWebResearchTool('open', '{"path":"story.md"}')).toBe(false);
    expect(isWebResearchTool('open', '{"url":"https://example.test"}')).toBe(true);
  });
});

it('recognizes platform MCP and native Claude research names', () => {
  for (const name of [
    'WebSearch',
    'WebFetch',
    'mcp__sync-think-platform__web_search',
    'mcp__browser__WebFetch',
  ])
    expect(isWebResearchTool(name)).toBe(true);
});

it('recovers the exact query from a durable provider result when historical arguments are deferred', () => {
  expect(projectResearchTool({ ...tool, argumentsJson: '', result: JSON.stringify({ok:true,query:'React 官方文档 react.dev Learn React reference',providerId:'bing-rss',results:[{title:'React',url:'https://react.dev/'}]}) })).toMatchObject({query:'React 官方文档 react.dev Learn React reference',meta:'1 result'});
});
