import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { getIP } from 'better-auth/api';
import type { CloudConfig } from './config.js';
import { createAuthService, type AuthServiceOptions } from './auth.js';
import { isDemoPath, readWebsiteFile } from './static.js';

export interface CloudServer {
  url: string;
  close(): Promise<void>;
}

export type CloudServerOptions = AuthServiceOptions;

const MAX_BODY_BYTES = 16 * 1024;
const AUTH_POST_PATHS = new Set([
  '/sign-up/email',
  '/sign-in/email',
  '/sign-out',
  '/send-verification-email',
  '/request-password-reset',
  '/reset-password',
  '/change-password',
]);

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function readJsonBody(request: IncomingMessage): Promise<string> {
  if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
    throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onAborted = () =>
      onError(new HttpError(400, 'REQUEST_ABORTED', 'Request was interrupted.'));
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        cleanup();
        request.pause();
        reject(new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.'));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        JSON.parse(body);
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'Enter a valid request.'));
        return;
      }
      resolve(body);
    };
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function requestHeaders(request: IncomingMessage, config: CloudConfig): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const direct = request.socket.remoteAddress ?? '127.0.0.1';
  const proxyIsLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct);
  const forwarded = request.headers['x-real-ip'];
  const clientIp =
    config.trustProxy && proxyIsLocal && typeof forwarded === 'string' && isIP(forwarded)
      ? forwarded
      : direct;
  headers.set('x-sync-think-client-ip', clientIp);
  return headers;
}

