/**
 * GitHub webhook HTTP listener, hosted by the daemon.
 *
 * It lives in the daemon rather than the Runtime on purpose: the daemon is the
 * long-lived process (登录时由计划任务拉起), so a push still starts a run when
 * Desktop is closed and the Runtime is not even spawned yet — the coordinator's
 * `ensureRuntime()` brings it up on dispatch. Hosting this in the Runtime would
 * lose deliveries across every Runtime restart.
 *
 * Request handling order is security-first and deliberate:
 *   1. method/path       → cheapest rejection, no body read
 *   2. bounded body read → an unbounded read is a memory DoS before any auth
 *   3. HMAC over raw bytes → nothing downstream sees unverified input
 *   4. JSON parse + route match + envelope build
 *   5. submit to the inbox (dedupe/lease/dispatch already exist)
 *
 * Response contract follows GitHub's redelivery semantics: 2xx means "we own
 * it now" (the durable inbox row exists), non-2xx invites a retry with the same
 * `X-GitHub-Delivery`. Because the delivery id is the dedupe key, a retry after
 * a partial failure collapses onto the same row instead of double-running.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { ExternalEventEnvelope } from '@sync-think/shared';
import {
  GITHUB_WEBHOOK_BODY_CAP,
  GITHUB_WEBHOOK_PATH,
  buildGitHubEventEnvelope,
  matchGitHubRoute,
  verifyGitHubSignature,
  type GitHubDelivery,
  type GitHubWebhookConfig,
} from './github-webhook.js';

export interface GitHubWebhookSubmitResult {
  eventId: string;
  created: boolean;
}

export interface GitHubWebhookServerOptions {
  /**
   * Current configuration, read per request.
   *
   * A getter rather than a value: the daemon refreshes routes in place between
   * rescans instead of restarting the listener (a restart drops in-flight
   * deliveries). Holding a snapshot here would make those edits no-ops that
   * look applied — the listener would keep routing against the config it was
   * born with. Host and port are the exception: they are read once at bind
   * time, which is sound because a change to either alters the daemon's
   * binding fingerprint and forces a real restart.
   */
  config: () => GitHubWebhookConfig;
  /** Resolve the shared secret. Called per request so a rotation takes effect. */
  resolveSecret: () => Promise<string | undefined>;
  /** Hand the envelope to the durable inbox. */
  submit: (event: ExternalEventEnvelope) => GitHubWebhookSubmitResult;
  /** Diagnostics sink; never receives the secret or a signature. */
  onLog?: (message: string) => void;
  /**
   * Called on an error emitted after a successful bind, so the owner can
   * rebuild the listener. Without this the error would be unhandled and take
   * the whole daemon process down with it.
   */
  onError?: (error: Error) => void;
}

export interface GitHubWebhookServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

/** Outcome of one delivery, for logging and tests. */
export type GitHubWebhookOutcome =
  | { status: 200; result: 'accepted'; eventId: string; created: boolean }
  | { status: 200; result: 'ignored'; reason: string }
  | { status: 400 | 401 | 404 | 405 | 413 | 500; result: 'rejected'; reason: string };

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Read the body as raw bytes with a hard cap.
 *
 * The cap is enforced while streaming, not after: buffering an arbitrarily
 * large body first would be the very DoS the cap exists to prevent. The socket
 * is destroyed on overflow so a malicious sender cannot keep it open.
 */
