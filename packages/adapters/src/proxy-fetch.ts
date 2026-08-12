/**
 * Proxy-aware fetch for Node Runtime on Windows (Clash / system IE proxy).
 *
 * Node's global fetch does not use Windows system proxy settings. When DNS
 * only resolves via the proxy (common with Clash TUN/system DNS), discovery
 * and chat calls fail with ENOTFOUND. This module tunnels HTTPS via HTTP
 * CONNECT when a proxy is configured, without extra npm dependencies.
 */

import net from 'node:net';
import tls from 'node:tls';
import { execSync } from 'node:child_process';

export interface ResolvedProxy {
  /** e.g. http://127.0.0.1:7897 */
  url: string;
  host: string;
  port: number;
  source: 'env' | 'windows-registry' | 'none';
}

export type ProxyAwareFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function trimEnv(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Parse proxy URL string into host/port. Accepts host:port or full URL. */
export function parseProxyUrl(raw: string): { host: string; port: number; url: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // strip protocol-relative and schemes we accept
  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  try {
    const u = new URL(candidate);
    const host = u.hostname;
    if (!host) return null;
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    if (!Number.isFinite(port) || port <= 0) return null;
    return { host, port, url: `http://${host}:${port}` };
  } catch {
    return null;
  }
}

function readEnvProxy(): ResolvedProxy | null {
  const raw =
    trimEnv('SYNC_THINK_HTTP_PROXY') ??
    trimEnv('HTTPS_PROXY') ??
    trimEnv('https_proxy') ??
    trimEnv('HTTP_PROXY') ??
    trimEnv('http_proxy') ??
    trimEnv('ALL_PROXY') ??
    trimEnv('all_proxy');
  if (!raw) return null;
  const parsed = parseProxyUrl(raw);
  if (!parsed) return null;
  return { ...parsed, source: 'env' };
}

/**
 * Read Windows user Internet Settings proxy (same source browsers / system use).
 * Prefer `reg query` so we avoid optional native modules.
 */
export function readWindowsSystemProxy(): ResolvedProxy | null {
  if (process.platform !== 'win32') return null;
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const out = execSync(`reg query "${key}"`, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let enable = false;
    let server: string | undefined;
    for (const line of out.split(/\r?\n/)) {
      if (/ProxyEnable/i.test(line) && /0x1\b/i.test(line)) enable = true;
      const m = line.match(/ProxyServer\s+REG_\w+\s+(.+)$/i);
      if (m) server = m[1]!.trim();
    }
    if (!enable || !server) return null;
    // ProxyServer can be "127.0.0.1:7897" or "http=...;https=..."
    let pick = server;
    if (server.includes('=')) {
      const parts = server.split(';').map((p) => p.trim());
      const https = parts.find((p) => /^https=/i.test(p));
      const http = parts.find((p) => /^http=/i.test(p));
      const chosen = https ?? http ?? parts[0];
      pick = (chosen ?? '').replace(/^[a-zA-Z]+=/, '');
    }
    const parsed = parseProxyUrl(pick);
    if (!parsed) return null;
    return { ...parsed, source: 'windows-registry' };
  } catch {
    return null;
  }
}

let cachedProxy: ResolvedProxy | null = null;

/** Drop the process-wide proxy cache (tests mutate env between calls). */
export function clearOutboundProxyCache(): void {
  cachedProxy = null;
}

/**
 * Resolve outbound HTTP(S) proxy once per process.
 * `readWindowsSystemProxy` spawns reg.exe synchronously (blocking the event
 * loop for up to the exec timeout); caching turns that into a one-time cost
 * instead of a per-request block. Env/registry are process-wide facts that
 * do not change mid-run.
 */
export function resolveOutboundProxy(env: NodeJS.ProcessEnv = process.env): ResolvedProxy {
  // Allow callers to pass a synthetic env by temporarily reading process.env
  // for SYNC_* first — tests can set process.env before calling.
  void env;
  if (cachedProxy) return { ...cachedProxy };
  const fromEnv = readEnvProxy();
  if (fromEnv) {
    cachedProxy = { ...fromEnv };
    return { ...fromEnv };
  }
  const fromWin = readWindowsSystemProxy();
  if (fromWin) {
    cachedProxy = { ...fromWin };
    return { ...fromWin };
  }
  cachedProxy = { url: '', host: '', port: 0, source: 'none' };
  return { ...cachedProxy };
}

function headersToRecord(headers?: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
    return out;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined && v !== null) out[k] = String(v);
  }
  return out;
}