export async function startCloudServer(
  config: CloudConfig,
  options: CloudServerOptions = {},
): Promise<CloudServer> {
  const service = await createAuthService(config, options);
  const emailEnabled = Boolean(service && config.smtp);
  const registrationEnabled = emailEnabled && config.allowSignup;
  const authBudgets = new Map<string, { count: number; expiresAt: number }>();
  const handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (
      !request.url?.startsWith('/') ||
      request.url.startsWith('//') ||
      request.url.includes('\\')
    ) {
      throw new HttpError(400, 'INVALID_PATH', 'Request path is invalid.');
    }
    const url = new URL(request.url ?? '/', config.origin);
    const pathname = url.pathname;
    const headers = requestHeaders(request, config);
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.');
    }
    if (method === 'POST' && !pathname.startsWith('/api/auth/')) {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported.');
    }
    if (isDemoPath(pathname)) {
      const parents = ["'self'", ...config.embedOrigins].join(' ');
      if (config.embedOrigins.length) response.removeHeader('x-frame-options');
      else response.setHeader('x-frame-options', 'SAMEORIGIN');
      response.setHeader(
        'content-security-policy',
        `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${parents}`,
      );
    }
    if (pathname === '/api/config') {
      json(response, 200, { registrationEnabled, emailEnabled });
    } else if (pathname === '/api/health') {
      json(response, 200, { status: 'ok' });
    } else if (pathname.startsWith('/api/auth/')) {
      const clientIp =
        getIP(headers, {
          advanced: { ipAddress: { ipAddressHeaders: ['x-sync-think-client-ip'] } },
        }) ?? 'unknown';
      const now = performance.now();
      let budget = authBudgets.get(clientIp);
      if (!budget || budget.expiresAt <= now) {
        if (authBudgets.size >= 10_000) {
          for (const [ip, entry] of authBudgets) if (entry.expiresAt <= now) authBudgets.delete(ip);
          if (authBudgets.size >= 10_000)
            throw new HttpError(503, 'SERVER_BUSY', 'Please try again shortly.');
        }
        budget = { count: 0, expiresAt: now + 60_000 };
        authBudgets.set(clientIp, budget);
      }
      budget.count += 1;
      if (budget.count > 120) {
        response.setHeader('retry-after', Math.max(1, Math.ceil((budget.expiresAt - now) / 1000)));
        throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.');
      }
      const authPath = pathname.slice('/api/auth'.length);
      if (method === 'POST') {
        if (!AUTH_POST_PATHS.has(authPath))
          throw new HttpError(404, 'NOT_FOUND', 'Endpoint not found.');
        if (request.headers.origin !== config.origin)
          throw new HttpError(
            403,
            'INVALID_ORIGIN',
            'Please submit this request from the SYNC-THINK website.',
          );
        if (
          request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
        ) {
          throw new HttpError(415, 'JSON_REQUIRED', 'JSON content is required.');
        }
      } else if (
        authPath !== '/get-session' &&
        authPath !== '/verify-email' &&
        !/^\/reset-password\/[^/]+$/.test(authPath)
      ) {
        throw new HttpError(404, 'NOT_FOUND', 'Endpoint not found.');
      }
      if (!service) {
        request.resume();
        json(response, 503, {
          code: 'AUTH_NOT_CONFIGURED',
          message: 'Account service is not configured yet.',
        });
        return;
      }
      if (
        method === 'POST' &&
        ['/sign-up/email', '/send-verification-email', '/request-password-reset'].includes(
          authPath,
        ) &&
        !emailEnabled
      ) {
        throw new HttpError(
          503,
          'EMAIL_NOT_CONFIGURED',
          'Email delivery is not configured yet. Please try again later.',
        );
      }
      if (authPath === '/sign-up/email' && !registrationEnabled) {
        throw new HttpError(403, 'REGISTRATION_DISABLED', 'Registration is currently closed.');
      }
      const body = method === 'POST' ? await readJsonBody(request) : undefined;
      const result = await service.handler(
        new Request(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
        }),
      );
      response.statusCode = result.status;
      for (const [name, value] of result.headers) {
        if (name !== 'set-cookie') response.setHeader(name, value);
      }
      const cookies = result.headers.getSetCookie();
      if (cookies.length) response.setHeader('set-cookie', cookies);
      response.setHeader('cache-control', 'no-store');
      const resultBody = Buffer.from(await result.arrayBuffer());
      if (resultBody.length && result.headers.get('content-type')?.includes('application/json')) {
        const value: unknown = JSON.parse(resultBody.toString('utf8'));
        // Browser authentication uses only HttpOnly cookies; never expose the bearer value in JSON.
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const record = value as Record<string, unknown>;
          delete record.token;
          if (record.session && typeof record.session === 'object') {
            delete (record.session as Record<string, unknown>).token;
          }
        }
        response.removeHeader('content-length');
        response.end(JSON.stringify(value));
      } else {
        response.end(resultBody);
      }
    } else if (pathname === '/account') {
      const session = service ? await service.hasSession(headers) : false;
      if (!session) {
        response.writeHead(303, {
          location: '/login?next=%2Faccount',
          'cache-control': 'no-store',
        });
        response.end();
      } else {
        const file = await readWebsiteFile(config.websiteDirectory, pathname);
        if (!file) throw new HttpError(404, 'NOT_FOUND', 'Page not found.');
        response.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' });
        response.end(method === 'HEAD' ? undefined : file.body);
      }
    } else {
      const file = await readWebsiteFile(config.websiteDirectory, pathname);
      if (!file) throw new HttpError(404, 'NOT_FOUND', 'Page not found.');
      response.writeHead(200, {
        'content-type': file.type,
        'cache-control': file.type.startsWith('text/html') ? 'no-store' : 'no-cache',
      });
      response.end(method === 'HEAD' ? undefined : file.body);
    }
  };
  const activeRequests = new Set<Promise<void>>();
  const server = createServer((request, response) => {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    if (config.origin.startsWith('https:'))
      response.setHeader('strict-transport-security', 'max-age=31536000');
    const pending = handleRequest(request, response).catch((error: unknown) => {
      if (!(error instanceof HttpError)) options.onLog?.('cloud.http.request_failed');
      if (!response.headersSent) {
        response.setHeader('connection', 'close');
        json(response, error instanceof HttpError ? error.status : 500, {
          code: error instanceof HttpError ? error.code : 'SERVER_ERROR',
          message: error instanceof HttpError ? error.message : 'Please try again later.',
        });
      } else response.destroy();
    });
    activeRequests.add(pending);
    void pending.finally(() => activeRequests.delete(pending));
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await service?.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Cloud listener did not bind a TCP address');
  let closing: Promise<void> | undefined;
  return {
    url: `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${address.port}`,
    close: () => {
      closing ??= (async () => {
        const forceClose = setTimeout(() => server.closeAllConnections(), 10_000);
        forceClose.unref();
        try {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeIdleConnections();
          });
          await Promise.allSettled(activeRequests);
          await service?.close();
        } finally {
          clearTimeout(forceClose);
        }
      })();
      return closing;
    },
  };
}
