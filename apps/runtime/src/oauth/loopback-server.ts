/**
 * Loopback HTTP server that captures the OAuth authorization code.
 *
 * The server binds on port 0 (system-assigned), registers one handler for
 * GET /oauth/callback, resolves a Promise with the code + state once it
 * arrives, and shuts itself down immediately after.
 *
 * Based on the pattern in apps/runtime/src/daemon/github-webhook-server.ts.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

export interface CallbackResult {
  code: string;
  state: string;
}

export interface CallbackError {
  error: string;
  errorDescription?: string;
  state?: string;
}

export type LoopbackCallbackOutcome =
  | ({ ok: true } & CallbackResult)
  | ({ ok: false } & CallbackError);

export interface LoopbackServerOptions {
  /**
   * Port for the redirect URI.
   *
   * Providers that require a pre-registered redirect — GitHub, Slack, Notion,
   * Figma and Gitee all do — pin the port, so the server has to reuse the one
   * the user typed into their app settings. `0` or absent lets the OS assign
   * one, which is fine for providers that accept any loopback port.
   */
  port?: number;
}

export interface LoopbackServer {
  /** The redirect_uri to hand to the OAuth provider. */
  redirectUri: string;
  /** Resolves when the provider posts back, or rejects on timeout / close. */
  waitForCallback(): Promise<LoopbackCallbackOutcome>;
  /** Tear down without waiting for a callback. */
  close(): void;
}

const CALLBACK_PATH = '/oauth/callback';
const BIND_HOST = '127.0.0.1';
/** Absolute upper bound — the broker sets its own flow TTL separately. */
const SERVER_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

function htmlResponse(res: ServerResponse, status: number, message: string): void {
  const body = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>SYNC-THINK OAuth</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;
justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
.card{background:#fff;border-radius:8px;padding:2rem 3rem;box-shadow:0 2px 8px rgba(0,0,0,.1);
text-align:center;max-width:400px}h1{margin:0 0 .5rem;font-size:1.25rem}</style>
</head><body><div class="card"><h1>${status < 400 ? '✓' : '✗'} ${message}</h1>
<p>You can close this tab and return to SYNC-THINK.</p></div></body></html>`;
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * Start a loopback HTTP server on a system-assigned port and return a handle
 * that exposes the redirect_uri and a promise that resolves with the result.
 */
export async function startLoopbackServer(
  options: LoopbackServerOptions = {},
): Promise<LoopbackServer> {
  const requestedPort = Number(options.port);
  let resolveCallback!: (outcome: LoopbackCallbackOutcome) => void;
  let rejectCallback!: (err: Error) => void;
  let settled = false;

  const callbackPromise = new Promise<LoopbackCallbackOutcome>((res, rej) => {
    resolveCallback = res;
    rejectCallback = rej;
  });

  function settle(outcome: LoopbackCallbackOutcome): void {
    if (settled) return;
    settled = true;
    resolveCallback(outcome);
    // Give the browser a moment to receive the HTML before we close.
    setTimeout(() => server.closeAllConnections?.(), 300);
    setTimeout(() => server.close(), 400);
  }

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${BIND_HOST}`);
    } catch {
      htmlResponse(res, 400, 'Bad request');
      return;
    }

    if (url.pathname !== CALLBACK_PATH) {
      htmlResponse(res, 404, 'Not found');
      return;
    }

    const error = url.searchParams.get('error');
    if (error) {
      htmlResponse(res, 400, 'Authorization denied');
      settle({
        ok: false,
        error,
        errorDescription: url.searchParams.get('error_description') ?? undefined,
        state: url.searchParams.get('state') ?? undefined,
      });
      return;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      htmlResponse(res, 400, 'Missing code or state');
      settle({ ok: false, error: 'missing_params' });
      return;
    }

    htmlResponse(res, 200, 'Authorization successful');
    settle({ ok: true, code, state });
  });

  // Promise-ified listen on a system-assigned port.
  await new Promise<void>((resolve, reject) => {
    function onError(err: Error): void {
      reject(err);
    }
    server.once('error', onError);
    server.listen(Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 0, BIND_HOST, () => {
      server.removeListener('error', onError);
      // Swallow post-startup errors — they must not crash the process.
      server.on('error', (err) => {
        console.error('[oauth/loopback] server error', err);
        if (!settled) {
          settle({ ok: false, error: 'server_error', errorDescription: String(err) });
        }
      });
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://${BIND_HOST}:${port}${CALLBACK_PATH}`;

  // Hard timeout — reject and tear down if the browser never calls back.
  const timeoutHandle = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectCallback(new Error('OAuth loopback server timed out'));
      server.closeAllConnections?.();
      server.close();
    }
  }, SERVER_TIMEOUT_MS);
  // Don't block process exit on this timer.
  timeoutHandle.unref();

  return {
    redirectUri,
    waitForCallback: () => callbackPromise,
    close(): void {
      clearTimeout(timeoutHandle);
      if (!settled) {
        settled = true;
        rejectCallback(new Error('Loopback server closed before callback'));
      }
      server.closeAllConnections?.();
      server.close();
    },
  };
}
