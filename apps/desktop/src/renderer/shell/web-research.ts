import { normalizeToolName } from '@sync-think/shared';
import type { InlineProcessItem } from './conversation-types.js';
export type ResearchTool = Extract<InlineProcessItem, { kind: 'tool' }>;
export interface ResearchSource {
  title: string;
  domain: string;
  href?: string;
}
export interface ResearchStep {
  id: string;
  label: string;
  query?: string;
  meta?: string;
  sources?: ResearchSource[];
  status?: 'running' | 'completed' | 'failed';
  detail?: string;
  url?: string;
}
const SEARCH = /^(web_search|websearch|search_query|search_web|web\.search|web\.run)$/;
const FETCH = /^(web_fetch|webfetch|web\.open|open)$/;
export function isWebResearchTool(name: string, argumentsJson?: string): boolean {
  const n = normalizeToolName(name).toLowerCase();
  return (
    SEARCH.test(n) ||
    (FETCH.test(n) &&
      (n !== 'open' ||
        argumentsJson === undefined ||
        Boolean(
          researchUrl(record(json(argumentsJson)).url ?? record(json(argumentsJson)).ref_id),
        )))
  );
}
function json(value?: string): unknown {
  try {
    return JSON.parse(value ?? '');
  } catch {
    return undefined;
  }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function researchUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password
      ? u.href
      : undefined;
  } catch {
    return;
  }
}
/** Bounded projection of the real result only. Never manufacture sources from prose or arguments. */
export function researchSources(value: unknown): ResearchSource[] {
  const out: ResearchSource[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 5 || out.length >= 50) return;
    if (Array.isArray(v)) {
      for (const entry of v.slice(0, 50)) visit(entry, depth + 1);
      return;
    }
    const r = record(v);
    const href = researchUrl(r.url ?? r.href ?? r.link);
    if (href && !seen.has(href)) {
      seen.add(href);
      out.push({
        href,
        domain: new URL(href).hostname,
        title: typeof r.title === 'string' && r.title.trim() ? r.title : new URL(href).hostname,
      });
    }
    for (const key of [
      'results',
      'sources',
      'citations',
      'data',
      'result',
      'structuredContent',
      'content',
    ]) {
      const nested = r[key];
      if (nested !== undefined) visit(nested, depth + 1);
    }
    // MCP's text content may carry a JSON result, not a list of scraped links.
    if (typeof r.text === 'string') visit(json(r.text), depth + 1);
  };
  visit(value, 0);
  return out;
}
export function projectResearchTool(item: ResearchTool, index = 0): ResearchStep {
  const args = record(json(item.argumentsJson));
  const result = json(item.result);
  const r = record(result);
  const name = normalizeToolName(item.name).toLowerCase();
  const search = SEARCH.test(name);
  const failed = item.failed || item.status === 'failed' || r.ok === false;
  const status = failed
    ? 'failed'
    : (item.status ?? (item.result === undefined ? 'running' : 'completed'));
  const queries = Array.isArray(args.search_query)
    ? args.search_query.map((q) => record(q).q).filter((q) => typeof q === 'string')
    : [];
  const argumentsQuery =
    typeof args.query === 'string'
      ? args.query
      : typeof args.q === 'string'
        ? args.q
        : queries.join(' · ');
  // Paged history may defer arguments while retaining the provider's canonical query.
  const query = argumentsQuery || (search && typeof r.query === 'string' ? r.query : '');
  const url = researchUrl(args.url ?? args.href ?? args.ref_id) ?? researchUrl(item.argumentsJson);
  const sources = failed ? [] : researchSources(result);
  return {
    id: item.toolCallId ?? item.id ?? String(index),
    label: search
      ? status === 'running'
        ? 'Searching for'
        : 'Searched for'
      : status === 'running'
        ? 'Reading'
        : 'Read page',
    ...(query ? { query } : url ? { query: url } : {}),
    status,
    ...(sources.length
      ? { sources, meta: `${sources.length} ${sources.length === 1 ? 'result' : 'results'}` }
      : status === 'completed' && search && Array.isArray(r.results) && r.results.length === 0
        ? { meta: '0 results' }
        : {}),
    ...(url ? { url } : {}),
    ...(failed
      ? { detail: typeof r.error === 'string' ? r.error : '搜索未完成，请查看执行详情' }
      : {}),
  };
}
