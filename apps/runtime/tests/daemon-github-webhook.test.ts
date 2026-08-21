/**
 * GitHub webhook producer layer: signature, routing, payload projection.
 *
 * These tests pin the three properties that make the layer safe to expose:
 * only genuinely signed bodies get through, only configured repositories start
 * a run, and the projected metadata always survives the daemon's protocol
 * boundary (64KiB cap + sensitive-key rejection).
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  DISABLED_GITHUB_WEBHOOK_CONFIG,
  branchFromRef,
  buildGitHubEventEnvelope,
  githubWebhookBindingFingerprint,
  matchGitHubRoute,
  parseGitHubWebhookConfig,
  shouldServeGitHubWebhook,
  summarizeGitHubPush,
  verifyGitHubSignature,
  type GitHubWebhookConfig,
  type GitHubWebhookRouteConfig,
} from '../src/daemon/github-webhook.js';
import { parseExternalEventFrame } from '../src/daemon/external-event-protocol.js';

const SECRET = 'it-is-a-secret-to-everybody';

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex')}`;
}

function pushPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref: 'refs/heads/main',
    before: '1111111111111111111111111111111111111111',
    after: '2222222222222222222222222222222222222222',
    created: false,
    deleted: false,
    forced: false,
    compare: 'https://github.com/acme/widgets/compare/1111111...2222222',
    repository: { full_name: 'acme/widgets', private: true },
    pusher: { name: 'octocat', email: 'octocat@example.com' },
    sender: { login: 'octocat', id: 1 },
    commits: [
      {
        id: 'abcdef1234567890abcdef',
        message: 'fix: handle empty payload\n\nSigned-off-by: octocat',
        author: { name: 'octocat', email: 'octocat@example.com' },
        timestamp: '2026-08-21T10:00:00Z',
        added: ['a.ts'],
        removed: [],
        modified: ['b.ts', 'c.ts'],
      },
    ],
    ...overrides,
  };
}

const ROUTE: GitHubWebhookRouteConfig = {
  id: 'acme/widgets',
  repository: 'acme/widgets',
  target: { kind: 'model', modelId: 'model-1' },
};

function configWith(routes: GitHubWebhookRouteConfig[]): GitHubWebhookConfig {
  return { enabled: true, host: '127.0.0.1', port: 8765, secretHandle: 'handle-1', routes };
}

describe('github webhook signature', () => {
  it('accepts a signature computed over the exact received bytes', () => {
    const body = JSON.stringify(pushPayload());
    expect(
      verifyGitHubSignature({
        rawBody: Buffer.from(body, 'utf8'),
        signatureHeader: sign(body),
        secret: SECRET,
      }),
    ).toBe(true);
  });

  it('rejects a signature computed over a re-serialized body', () => {
    // The whole reason the raw Buffer is carried through the server: parsing
    // and re-stringifying normalizes whitespace and breaks the HMAC. GitHub
    // really does send pretty-printed-ish bodies, so this is not hypothetical.
    const body = '{\n  "b": 2,\n  "a": 1\n}';
    const reserialized = JSON.stringify(JSON.parse(body) as unknown);
    expect(reserialized).not.toBe(body);
    expect(
      verifyGitHubSignature({
        rawBody: Buffer.from(reserialized, 'utf8'),
        signatureHeader: sign(body),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a wrong secret, a missing header and a truncated digest', () => {
    const body = JSON.stringify(pushPayload());
    const rawBody = Buffer.from(body, 'utf8');
    expect(
      verifyGitHubSignature({ rawBody, signatureHeader: sign(body, 'other'), secret: SECRET }),
    ).toBe(false);
    expect(verifyGitHubSignature({ rawBody, signatureHeader: undefined, secret: SECRET })).toBe(
      false,
    );
    // Length mismatch must return false, not throw out of timingSafeEqual.
    expect(
      verifyGitHubSignature({
        rawBody,
        signatureHeader: sign(body).slice(0, 20),
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    const body = '{}';
    expect(
      verifyGitHubSignature({
        rawBody: Buffer.from(body, 'utf8'),
        signatureHeader: sign(body, ''),
        secret: '',
      }),
    ).toBe(false);
  });
});

describe('github webhook config', () => {
  it('falls back to the disabled default for malformed settings', () => {
    expect(parseGitHubWebhookConfig(undefined)).toEqual(DISABLED_GITHUB_WEBHOOK_CONFIG);
    expect(parseGitHubWebhookConfig('nonsense')).toEqual(DISABLED_GITHUB_WEBHOOK_CONFIG);
    expect(parseGitHubWebhookConfig({ enabled: true, port: -5 }).port).toBe(8765);
  });

  it('drops routes without a repository or a resolvable target', () => {
    const config = parseGitHubWebhookConfig({
      enabled: true,
      routes: [
        { repository: 'acme/widgets', target: { kind: 'model', modelId: 'm' } },
        { repository: 'acme/no-target' },
        { target: { kind: 'model', modelId: 'm' } },
        { repository: 'acme/bad-target', target: { kind: 'model' } },
      ],
    });
    expect(config.routes.map((route) => route.repository)).toEqual(['acme/widgets']);
  });

  it('refuses to serve without a secret or without routes', () => {
    expect(shouldServeGitHubWebhook(configWith([ROUTE]))).toBe(true);
    expect(shouldServeGitHubWebhook({ ...configWith([ROUTE]), secretHandle: undefined })).toBe(
      false,
    );
    expect(shouldServeGitHubWebhook(configWith([]))).toBe(false);
    expect(shouldServeGitHubWebhook({ ...configWith([ROUTE]), enabled: false })).toBe(false);
  });

  it('changes the binding fingerprint only for listener-affecting fields', () => {
    const base = configWith([ROUTE]);
    // Adding a route must not restart the listener (deliveries would be lost).
    expect(
      githubWebhookBindingFingerprint({
        ...base,
        routes: [ROUTE, { ...ROUTE, id: 'acme/other', repository: 'acme/other' }],
      }),
    ).toBe(githubWebhookBindingFingerprint(base));
    expect(githubWebhookBindingFingerprint({ ...base, port: 9000 })).not.toBe(
      githubWebhookBindingFingerprint(base),
    );
    expect(githubWebhookBindingFingerprint({ ...base, secretHandle: 'handle-2' })).not.toBe(
      githubWebhookBindingFingerprint(base),
    );
    expect(githubWebhookBindingFingerprint({ ...base, enabled: false })).not.toBe(
      githubWebhookBindingFingerprint(base),
    );
  });
});

describe('github webhook routing', () => {
  it('matches a repository case-insensitively and defaults to push only', () => {
    const config = configWith([ROUTE]);
    expect(
      matchGitHubRoute(config, {
        event: 'push',
        deliveryId: 'd1',
        payload: pushPayload({ repository: { full_name: 'ACME/Widgets' } }),
      }),
    ).toMatchObject({ id: 'acme/widgets' });
    // An event the route did not subscribe to must not start a run.
    expect(
      matchGitHubRoute(config, {
        event: 'pull_request',
        deliveryId: 'd1',
        payload: pushPayload(),
      }),
    ).toBeUndefined();
  });

  it('honours a ref filter in both bare and fully-qualified form', () => {
    for (const ref of ['main', 'refs/heads/main']) {
      const config = configWith([{ ...ROUTE, ref }]);
      expect(
        matchGitHubRoute(config, { event: 'push', deliveryId: 'd', payload: pushPayload() }),
      ).toBeDefined();
      expect(
        matchGitHubRoute(config, {
          event: 'push',
          deliveryId: 'd',
          payload: pushPayload({ ref: 'refs/heads/feature' }),
        }),
      ).toBeUndefined();
    }
  });

  it('does not let a ref-less event slip past a configured ref filter', () => {
    const config = configWith([{ ...ROUTE, ref: 'main', events: ['push', 'issues'] }]);
    expect(
      matchGitHubRoute(config, {
        event: 'issues',
        deliveryId: 'd',
        payload: { repository: { full_name: 'acme/widgets' }, action: 'opened' },
      }),
    ).toBeUndefined();
  });

  it('ignores a delivery with no repository', () => {
    expect(
      matchGitHubRoute(configWith([ROUTE]), {
        event: 'push',
        deliveryId: 'd',
        payload: { ref: 'refs/heads/main' },
      }),
    ).toBeUndefined();
  });
});

describe('github push projection', () => {
  it('keeps the identifying fields and reduces file lists to counts', () => {
    const summary = summarizeGitHubPush(pushPayload())!;
    expect(summary).toMatchObject({
      repository: 'acme/widgets',
      ref: 'refs/heads/main',
      branch: 'main',
      after: '2222222222222222222222222222222222222222',
      commitCount: 1,
      pusher: 'octocat',
      sender: 'octocat',
      truncated: false,
    });
    expect(summary.commits[0]).toMatchObject({
      id: 'abcdef123456',
      // First line only; the trailer is dropped.
      message: 'fix: handle empty payload',
      author: 'octocat',
      changed: { added: 1, removed: 0, modified: 2 },
    });
    // Author email is PII the run never needs.
    expect(JSON.stringify(summary)).not.toContain('octocat@example.com');
  });

  it('rejects a push payload missing ref/after/repository', () => {
    expect(summarizeGitHubPush({ ref: 'refs/heads/main', after: 'x' })).toBeUndefined();
    expect(summarizeGitHubPush(pushPayload({ after: undefined }))).toBeUndefined();
    expect(summarizeGitHubPush(pushPayload({ ref: undefined }))).toBeUndefined();
  });

  it('caps commit detail on a large push and flags the truncation', () => {
    const commits = Array.from({ length: 250 }, (_, index) => ({
      id: `${index}`.padStart(40, '0'),
      message: `commit ${index}`,
      author: { name: 'octocat' },
      added: [],
      removed: [],
      modified: [],
    }));
    const summary = summarizeGitHubPush(pushPayload({ commits }))!;
    expect(summary.commitCount).toBe(250);
    expect(summary.commits.length).toBeLessThanOrEqual(20);
    expect(summary.truncated).toBe(true);
  });

  it('bounds every projected string, not just the commit message', () => {
    // Author name, ref and repository are all attacker-influenced. If any one
    // of them were copied unbounded, a crafted push could inflate the summary
    // past the protocol metadata cap and the event would be dropped silently.
    const summary = summarizeGitHubPush(
      pushPayload({
        ref: `refs/heads/${'b'.repeat(5_000)}`,
        repository: { full_name: `acme/${'r'.repeat(5_000)}` },
        pusher: { name: 'p'.repeat(5_000) },
        sender: { login: 's'.repeat(5_000) },
        compare: `https://github.com/${'c'.repeat(5_000)}`,
        commits: Array.from({ length: 20 }, (_, index) => ({
          id: `${index}`.padStart(40, '0'),
          message: 'x'.repeat(4_000),
          author: { name: 'y'.repeat(5_000) },
          timestamp: 't'.repeat(5_000),
          added: [],
          removed: [],
          modified: [],
        })),
      }),
    )!;
    // Commit detail is preserved — truncation, not deletion, is the mechanism.
    expect(summary.commits).toHaveLength(20);
    expect(Buffer.byteLength(JSON.stringify(summary), 'utf8')).toBeLessThan(48 * 1024);
    for (const value of [
      summary.repository,
      summary.ref,
      summary.branch,
      summary.pusher!,
      summary.sender!,
      summary.compare!,
      summary.commits[0]!.message,
      summary.commits[0]!.author!,
      summary.commits[0]!.timestamp!,
    ]) {
      expect(value.length).toBeLessThanOrEqual(513);
    }
  });

  it('strips refs/heads/ but leaves other ref namespaces intact', () => {
    expect(branchFromRef('refs/heads/feature/x')).toBe('feature/x');
    expect(branchFromRef('refs/tags/v1')).toBe('refs/tags/v1');
  });
});

describe('github event envelope', () => {
  it('builds a git-push envelope that passes the daemon protocol boundary', () => {
    const envelope = buildGitHubEventEnvelope({
      delivery: { event: 'push', deliveryId: 'delivery-1', payload: pushPayload() },
      route: ROUTE,
    })!;
    expect(envelope).toMatchObject({
      dedupeKey: 'git:github:delivery-1',
      source: { kind: 'git', name: 'github' },
      target: { kind: 'model', modelId: 'model-1' },
      conversationKey: 'repo:acme/widgets:main',
    });
    // The producer's output must be accepted verbatim by the same validator
    // the daemon pipe applies, otherwise the event is silently dropped.
    const parsed = parseExternalEventFrame({
      id: 'x',
      kind: 'request',
      type: 'external.event.submit',
      payload: envelope,
    });
    expect(parsed.ok).toBe(true);
  });

  it('survives a payload carrying a GPG signature field', () => {
    // `signature` matches SENSITIVE_METADATA_KEY, so forwarding the raw payload
    // would make the daemon reject the whole envelope.
    const payload = pushPayload({
      head_commit: {
        id: 'abc',
        verification: { verified: true, signature: '-----BEGIN PGP SIGNATURE-----' },
      },
    });
    const envelope = buildGitHubEventEnvelope({
      delivery: { event: 'push', deliveryId: 'delivery-2', payload },
      route: ROUTE,
    })!;
    expect(JSON.stringify(envelope)).not.toContain('PGP SIGNATURE');
    expect(
      parseExternalEventFrame({
        id: 'x',
        kind: 'request',
        type: 'external.event.submit',
        payload: envelope,
      }).ok,
    ).toBe(true);
  });

  it('keeps a large push inside the protocol metadata cap', () => {
    const commits = Array.from({ length: 300 }, (_, index) => ({
      id: `${index}`.padStart(40, '0'),
      message: `commit ${index} `.repeat(40),
      author: { name: 'octocat', email: 'octocat@example.com' },
      added: Array.from({ length: 50 }, (_, file) => `src/file-${file}.ts`),
      removed: [],
      modified: [],
    }));
    const envelope = buildGitHubEventEnvelope({
      delivery: { event: 'push', deliveryId: 'delivery-3', payload: pushPayload({ commits }) },
      route: ROUTE,
    })!;
    expect(Buffer.byteLength(JSON.stringify(envelope.metadata), 'utf8')).toBeLessThan(64 * 1024);
    expect(
      parseExternalEventFrame({
        id: 'x',
        kind: 'request',
        type: 'external.event.submit',
        payload: envelope,
      }).ok,
    ).toBe(true);
  });

  it('applies route overrides for instruction, workspace and conversation key', () => {
    const envelope = buildGitHubEventEnvelope({
      delivery: { event: 'push', deliveryId: 'delivery-4', payload: pushPayload() },
      route: {
        ...ROUTE,
        instruction: '只跑测试',
        workspaceId: 'ws-1',
        conversationKey: 'custom-key',
        skillVersionIds: ['skill-1'],
        title: '仓库看护',
      },
    })!;
    expect(envelope).toMatchObject({
      instruction: '只跑测试',
      workspaceId: 'ws-1',
      conversationKey: 'custom-key',
      skillVersionIds: ['skill-1'],
      title: '仓库看护',
    });
  });

  it('routes a non-push subscribed event through the webhook adapter', () => {
    const envelope = buildGitHubEventEnvelope({
      delivery: {
        event: 'pull_request',
        deliveryId: 'delivery-5',
        payload: { repository: { full_name: 'acme/widgets' }, action: 'opened' },
      },
      route: { ...ROUTE, events: ['pull_request'] },
    })!;
    expect(envelope).toMatchObject({
      dedupeKey: 'webhook:github:pull_request:delivery-5',
      source: { kind: 'webhook', name: 'github:pull_request' },
      conversationKey: 'repo:acme/widgets:pull_request',
    });
  });

  it('returns undefined for a push payload it cannot summarize', () => {
    expect(
      buildGitHubEventEnvelope({
        delivery: { event: 'push', deliveryId: 'd', payload: { ref: 'refs/heads/main' } },
        route: ROUTE,
      }),
    ).toBeUndefined();
  });
});
