import { Buffer } from 'node:buffer';

export const MAX_REMOTE_SKILL_BYTES = 2 * 1024 * 1024;
export const MAX_REMOTE_MCP_BYTES = 1 * 1024 * 1024;
export const REMOTE_CAPABILITY_TIMEOUT_MS = 20_000;

export interface RemoteSkillFetchResult {
  url: string;
  skillMd: string;
  fetchedBytes: number;
}

export interface RemoteMcpAuth {
  key?: string;
  scheme?: string;
}

export interface RemoteMcpTool {
  name: string;
  description: string;
  inputSchemaJson?: string;
}

export interface RemoteMcpRequestResult {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string; data?: unknown };
  sessionId?: string;
}

export interface RemoteMcpToolCallResult {
  ok: boolean;
  result: Record<string, unknown>;
  text: string;
  sessionId?: string;
}

function normalizeGitHubBlobUrl(url: URL): URL {
  if (url.hostname.toLowerCase() !== 'github.com') return url;
  const match = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.pathname);
  if (!match) return url;
  return new URL(
    `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}${url.search}`,
  );
}

export function parseRemoteHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('远端地址无效，请提供完整的 http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('远端地址仅支持 http(s) URL');
  }
  if (!url.hostname) throw new Error('远端地址缺少主机名');
  if (url.username || url.password) {
    throw new Error('远端地址不得在 URL 中包含凭据');
  }
  return normalizeGitHubBlobUrl(url);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`远端响应超过 ${maxBytes} 字节限制`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value || next.value.byteLength === 0) continue;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel('response body exceeded byte limit');
        } catch {
          // Preserve the deterministic size-limit error.
        }
        throw new Error(`远端响应超过 ${maxBytes} 字节限制`);
      }
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<{ response: Response; cleanup(): void }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  };
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return { response, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function createOperationDeadline(
  timeoutMs: number,
  signal?: AbortSignal,
): {
  signal: AbortSignal;
  cleanup(): void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, Math.max(1, Math.floor(timeoutMs)));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

export async function fetchRemoteSkillMd(
  rawUrl: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<RemoteSkillFetchResult> {
  const url = parseRemoteHttpUrl(rawUrl);
  const request = await fetchWithTimeout(
    url.toString(),
    {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/markdown, text/plain;q=0.9, */*;q=0.2',
        'User-Agent': 'SYNC-THINK/remote-skill',
      },
    },
    options.timeoutMs ?? REMOTE_CAPABILITY_TIMEOUT_MS,
    options.signal,
    options.fetchImpl,
  );
  try {
    const { response } = request;
    if (!response.ok) throw new Error(`下载 Skill 失败：HTTP ${response.status}`);
    const bytes = await readBoundedBody(response, options.maxBytes ?? MAX_REMOTE_SKILL_BYTES);
    const skillMd = bytes.toString('utf8').replace(/^\uFEFF/, '');
    if (!skillMd.trim()) throw new Error('远端 SKILL.md 内容为空');
    return {
      url: response.url || url.toString(),
      skillMd,
      fetchedBytes: bytes.byteLength,
    };
  } finally {
    request.cleanup();
  }
}

function authHeaders(auth: RemoteMcpAuth | undefined): Record<string, string> {
  const key = String(auth?.key ?? '').trim();
  if (!key) return {};
  const scheme = String(auth?.scheme ?? 'bearer')
    .trim()
    .toLowerCase();
  if (scheme === 'api-key' || scheme === 'apikey' || scheme === 'x-api-key') {
    return { 'X-API-Key': key };
  }
  if (scheme === 'basic') {
    return { Authorization: `Basic ${key}` };
  }
  if (scheme === 'bearer' || !scheme) {
    return { Authorization: `Bearer ${key}` };
  }
  // Custom schemes are useful for relays that use a named auth scheme. The
  // key is still kept out of all returned metadata and error messages.
  return { Authorization: `${String(auth?.scheme).trim()} ${key}` };
}

export async function remoteMcpJsonRpc(
  rawEndpoint: string,
  method: string,
  params: Record<string, unknown> | undefined,
  options: {
    auth?: RemoteMcpAuth;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
    requestId?: number;
    sessionId?: string;
  } = {},
): Promise<RemoteMcpRequestResult> {
  const endpoint = parseRemoteHttpUrl(rawEndpoint);
  const request = await fetchWithTimeout(
    endpoint.toString(),
    {
      method: 'POST',
      redirect: 'follow',
      headers: {
        Accept: 'application/json, text/event-stream;q=0.9',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        ...(options.sessionId ? { 'Mcp-Session-Id': options.sessionId } : {}),
        ...authHeaders(options.auth),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: options.requestId ?? 1,
        method,
        ...(params ? { params } : {}),
      }),
    },
    options.timeoutMs ?? REMOTE_CAPABILITY_TIMEOUT_MS,
    options.signal,
    options.fetchImpl,
  );
  try {
    const { response } = request;
    if (!response.ok) throw new Error(`远端 MCP 请求失败：HTTP ${response.status}`);
    const bytes = await readBoundedBody(response, options.maxBytes ?? MAX_REMOTE_MCP_BYTES);
    const sessionId = response.headers.get('mcp-session-id')?.trim() || options.sessionId;
    const text = bytes.toString('utf8').trim();
    if (!text) throw new Error('远端 MCP 响应为空');

    // Streamable HTTP servers may return one JSON-RPC object or SSE data lines.
    let candidate = text;
    if (!candidate.startsWith('{')) {
      const dataLine = candidate
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('data:'));
      candidate = dataLine ? dataLine.slice('data:'.length).trim() : candidate;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      throw new Error('远端 MCP 返回了无法解析的 JSON-RPC 响应');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('远端 MCP 返回了无效的 JSON-RPC 响应');
    }
    const record = parsed as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === 'object' && !Array.isArray(error)) {
      const e = error as Record<string, unknown>;
      return {
        error: {
          code: typeof e.code === 'number' ? e.code : undefined,
          message: typeof e.message === 'string' ? e.message : undefined,
          data: e.data,
        },
        ...(sessionId ? { sessionId } : {}),
      };
    }
    return {
      result:
        record.result && typeof record.result === 'object' && !Array.isArray(record.result)
          ? (record.result as Record<string, unknown>)
          : {},
      ...(sessionId ? { sessionId } : {}),
    };
  } finally {
    request.cleanup();
  }
}

export async function remoteMcpNotification(
  rawEndpoint: string,
  method: string,
  params: Record<string, unknown> | undefined,
  options: {
    auth?: RemoteMcpAuth;
    signal?: AbortSignal;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    sessionId?: string;
  } = {},
): Promise<void> {
  const endpoint = parseRemoteHttpUrl(rawEndpoint);
  const request = await fetchWithTimeout(
    endpoint.toString(),
    {
      method: 'POST',
      redirect: 'follow',
      headers: {
        Accept: 'application/json, text/event-stream;q=0.9',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-06-18',
        ...(options.sessionId ? { 'Mcp-Session-Id': options.sessionId } : {}),
        ...authHeaders(options.auth),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method,
        ...(params ? { params } : {}),
      }),
    },
    options.timeoutMs ?? REMOTE_CAPABILITY_TIMEOUT_MS,
    options.signal,
    options.fetchImpl,
  );
  try {
    if (!request.response.ok) {
      throw new Error(`远端 MCP 通知失败：HTTP ${request.response.status}`);
    }
  } finally {
    request.cleanup();
  }
}

export async function discoverRemoteMcpTools(
  endpoint: string,
  options: {
    auth?: RemoteMcpAuth;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
    maxTools?: number;
  } = {},
): Promise<RemoteMcpTool[]> {
  const timeoutMs = options.timeoutMs ?? REMOTE_CAPABILITY_TIMEOUT_MS;
  const deadline = createOperationDeadline(timeoutMs, options.signal);
  const requestOptions = { ...options, timeoutMs, signal: deadline.signal };
  try {
    const initialize = await remoteMcpJsonRpc(
      endpoint,
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'sync-think', version: '1.0.0' },
      },
      requestOptions,
    );
    if (initialize.error) {
      throw new Error(initialize.error.message || '远端 MCP 初始化失败');
    }
    await remoteMcpNotification(endpoint, 'notifications/initialized', undefined, {
      ...requestOptions,
      sessionId: initialize.sessionId,
    });
    const listed = await remoteMcpJsonRpc(
      endpoint,
      'tools/list',
      {},
      {
        ...requestOptions,
        requestId: 2,
        sessionId: initialize.sessionId,
      },
    );
    if (listed.error) throw new Error(listed.error.message || '远端 MCP 工具发现失败');
    const rawTools = Array.isArray(listed.result?.tools) ? listed.result.tools : [];
    const maxTools = Math.min(Math.max(Math.floor(options.maxTools ?? 64), 1), 200);
    return rawTools.slice(0, maxTools).flatMap((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const rec = raw as Record<string, unknown>;
      const name = typeof rec.name === 'string' ? rec.name.trim() : '';
      if (!name) return [];
      const inputSchema = rec.inputSchema;
      return [
        {
          name,
          description: typeof rec.description === 'string' ? rec.description.trim() : '',
          inputSchemaJson:
            inputSchema && typeof inputSchema === 'object'
              ? JSON.stringify(inputSchema)
              : undefined,
        },
      ];
    });
  } finally {
    deadline.cleanup();
  }
}

export async function callRemoteMcpTool(
  endpoint: string,
  toolName: string,
  toolArguments: Record<string, unknown>,
  options: {
    auth?: RemoteMcpAuth;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<RemoteMcpToolCallResult> {
  const timeoutMs = options.timeoutMs ?? REMOTE_CAPABILITY_TIMEOUT_MS;
  const deadline = createOperationDeadline(timeoutMs, options.signal);
  const requestOptions = { ...options, timeoutMs, signal: deadline.signal };
  try {
    const initialize = await remoteMcpJsonRpc(
      endpoint,
      'initialize',
      {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'sync-think', version: '1.0.0' },
      },
      requestOptions,
    );
    if (initialize.error) throw new Error(initialize.error.message || '远端 MCP 初始化失败');
    await remoteMcpNotification(endpoint, 'notifications/initialized', undefined, {
      ...requestOptions,
      sessionId: initialize.sessionId,
    });
    const called = await remoteMcpJsonRpc(
      endpoint,
      'tools/call',
      { name: toolName, arguments: toolArguments },
      { ...requestOptions, requestId: 2, sessionId: initialize.sessionId },
    );
    if (called.error) throw new Error(called.error.message || '远端 MCP 工具调用失败');
    const result = called.result ?? {};
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const rec = item as Record<string, unknown>;
        if (typeof rec.text === 'string') return [rec.text];
        if (rec.type === 'json' && rec.json !== undefined) return [JSON.stringify(rec.json)];
        if (typeof rec.uri === 'string') return [rec.uri];
        return [];
      })
      .join('\n');
    return {
      ok: result.isError !== true,
      result,
      text: text || JSON.stringify(result),
      ...(called.sessionId || initialize.sessionId
        ? { sessionId: called.sessionId ?? initialize.sessionId }
        : {}),
    };
  } finally {
    deadline.cleanup();
  }
}

export function redactRemoteCapabilityError(
  error: unknown,
  secrets: readonly string[] = [],
): string {
  let message = error instanceof Error ? error.message : String(error ?? 'remote request failed');
  for (const secret of [...secrets]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)) {
    message = message.split(secret).join('[REDACTED]');
  }
  return message
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(x-api-key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
