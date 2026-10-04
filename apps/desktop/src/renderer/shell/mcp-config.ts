import type { McpServerSummary } from '@sync-think/protocol';
export interface McpConfig {
  name: string;
  transport: 'local-stdio' | 'remote-http';
  endpoint: string;
  notes: string;
  key?: string;
  authScheme?: 'bearer' | 'api-key';
  enabled?: boolean;
}
export function stdioConfig(endpoint: string): {
  command: string;
  args: string[];
  env?: Record<string, string>;
} {
  if (endpoint.trim().startsWith('{')) {
    try {
      const value = JSON.parse(endpoint);
      if (
        typeof value.command === 'string' &&
        (value.args === undefined ||
          (Array.isArray(value.args) &&
            value.args.every((arg: unknown) => typeof arg === 'string')))
      )
        return {
          command: value.command,
          args: value.args ?? [],
          ...(value.env && typeof value.env === 'object' && !Array.isArray(value.env)
            ? { env: value.env }
            : {}),
        };
    } catch {
      /* Preserve a malformed legacy endpoint for editing, without crashing the list. */
    }
    return { command: endpoint, args: [] };
  }
  const parts =
    endpoint.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, '')) ?? [];
  return { command: parts[0] ?? '', args: parts.slice(1) };
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
export function parseMcpImport(text: string): McpConfig[] {
  const root: unknown = JSON.parse(text);
  if (!record(root) || !record(root.mcpServers)) throw new Error('JSON 需要包含 mcpServers 对象。');
  const entries = Object.entries(root.mcpServers);
  if (!entries.length || entries.length > 50) throw new Error('一次请导入 1–50 个服务器。');
  return entries.map(([name, config]) => {
    if (!name.trim() || name.length > 128 || !record(config))
      throw new Error('服务器名称或配置格式不正确。');
    const base = {
      name: name.trim(),
      notes: typeof config.description === 'string' ? config.description : '',
      ...(typeof config.disabled === 'boolean' ? { enabled: !config.disabled } : {}),
    };
    if (config.type !== undefined && !['stdio', 'http', 'sse'].includes(String(config.type)))
      throw new Error(name + '：请选择 stdio、http 或 sse。');
    if (typeof config.command === 'string' && config.command.trim()) {
      if (config.url || (config.type && config.type !== 'stdio'))
        throw new Error(name + '：本地命令与远程 URL 不应同时配置。');
      if (
        config.args !== undefined &&
        (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== 'string'))
      )
        throw new Error(name + '：args 必须是字符串数组。');
      if (
        config.env !== undefined &&
        (!record(config.env) ||
          Object.entries(config.env).some(
            ([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string',
          ))
      )
        throw new Error(name + '：env 必须是字符串键值对象。');
      return {
        ...base,
        transport: 'local-stdio',
        endpoint: JSON.stringify({
          command: config.command.trim(),
          args: config.args ?? [],
          ...(config.env ? { env: config.env } : {}),
        }),
      };
    }
    if (typeof config.url !== 'string' || config.type === 'stdio')
      throw new Error(name + '：需要 command 或 HTTP URL。');
    const url = new URL(config.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error(name + '：请输入 HTTP(S) URL。');
    if (config.type === 'sse')
      throw new Error(
        name +
          '：旧版 SSE 传输尚未接入，请使用服务提供的 Streamable HTTP 地址；HTTP SSE 响应已支持。',
      );
    let key: string | undefined;
    let authScheme: 'bearer' | 'api-key' | undefined;
    if (config.headers !== undefined) {
      if (!record(config.headers)) throw new Error(name + '：headers 必须是对象。');
      for (const [header, value] of Object.entries(config.headers)) {
        if (typeof value !== 'string') throw new Error(name + '：header 值必须是字符串。');
        if (key) throw new Error(name + '：当前支持单个 Bearer 或 X-API-Key 鉴权头。');
        if (header.toLowerCase() === 'authorization' && /^Bearer /i.test(value)) {
          key = value.slice(7);
          authScheme = 'bearer';
        } else if (header.toLowerCase() === 'x-api-key') {
          key = value;
          authScheme = 'api-key';
        } else throw new Error(name + '：当前支持 Authorization: Bearer 或 X-API-Key。');
      }
    }
    return {
      ...base,
      transport: 'remote-http',
      endpoint: url.toString(),
      ...(key ? { key, authScheme } : {}),
    };
  });
}
export function isManagedMcpServer(server: McpServerSummary): boolean {
  return /^(?:SYNC-THINK|NewMax) connector:/.test(server.notes?.trim() ?? '');
}
