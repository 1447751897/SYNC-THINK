/**
 * GitHub webhook HTTP listener.
 *
 * The contract under test is GitHub's redelivery semantics: 2xx means the
 * durable inbox owns the delivery, non-2xx invites a retry with the same
 * `X-GitHub-Delivery`. Getting a status code wrong here is not cosmetic — a 4xx
 * on an unrouted repository makes GitHub retry forever and red-flag the hook,
 * while a 200 on a failed submit loses the event permanently.
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
  handleGitHubDelivery,
  startGitHubWebhookServer,
  type GitHubWebhookSubmitResult,
} from '../src/daemon/github-webhook-server.js';
import { GITHUB_WEBHOOK_PATH, type GitHubWebhookConfig } from '../src/daemon/github-webhook.js';
import type { ExternalEventEnvelope } from '@sync-think/shared';

const SECRET = 'shared-webhook-secret';

const CONFIG: GitHubWebhookConfig = {
  enabled: true,
  host: '127.0.0.1',
  // Port 0 lets the OS pick a free one; tests must never fight over 8765.
  port: 0,
  secretHandle: 'handle-1',
  routes: [
    {
      id: 'acme/widgets',
      repository: 'acme/widgets',
      target: { kind: 'model', modelId: 'model-1' },
    },
  ],
};

function pushBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ref: 'refs/heads/main',
    after: '2222222222222222222222222222222222222222',
    repository: { full_name: 'acme/widgets' },
    pusher: { name: 'octocat' },
    commits: [{ id: 'abc123', message: 'chore: touch', author: { name: 'octocat' } }],
    ...overrides,
  });
}

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex')}`;
}

/** Inbox double mirroring the real `INSERT OR IGNORE` on dedupe_key. */
function fakeInbox() {
  const byDedupeKey = new Map<string, string>();
  const submitted: ExternalEventEnvelope[] = [];
  return {
    submitted,
    submit(event: ExternalEventEnvelope): GitHubWebhookSubmitResult {
      submitted.push(event);
      const existing = byDedupeKey.get(event.dedupeKey);
      if (existing) return { eventId: existing, created: false };
      byDedupeKey.set(event.dedupeKey, event.id);
      return { eventId: event.id, created: true };
    },
  };
}

function deliver(
  overrides: {
    config?: GitHubWebhookConfig;
    secret?: string | undefined;
    submit?: (event: ExternalEventEnvelope) => GitHubWebhookSubmitResult;
    method?: string;
    path?: string;
    event?: string;
    deliveryId?: string;
    signature?: string;
    contentType?: string;
    body?: string | Buffer | 'too-large';
  } = {},
) {
  const body =
    overrides.body === 'too-large'
      ? ('too-large' as const)
      : Buffer.from(
          typeof overrides.body === 'string' || Buffer.isBuffer(overrides.body)
            ? overrides.body
            : pushBody(),
          'utf8',
        );
  const rawText = body === 'too-large' ? '' : body.toString('utf8');
  const config = overrides.config ?? CONFIG;
  return handleGitHubDelivery(
    {
      config: () => config,
      resolveSecret: async () => ('secret' in overrides ? overrides.secret : SECRET),
      submit: overrides.submit ?? (() => ({ eventId: 'evt-1', created: true })),
    },
    {
      method: overrides.method ?? 'POST',
      path: overrides.path ?? GITHUB_WEBHOOK_PATH,
      headers: {
        event: overrides.event ?? 'push',
        deliveryId: overrides.deliveryId ?? 'delivery-1',
        signature: overrides.signature ?? sign(rawText),
        contentType: overrides.contentType ?? 'application/json',
      },
      body,
    },
  );
}