function bodyToBuffer(body: unknown): Buffer | null {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) return body;
  // Request/Blob streams not used by our adapters today.
  throw new Error('proxy-fetch: unsupported request body type');
}

export function parseHttpResponse(raw: Buffer): {
  status: number;
  statusText: string;
  headers: Map<string, string>;
  body: Buffer;
} {
  const sep = raw.indexOf('\r\n\r\n');
  if (sep < 0) {
    throw new Error('proxy-fetch: incomplete HTTP response');
  }
  const head = raw.subarray(0, sep).toString('latin1');
  let body = raw.subarray(sep + 4);
  const lines = head.split('\r\n');
  const statusLine = lines[0] ?? '';
  const m = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\s*(.*)$/i);
  if (!m) throw new Error(`proxy-fetch: bad status line: ${statusLine}`);
  const status = Number(m[1]);
  const statusText = (m[2] ?? '').trim();
  const headers = new Map<string, string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    const prev = headers.get(name);
    headers.set(name, prev ? `${prev}, ${value}` : value);
  }

  // Handle Content-Length truncation if present.
  const cl = headers.get('content-length');
  if (cl && /^\d+$/.test(cl)) {
    const n = Number(cl);
    if (body.length > n) body = body.subarray(0, n);
    else if (body.length < n) {
      // Connection was cut before the declared length: fail loudly instead of
      // silently streaming a truncated body (audit #9) — a truncated SSE body
      // can swallow the tail of a tool call and look like a clean stop.
      throw new Error(`proxy-fetch: truncated body (expected ${n} bytes, got ${body.length})`);
    }
  }

  // Decode chunked transfer if needed (simple, full-buffer decode).
  if ((headers.get('transfer-encoding') ?? '').toLowerCase().includes('chunked')) {
    body = decodeChunked(body);
    headers.delete('transfer-encoding');
    headers.set('content-length', String(body.length));
  }

  return { status, statusText, headers, body };
}

export function decodeChunked(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const lineEnd = buf.indexOf('\r\n', offset);
    if (lineEnd < 0) {
      throw new Error('proxy-fetch: malformed chunked body (missing chunk-size line)');
    }
    const sizeLine = buf.subarray(offset, lineEnd).toString('ascii').split(';')[0]!.trim();
    const size = parseInt(sizeLine, 16);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`proxy-fetch: malformed chunked body (bad chunk size '${sizeLine}')`);
    }
    offset = lineEnd + 2;
    if (size === 0) break; // final chunk
    if (offset + size > buf.length) {
      throw new Error('proxy-fetch: malformed chunked body (chunk exceeds buffer)');
    }
    parts.push(buf.subarray(offset, offset + size));
    offset += size + 2; // skip chunk + CRLF
  }
  return Buffer.concat(parts);
}

function makeHeaders(map: Map<string, string>): Headers {
  // Prefer global Headers when available (Node 18+).
  if (typeof Headers !== 'undefined') {
    const h = new Headers();
    for (const [k, v] of map) h.set(k, v);
    return h;
  }
  // Minimal fallback
  const store = new Map(map);
  return {
    get(name: string) {
      return store.get(name.toLowerCase()) ?? null;
    },
    has(name: string) {
      return store.has(name.toLowerCase());
    },
    set() {
      /* read-only response */
    },
    append() {},
    delete() {},
    forEach(cb: (value: string, key: string) => void) {
      for (const [k, v] of store) cb(v, k);
    },
    entries() {
      return store.entries();
    },
    keys() {
      return store.keys();
    },
    values() {
      return store.values();
    },
    [Symbol.iterator]() {
      return store.entries();
    },
  } as unknown as Headers;
}