function readBody(request: IncomingMessage, cap: number): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) {
        request.destroy();
        resolve('too-large');
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function parseJsonObject(body: Buffer): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decide what to do with one delivery. Pure apart from `resolveSecret`/`submit`,
 * so every branch below is reachable in tests without opening a socket.
 */
export async function handleGitHubDelivery(
  options: Pick<GitHubWebhookServerOptions, 'config' | 'resolveSecret' | 'submit'>,
  request: {
    method: string | undefined;
    path: string;
    headers: {
      event?: string;
      deliveryId?: string;
      signature?: string;
      contentType?: string;
    };
    body: Buffer | 'too-large';
  },
): Promise<GitHubWebhookOutcome> {
  if (request.path !== GITHUB_WEBHOOK_PATH) {
    return { status: 404, result: 'rejected', reason: 'unknown-path' };
  }
  if (request.method !== 'POST') {
    return { status: 405, result: 'rejected', reason: 'method-not-allowed' };
  }
  if (request.body === 'too-large') {
    return { status: 413, result: 'rejected', reason: 'body-too-large' };
  }

  const secret = await options.resolveSecret();
  if (!secret) {
    // Never fall through to unauthenticated handling: a missing secret means
    // the listener is misconfigured, not that the request is trustworthy.
    return { status: 500, result: 'rejected', reason: 'secret-unavailable' };
  }
  if (
    !verifyGitHubSignature({
      rawBody: request.body,
      signatureHeader: request.headers.signature,
      secret,
    })
  ) {
    return { status: 401, result: 'rejected', reason: 'invalid-signature' };
  }

  // Only past this point is the payload trusted enough to parse.
  const event = request.headers.event?.trim();
  const deliveryId = request.headers.deliveryId?.trim();
  if (!event || !deliveryId) {
    return { status: 400, result: 'rejected', reason: 'missing-delivery-headers' };
  }
  // `application/x-www-form-urlencoded` deliveries wrap the JSON in a
  // `payload=` field. Rather than silently mis-parsing, tell the user which
  // content type to configure.
  const contentType = request.headers.contentType ?? '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    return { status: 400, result: 'rejected', reason: 'unsupported-content-type' };
  }
  const payload = parseJsonObject(request.body);
  if (!payload) {
    return { status: 400, result: 'rejected', reason: 'invalid-json' };
  }

  // `ping` is GitHub's setup handshake; acknowledging it is what turns the hook
  // green in the repo settings.
  if (event === 'ping') {
    return { status: 200, result: 'ignored', reason: 'ping' };
  }

  const delivery: GitHubDelivery = { event, deliveryId, payload };
  const route = matchGitHubRoute(options.config(), delivery);
  if (!route) {
    // 200, not 4xx: an unrouted repository or branch is a valid subscription
    // the user simply does not act on. Returning an error would make GitHub
    // retry it forever and mark the hook as failing.
    return { status: 200, result: 'ignored', reason: 'no-matching-route' };
  }

  const envelope = buildGitHubEventEnvelope({ delivery, route });
  if (!envelope) {
    return { status: 200, result: 'ignored', reason: 'unsupported-payload' };
  }

  try {
    const submitted = options.submit(envelope);
    return {
      status: 200,
      result: 'accepted',
      eventId: submitted.eventId,
      created: submitted.created,
    };
  } catch (error) {
    // 500 so GitHub redelivers; the dedupe key makes that safe.
    return {
      status: 500,
      result: 'rejected',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function respond(response: ServerResponse, outcome: GitHubWebhookOutcome): void {
  const body =
    outcome.result === 'accepted'
      ? { ok: true, eventId: outcome.eventId, created: outcome.created }
      : { ok: outcome.result === 'ignored', reason: outcome.reason };
  const payload = JSON.stringify(body);
  response.writeHead(outcome.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

export async function startGitHubWebhookServer(
  options: GitHubWebhookServerOptions,
): Promise<GitHubWebhookServer> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        const path = (request.url ?? '/').split('?')[0] ?? '/';
        const body =
          request.method === 'POST'
            ? await readBody(request, GITHUB_WEBHOOK_BODY_CAP)
            : Buffer.alloc(0);
        const outcome = await handleGitHubDelivery(options, {
          method: request.method,
          path,
          headers: {
            ...(header(request, 'x-github-event')
              ? { event: header(request, 'x-github-event')! }
              : {}),
            ...(header(request, 'x-github-delivery')
              ? { deliveryId: header(request, 'x-github-delivery')! }
              : {}),
            ...(header(request, 'x-hub-signature-256')
              ? { signature: header(request, 'x-hub-signature-256')! }
              : {}),
            ...(header(request, 'content-type')
              ? { contentType: header(request, 'content-type')! }
              : {}),
          },
          body,
        });
        // The delivery id is the only handle that ties a line here to a row in
        // GitHub's "Recent Deliveries" list, so it is logged on every outcome —
        // including rejections, which are the ones worth investigating. It is
        // an opaque GUID and safe to record; the signature is deliberately
        // absent from every log line.
        const deliveryId = header(request, 'x-github-delivery') ?? '-';
        options.onLog?.(
          `[github-webhook] ${request.method ?? '?'} ${path} delivery=${deliveryId} → ` +
            `${outcome.status} ${outcome.result}` +
            (outcome.result === 'accepted'
              ? ` event=${outcome.eventId} created=${outcome.created}`
              : ` reason=${outcome.reason}`),
        );
        respond(response, outcome);
      } catch (error) {
        options.onLog?.(
          `[github-webhook] request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        respond(response, { status: 500, result: 'rejected', reason: 'internal-error' });
      }
    })();
  });

  // Bind-time snapshot: host/port participate in the daemon's binding
  // fingerprint, so a change to either restarts the listener rather than
  // needing to be observed here.
  const binding = options.config();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(binding.port, binding.host, () => {
      server.removeListener('error', reject);
      // Leaving the server with zero 'error' listeners would make any
      // post-bind error (accept-path EMFILE/ENFILE on a long-lived autostart
      // process) rethrow out of the EventEmitter. There is no
      // uncaughtException handler in the daemon, so that would kill the
      // scheduler and Runtime supervision — a webhook problem must never do
      // that. `onError` lets the daemon rebuild on the next rescan.
      server.on('error', (error) => {
        options.onLog?.(
          `[github-webhook] listener error: ${error instanceof Error ? error.message : String(error)}`,
        );
        options.onError?.(error);
      });
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : binding.port;
  return {
    host: binding.host,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