describe('github webhook delivery handling', () => {
  it('accepts a signed push and hands it to the inbox', async () => {
    const inbox = fakeInbox();
    const outcome = await deliver({ submit: inbox.submit });
    expect(outcome).toMatchObject({ status: 200, result: 'accepted', created: true });
    expect(inbox.submitted).toHaveLength(1);
    expect(inbox.submitted[0]).toMatchObject({
      dedupeKey: 'git:github:delivery-1',
      target: { kind: 'model', modelId: 'model-1' },
    });
  });

  it('collapses a redelivery of the same delivery id onto one inbox row', async () => {
    // GitHub retries with the same X-GitHub-Delivery after a non-2xx. The
    // second attempt must report accepted (so GitHub stops) without starting a
    // second run.
    const inbox = fakeInbox();
    const first = await deliver({ submit: inbox.submit, deliveryId: 'delivery-7' });
    const second = await deliver({ submit: inbox.submit, deliveryId: 'delivery-7' });
    expect(first).toMatchObject({ status: 200, result: 'accepted', created: true });
    expect(second).toMatchObject({ status: 200, result: 'accepted', created: false });
    expect(first.result === 'accepted' && second.result === 'accepted').toBe(true);
    if (first.result === 'accepted' && second.result === 'accepted') {
      expect(second.eventId).toBe(first.eventId);
    }
  });

  it('rejects an unsigned, wrongly-signed or tampered body with 401', async () => {
    const body = pushBody();
    for (const signature of [
      undefined,
      sign(body, 'wrong-secret'),
      sign(pushBody({ after: 'x' })),
    ]) {
      const outcome = await deliver({
        body,
        ...(signature ? { signature } : { signature: '' }),
      });
      expect(outcome).toMatchObject({
        status: 401,
        result: 'rejected',
        reason: 'invalid-signature',
      });
    }
  });

  it('never submits anything it could not verify', async () => {
    const inbox = fakeInbox();
    await deliver({ submit: inbox.submit, signature: 'sha256=deadbeef' });
    expect(inbox.submitted).toHaveLength(0);
  });

  it('returns 500 rather than falling through when the secret is unavailable', async () => {
    // A misconfigured listener must not degrade into an unauthenticated one.
    const inbox = fakeInbox();
    const outcome = await deliver({ submit: inbox.submit, secret: undefined });
    expect(outcome).toMatchObject({
      status: 500,
      result: 'rejected',
      reason: 'secret-unavailable',
    });
    expect(inbox.submitted).toHaveLength(0);
  });

  it('rejects a body over the cap before authenticating it', async () => {
    const outcome = await deliver({ body: 'too-large' });
    expect(outcome).toMatchObject({ status: 413, result: 'rejected', reason: 'body-too-large' });
  });

  it('rejects an unknown path and a non-POST method', async () => {
    expect(await deliver({ path: '/' })).toMatchObject({ status: 404, reason: 'unknown-path' });
    expect(await deliver({ method: 'GET' })).toMatchObject({
      status: 405,
      reason: 'method-not-allowed',
    });
  });

  it('rejects form-urlencoded deliveries with actionable guidance', async () => {
    // GitHub's other content type wraps the JSON in `payload=`; mis-parsing it
    // silently would be worse than telling the user to switch the setting.
    expect(await deliver({ contentType: 'application/x-www-form-urlencoded' })).toMatchObject({
      status: 400,
      reason: 'unsupported-content-type',
    });
  });

  it('rejects a signed but non-JSON body', async () => {
    expect(await deliver({ body: 'not json' })).toMatchObject({
      status: 400,
      reason: 'invalid-json',
    });
  });

  it('rejects a delivery missing the GitHub headers', async () => {
    const body = pushBody();
    const outcome = await handleGitHubDelivery(
      {
        config: () => CONFIG,
        resolveSecret: async () => SECRET,
        submit: () => ({ eventId: 'evt', created: true }),
      },
      {
        method: 'POST',
        path: GITHUB_WEBHOOK_PATH,
        headers: { signature: sign(body), contentType: 'application/json' },
        body: Buffer.from(body, 'utf8'),
      },
    );
    expect(outcome).toMatchObject({ status: 400, reason: 'missing-delivery-headers' });
  });

  it('acknowledges the ping handshake so the hook turns green', async () => {
    const inbox = fakeInbox();
    const body = JSON.stringify({ zen: 'Non-blocking is better.', hook_id: 1 });
    const outcome = await deliver({ submit: inbox.submit, event: 'ping', body });
    expect(outcome).toMatchObject({ status: 200, result: 'ignored', reason: 'ping' });
    expect(inbox.submitted).toHaveLength(0);
  });

  it('ignores an unrouted repository with 200, not an error', async () => {
    // A 4xx would make GitHub retry forever and mark the hook as failing, even
    // though "subscribed but not acted on" is a legitimate configuration.
    const inbox = fakeInbox();
    const outcome = await deliver({
      submit: inbox.submit,
      body: pushBody({ repository: { full_name: 'acme/other' } }),
    });
    expect(outcome).toMatchObject({ status: 200, result: 'ignored', reason: 'no-matching-route' });
    expect(inbox.submitted).toHaveLength(0);
  });

  it('ignores an unsubscribed event type with 200', async () => {
    const outcome = await deliver({
      event: 'pull_request',
      body: JSON.stringify({ repository: { full_name: 'acme/widgets' }, action: 'opened' }),
    });
    expect(outcome).toMatchObject({ status: 200, result: 'ignored', reason: 'no-matching-route' });
  });

  it('routes against the current config, not the one it started with', async () => {
    // The daemon refreshes routes in place between rescans instead of
    // restarting the listener (a restart drops in-flight deliveries). If the
    // handler held a snapshot, every `pnpm webhook:github setup` after the
    // first would appear to succeed and silently never take effect.
    const inbox = fakeInbox();
    let current: GitHubWebhookConfig = { ...CONFIG, routes: [] };
    const options = {
      config: () => current,
      resolveSecret: async () => SECRET,
      submit: inbox.submit,
    };
    const body = pushBody();
    const request = {
      method: 'POST',
      path: GITHUB_WEBHOOK_PATH,
      headers: {
        event: 'push',
        deliveryId: 'delivery-live',
        signature: sign(body),
        contentType: 'application/json',
      },
      body: Buffer.from(body, 'utf8'),
    };

    expect(await handleGitHubDelivery(options, request)).toMatchObject({
      result: 'ignored',
      reason: 'no-matching-route',
    });
    current = CONFIG;
    expect(await handleGitHubDelivery(options, request)).toMatchObject({ result: 'accepted' });
    expect(inbox.submitted).toHaveLength(1);
  });

  it('returns 500 when the inbox write fails so GitHub redelivers', async () => {
    const outcome = await deliver({
      submit: () => {
        throw new Error('database is locked');
      },
    });
    expect(outcome).toMatchObject({
      status: 500,
      result: 'rejected',
      reason: 'database is locked',
    });
  });
});

