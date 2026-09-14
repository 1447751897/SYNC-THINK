import { siteFaviconUrl } from '../ExternalSourceIcon.js';

export type McpMark = 'github' | 'folder' | 'globe' | 'database' | 'server';

export type McpVisual =
  | { id: string; kind: 'mark'; mark: McpMark }
  | { id: string; kind: 'favicon'; src: string };

export type McpLaunchKind = 'ready' | 'unresolved-env' | 'invalid';

export interface McpLaunchInspection {
  kind: McpLaunchKind;
  label: string;
}

export interface McpAvailability {
  callable: boolean;
  issue: boolean;
  label: string;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const ENV_PLACEHOLDER = /\$\{[A-Z][A-Z0-9_]*\}|%[A-Z][A-Z0-9_]*%/;

function haystack(name: string, endpoint: string): string {
  return `${name}\n${endpoint}`.toLocaleLowerCase();
}

function httpHost(endpoint: string): string | undefined {
  try {
    const host = new URL(endpoint).hostname.toLowerCase().replace(/^www\./, '');
    return host.includes('.') ? host : undefined;
  } catch {
    return undefined;
  }
}

export function looksLikeUnresolvedEnvCommand(endpoint: string): boolean {
  const raw = String(endpoint ?? '').trim();
  if (!raw) return false;
  return ENV_NAME.test(raw) || ENV_PLACEHOLDER.test(raw);
}

export function inspectMcpLaunch(input: {
  transport?: string;
  endpoint?: string;
}): McpLaunchInspection {
  const endpoint = String(input.endpoint ?? '').trim();
  const transport = String(input.transport ?? 'local-stdio');
  if (transport === 'remote-http') {
    return httpHost(endpoint)
      ? { kind: 'ready', label: endpoint }
      : { kind: 'invalid', label: 'Endpoint 不是有效的远程地址' };
  }
  if (!endpoint) return { kind: 'invalid', label: '未填写启动命令' };
  if (looksLikeUnresolvedEnvCommand(endpoint)) {
    return { kind: 'unresolved-env', label: '命令未配置' };
  }
  return { kind: 'ready', label: endpoint };
}

export function resolveMcpVisual(input: { name?: string; endpoint?: string }): McpVisual {
  const name = String(input.name ?? '').trim();
  const endpoint = String(input.endpoint ?? '').trim();
  const text = haystack(name, endpoint);
  const host = httpHost(endpoint);

  if (text.includes('github') || text.includes('mcp_github')) {
    return { id: 'github', kind: 'mark', mark: 'github' };
  }
  if (text.includes('context7') || host?.endsWith('context7.com')) {
    return { id: 'context7', kind: 'favicon', src: siteFaviconUrl('context7.com') };
  }
  if (text.includes('playwright') || text.includes('browser')) {
    return { id: 'playwright', kind: 'mark', mark: 'globe' };
  }
  if (text.includes('postgres') || text.includes('postgresql')) {
    return { id: 'postgres', kind: 'mark', mark: 'database' };
  }
  if (text.includes('filesystem') || text.includes('workspace files')) {
    return { id: 'filesystem', kind: 'mark', mark: 'folder' };
  }
  if (host) {
    return { id: host, kind: 'favicon', src: siteFaviconUrl(host) };
  }
  return { id: 'generic', kind: 'mark', mark: 'server' };
}

export interface McpLogoSources {
  id: string;
  mark: McpMark;
  /** 依次尝试的远程图标地址；数组为空表示直接使用 mark 矢量图标。 */
  sources: string[];
}

/**
 * 统一的多级取图链：站点自身 favicon → 公共 favicon 服务 → 语义矢量图标。
 * 调用方按索引逐档尝试，加载失败即降到下一档，因此不会出现空白/裂图。
 */
export function resolveMcpLogoSources(input: {
  name?: string;
  endpoint?: string;
}): McpLogoSources {
  const visual = resolveMcpVisual(input);
  if (visual.kind === 'mark') {
    return { id: visual.id, mark: visual.mark, sources: [] };
  }
  // 远程图标全部失败时，仍按名字给出有语义的矢量图标（github / 数据库 / 文件夹…）
  const byName = resolveMcpVisual({ name: input.name });
  const mark: McpMark = byName.kind === 'mark' ? byName.mark : 'server';
  const host = httpHost(String(input.endpoint ?? '').trim());
  const sources: string[] = [];
  if (host) sources.push(`https://${host}/favicon.ico`);
  sources.push(visual.src);
  return { id: visual.id, mark, sources };
}

export function mcpAvailability(input: {
  enabled?: boolean;
  trusted?: boolean;
  tools?: readonly unknown[];
  transport?: string;
  endpoint?: string;
  problemCount?: number;
}): McpAvailability {
  const launch = inspectMcpLaunch(input);
  const toolCount = input.tools?.length ?? 0;
  const enabled = input.enabled !== false;
  const issue =
    launch.kind !== 'ready' ||
    toolCount === 0 ||
    input.trusted === false ||
    (input.problemCount ?? 0) > 0;
  if (launch.kind === 'unresolved-env') {
    return { callable: false, issue: true, label: '命令未配置' };
  }
  if (issue) {
    return { callable: false, issue: true, label: '需要检查' };
  }
  return {
    callable: enabled,
    issue: false,
    label: `${toolCount.toLocaleString('zh-CN')} 个工具`,
  };
}