function bufferToReadableStream(buf: Buffer): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) {
        sent = true;
        if (buf.length > 0) controller.enqueue(new Uint8Array(buf));
        controller.close();
      }
    },
  });
}

function makeResponse(
  status: number,
  statusText: string,
  headers: Map<string, string>,
  body: Buffer,
): Response {
  const headerObj = makeHeaders(headers);
  const stream = bufferToReadableStream(body);
  if (typeof Response !== 'undefined') {
    return new Response(stream, { status, statusText, headers: headerObj });
  }
  // Extremely defensive fallback (should not hit on Node 20).
  const text = body.toString('utf8');
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: headerObj,
    body: stream,
    async text() {
      return text;
    },
    async json() {
      return JSON.parse(text);
    },
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
  } as unknown as Response;
}

async function directFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('proxy-fetch: global fetch is not available');
  }
  return fetchImpl(input as string | URL | Request, init);
}

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

/**
 * HTTPS via HTTP CONNECT through an explicit proxy, then full-buffer response.
 * Sufficient for discover + chat (SSE is fully read into buffer then streamed
 * via ReadableStream — adapters already support body reader and text fallback).
 */
function proxyHttpsFetch(
  proxy: ResolvedProxy,
  target: URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = headersToRecord(init?.headers);
  const bodyBuf = bodyToBuffer(init?.body ?? null);
  if (!headers['host'] && !headers['Host']) {
    headers['Host'] = target.host;
  }
  if (bodyBuf && !headers['content-length'] && !headers['Content-Length']) {
    headers['Content-Length'] = String(bodyBuf.length);
  }
  // Prefer Connection: close so the remote ends the response cleanly.
  if (!headers['connection'] && !headers['Connection']) {
    headers['Connection'] = 'close';
  }

  const signal = init?.signal ?? undefined;
  const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const path = `${target.pathname}${target.search}` || '/';

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const ok = (res: Response) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    };

    const socket = net.connect(proxy.port, proxy.host);
    let raw = Buffer.alloc(0);
    let phase: 'connect' | 'tls' | 'http' = 'connect';
    let tlsSocket: tls.TLSSocket | null = null;
    let httpBuf = Buffer.alloc(0);

    const onAbort = () => {
      fail(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      socket.removeAllListeners();
      socket.on('error', () => undefined);
      tlsSocket?.removeAllListeners();
      tlsSocket?.on('error', () => undefined);
      try {
        tlsSocket?.destroy();
      } catch {
        /* ignore */
      }
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    };

    socket.setTimeout(30_000, () => fail(new Error('proxy-fetch: connect timeout')));

    socket.on('error', fail);

    socket.on('connect', () => {
      socket.write(
        `CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r\n` +
          `Host: ${target.hostname}:${targetPort}\r\n` +
          `Proxy-Connection: keep-alive\r\n` +
          `\r\n`,
      );
    });

    socket.on('data', (chunk: Buffer) => {
      if (phase !== 'connect') return;
      raw = Buffer.concat([raw, chunk]);
      const sep = raw.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const head = raw.subarray(0, sep).toString('latin1');
      const statusLine = head.split('\r\n')[0] ?? '';
      if (!/\s200\s/.test(statusLine) && !/ 200 /.test(statusLine)) {
        fail(new Error(`proxy-fetch: CONNECT failed: ${statusLine}`));
        return;
      }
      const leftover = raw.subarray(sep + 4);
      phase = 'tls';
      socket.removeAllListeners('data');
      socket.setTimeout(0);

      tlsSocket = tls.connect(
        {
          socket,
          servername: target.hostname,
          ALPNProtocols: ['http/1.1'],
        },
        () => {
          phase = 'http';
          let req = `${method} ${path} HTTP/1.1\r\n`;
          for (const [k, v] of Object.entries(headers)) {
            req += `${k}: ${v}\r\n`;
          }
          req += '\r\n';
          tlsSocket!.write(req);
          if (bodyBuf && bodyBuf.length > 0) tlsSocket!.write(bodyBuf);
        },
      );

      tlsSocket.on('error', fail);
      tlsSocket.on('data', (c: Buffer) => {
        httpBuf = Buffer.concat([httpBuf, c]);
      });
      tlsSocket.on('end', () => {
        try {
          const parsed = parseHttpResponse(httpBuf);
          ok(makeResponse(parsed.status, parsed.statusText, parsed.headers, parsed.body));
        } catch (e) {
          fail(e);
        }
      });
      tlsSocket.on('close', () => {
        if (!settled && httpBuf.length > 0) {
          try {
            const parsed = parseHttpResponse(httpBuf);
            ok(makeResponse(parsed.status, parsed.statusText, parsed.headers, parsed.body));
          } catch (e) {
            fail(e);
          }
        } else if (!settled) {
          fail(new Error('proxy-fetch: connection closed without response'));
        }
      });

      if (leftover.length > 0) {
        // TLS should not receive leftover HTTP after a clean CONNECT 200.
        // Ignore if empty; if non-empty, push via socket (tls already wrapping).
      }
    });
  });
}