interface RawResponse {
  status: number;
  body: string;
}

function post(
  port: number,
  path: string,
  body: string,
  headers: Record<string, string>,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('github webhook listener over a real socket', () => {
  it('serves a signed push end to end and logs without leaking the signature', async () => {
    const inbox = fakeInbox();
    const logs: string[] = [];
    const server = await startGitHubWebhookServer({
      config: () => CONFIG,
      resolveSecret: async () => SECRET,
      submit: inbox.submit,
      onLog: (message) => logs.push(message),
    });
    try {
      const body = pushBody();
      const signature = sign(body);
      const response = await post(server.port, GITHUB_WEBHOOK_PATH, body, {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'delivery-socket-1',
        'x-hub-signature-256': signature,
      });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject({ ok: true, created: true });
      expect(inbox.submitted).toHaveLength(1);
      // Loopback by default: the user supplies their own tunnel/proxy.
      expect(server.host).toBe('127.0.0.1');
      // The delivery id must be in the log so a run can be traced back to a row
      // in GitHub's "Recent Deliveries" list.
      expect(logs.join('\n')).toContain('delivery=delivery-socket-1');
      expect(logs.join('\n')).not.toContain(signature);
      expect(logs.join('\n')).not.toContain(SECRET);
    } finally {
      await server.close();
    }
  });

  it('rejects a bad signature over the wire without touching the inbox', async () => {
    const inbox = fakeInbox();
    const logs: string[] = [];
    const server = await startGitHubWebhookServer({
      config: () => CONFIG,
      resolveSecret: async () => SECRET,
      submit: inbox.submit,
      onLog: (message) => logs.push(message),
    });
    try {
      const body = pushBody();
      const response = await post(server.port, GITHUB_WEBHOOK_PATH, body, {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'delivery-socket-2',
        'x-hub-signature-256': sign(body, 'not-the-secret'),
      });
      expect(response.status).toBe(401);
      expect(inbox.submitted).toHaveLength(0);
      // A rejection is the case most worth investigating, so it must carry the
      // delivery id too — not just the accepted path.
      expect(logs.join('\n')).toContain('delivery=delivery-socket-2');
      expect(logs.join('\n')).toContain('invalid-signature');
    } finally {
      await server.close();
    }
  });

  it('stops accepting connections after close', async () => {
    const server = await startGitHubWebhookServer({
      config: () => CONFIG,
      resolveSecret: async () => SECRET,
      submit: () => ({ eventId: 'evt', created: true }),
    });
    const { port } = server;
    await server.close();
    await expect(
      post(port, GITHUB_WEBHOOK_PATH, '{}', { 'content-type': 'application/json' }),
    ).rejects.toThrow();
  });
});