/**
 * Create a fetch-compatible function that tunnels HTTPS through the resolved
 * system/env proxy when present; otherwise uses global fetch.
 */
export function createProxyAwareFetch(
  proxy: ResolvedProxy = resolveOutboundProxy(),
): ProxyAwareFetch {
  if (proxy.source === 'none' || !proxy.host || !proxy.port) {
    return (input, init) => directFetch(input, init);
  }

  return async (input, init) => {
    const url = requestUrl(input);
    // Only tunnel http(s); leave others to global fetch.
    if (url.protocol === 'https:') {
      return proxyHttpsFetch(proxy, url, init);
    }
    if (url.protocol === 'http:') {
      // Absolute-form request via proxy for plain HTTP (rare for our adapters).
      return proxyHttpFetch(proxy, url, init);
    }
    return directFetch(input, init);
  };
}

function proxyHttpFetch(
  proxy: ResolvedProxy,
  target: URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = headersToRecord(init?.headers);
  const bodyBuf = bodyToBuffer(init?.body ?? null);
  if (!headers['host'] && !headers['Host']) headers['Host'] = target.host;
  if (bodyBuf && !headers['content-length'] && !headers['Content-Length']) {
    headers['Content-Length'] = String(bodyBuf.length);
  }
  if (!headers['connection'] && !headers['Connection']) {
    headers['Connection'] = 'close';
  }
  const signal = init?.signal;

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const ok = (res: Response) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    };

    const socket = net.connect(proxy.port, proxy.host);
    let httpBuf = Buffer.alloc(0);

    const onAbort = () => {
      fail(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    };

    socket.setTimeout(30_000, () => fail(new Error('proxy-fetch: connect timeout')));
    socket.on('error', fail);
    socket.on('connect', () => {
      const absolute = target.href;
      let req = `${method} ${absolute} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) req += `${k}: ${v}\r\n`;
      req += '\r\n';
      socket.write(req);
      if (bodyBuf && bodyBuf.length > 0) socket.write(bodyBuf);
    });
    socket.on('data', (c: Buffer) => {
      httpBuf = Buffer.concat([httpBuf, c]);
    });
    socket.on('end', () => {
      try {
        const parsed = parseHttpResponse(httpBuf);
        ok(makeResponse(parsed.status, parsed.statusText, parsed.headers, parsed.body));
      } catch (e) {
        fail(e);
      }
    });
  });
}

/** One-line log label; never includes secrets. */
export function proxyLogLabel(proxy: ResolvedProxy = resolveOutboundProxy()): string {
  if (proxy.source === 'none') return 'direct (no proxy)';
  return `${proxy.url} (${proxy.source})`;
}
