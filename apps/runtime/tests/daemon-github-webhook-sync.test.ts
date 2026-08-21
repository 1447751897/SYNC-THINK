/**
 * Reconciliation between the persisted webhook config and the live listener.
 *
 * These are the tests the HTTP-handler suite structurally cannot write. The two
 * worst bugs in this area — a permanently wedged in-flight guard, and a
 * listener that keeps routing against the config it was born with — both
 * produce a daemon that starts fine, logs nothing, and silently never runs a
 * webhook task. Neither is observable from the request path.
 */
import { describe, expect, it, vi } from 'vitest';
import { createGitHubWebhookSync } from '../src/daemon/github-webhook-sync.js';
import type {
  GitHubWebhookServer,
  GitHubWebhookServerOptions,
} from '../src/daemon/github-webhook-server.js';
import {
  DISABLED_GITHUB_WEBHOOK_CONFIG,
  type GitHubWebhookConfig,
} from '../src/daemon/github-webhook.js';

const ROUTE = {
  id: 'acme/widgets',
  repository: 'acme/widgets',
  target: { kind: 'model', modelId: 'model-1' },
} as const;

function enabled(overrides: Partial<GitHubWebhookConfig> = {}): GitHubWebhookConfig {
  return {
    enabled: true,
    host: '127.0.0.1',
    port: 8765,
    secretHandle: 'handle-1',
    routes: [ROUTE],
    ...overrides,
  };
}

/** Records every bind so the tests can assert on restart-vs-refresh. */
function harness(initial: GitHubWebhookConfig = DISABLED_GITHUB_WEBHOOK_CONFIG) {
  let config = initial;
  const starts: GitHubWebhookServerOptions[] = [];
  const closed: number[] = [];
  const logs: string[] = [];
  const warns: Array<{ message: string; error?: unknown }> = [];
  let failNextStart: Error | undefined;
  let retrieve: (handle: string) => Promise<string> = async () => 'shared-secret';
  let clock = 0;

  const sync = createGitHubWebhookSync({
    readConfig: () => config,
    startServer: async (options) => {
      if (failNextStart) {
        const error = failNextStart;
        failNextStart = undefined;
        throw error;
      }
      const index = starts.length;
      starts.push(options);
      const server: GitHubWebhookServer = {
        host: options.config().host,
        port: options.config().port,
        close: async () => {
          closed.push(index);
        },
      };
      return server;
    },
    submit: () => ({ eventId: 'evt-1', created: true }),
    secureStore: () => ({ retrieveSecret: (handle) => retrieve(handle) }),
    log: (message) => logs.push(message),
    warn: (message, error) => warns.push({ message, error }),
    now: () => clock,
  });

  return {
    sync,
    starts,
    closed,
    logs,
    warns,
    setConfig: (next: GitHubWebhookConfig) => {
      config = next;
    },
    failStart: (error: Error) => {
      failNextStart = error;
    },
    setRetrieve: (fn: (handle: string) => Promise<string>) => {
      retrieve = fn;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('github webhook reconciliation', () => {
  it('recovers from the unconfigured boot state when the webhook is later enabled', async () => {
    // The regression that motivates this file. A fresh install boots with the
    // webhook disabled, so the first reconciliation takes a path with no
    // `await` in it. If the in-flight guard is cleared from inside the async
    // body it runs *before* the handle is assigned, parking a resolved promise
    // there and making every future `sync()` an immediate no-op — the user runs
    // `webhook:github setup`, sees it succeed, and nothing ever listens until
    // the daemon is restarted.
    const h = harness();

    h.sync.sync();
    await h.sync.settled();
    expect(h.starts).toHaveLength(0);

    h.setConfig(enabled());
    h.sync.sync();
    await h.sync.settled();

    expect(h.starts).toHaveLength(1);
    expect(h.logs.join('\n')).toContain('github webhook listening on http://127.0.0.1:8765');
  });

  it('is idempotent while the binding is unchanged', async () => {
    const h = harness(enabled());
    for (let i = 0; i < 5; i += 1) {
      h.sync.sync();
      await h.sync.settled();
    }
    expect(h.starts).toHaveLength(1);
    expect(h.closed).toHaveLength(0);
  });

  it('applies a route edit in place, without dropping the listener', async () => {
    // Closing the socket would abort in-flight deliveries, which GitHub records
    // as failures. Only host/port/enablement/secret-handle justify a rebuild.
    const h = harness(enabled());
    h.sync.sync();
    await h.sync.settled();

    const second = { ...ROUTE, id: 'acme/other', repository: 'acme/other' };
    h.setConfig(enabled({ routes: [ROUTE, second] }));
    h.sync.sync();
    await h.sync.settled();

    expect(h.starts).toHaveLength(1);
    expect(h.closed).toHaveLength(0);
    // The live listener must see the edit through its getter.
    expect(h.starts[0]!.config().routes).toHaveLength(2);
  });

  it('rebuilds the listener when the port changes', async () => {
    const h = harness(enabled());
    h.sync.sync();
    await h.sync.settled();

    h.setConfig(enabled({ port: 9000 }));
    h.sync.sync();
    await h.sync.settled();

    expect(h.starts).toHaveLength(2);
    expect(h.closed).toEqual([0]);
    expect(h.sync.server?.port).toBe(9000);
  });

  it('stops the listener when the webhook is disabled', async () => {
    const h = harness(enabled());
    h.sync.sync();
    await h.sync.settled();

    h.setConfig(enabled({ enabled: false }));
    h.sync.sync();
    await h.sync.settled();

    expect(h.closed).toEqual([0]);
    expect(h.sync.server).toBeUndefined();
    // …and can come back without a daemon restart.
    h.setConfig(enabled());
    h.sync.sync();
    await h.sync.settled();
    expect(h.starts).toHaveLength(2);
  });

  it('keeps retrying after a failed bind instead of wedging the daemon', async () => {
    // A port held by another process must not take the scheduler down, and must
    // not leave the webhook permanently unapplied either.
    const h = harness(enabled());
    h.failStart(new Error('EADDRINUSE'));
    h.sync.sync();
    await h.sync.settled();
    expect(h.sync.server).toBeUndefined();
    expect(h.warns).toHaveLength(1);

    h.sync.sync();
    await h.sync.settled();
    expect(h.starts).toHaveLength(1);
    expect(h.sync.server).toBeDefined();
  });

  it('throttles the failure log so an occupied port cannot fill daemon.log', async () => {
    // Rescan is every 15s forever: unthrottled this is ~5.7k lines a day into a
    // file with no rotation.
    const h = harness(enabled());
    for (let i = 0; i < 12; i += 1) {
      h.failStart(new Error('EADDRINUSE'));
      h.sync.sync();
      await h.sync.settled();
    }
    expect(h.starts).toHaveLength(0);
    // First three, then every fourth: 1,2,3,4,8,12.
    expect(h.warns).toHaveLength(6);
  });

  it('applies a route edit made while a bind is failing', async () => {
    // The refresh must not be gated on a live server: otherwise edits made
    // during a retry loop are silently discarded.
    const h = harness(enabled());
    h.failStart(new Error('EADDRINUSE'));
    h.sync.sync();
    await h.sync.settled();

    const second = { ...ROUTE, id: 'acme/other', repository: 'acme/other' };
    h.setConfig(enabled({ routes: [ROUTE, second] }));
    h.sync.sync();
    await h.sync.settled();

    expect(h.starts).toHaveLength(1);
    expect(h.starts[0]!.config().routes).toHaveLength(2);
  });

  it('rebuilds after a post-bind listener error', async () => {
    // An accept-path EMFILE on a long-lived process leaves a listener that is
    // up but no longer serving; the next rescan must replace it.
    const h = harness(enabled());
    h.sync.sync();
    await h.sync.settled();

    h.starts[0]!.onError?.(new Error('EMFILE'));
    h.sync.sync();
    await h.sync.settled();

    expect(h.starts).toHaveLength(2);
    expect(h.closed).toEqual([0]);
  });

  it('closes the listener on shutdown and waits for an in-flight sync', async () => {
    const h = harness(enabled());
    h.sync.sync();
    await h.sync.close();
    expect(h.closed).toEqual([0]);
    expect(h.sync.server).toBeUndefined();
  });
});

describe('github webhook secret resolution', () => {
  it('caches the decrypted secret so unsigned traffic cannot drive vault reads', async () => {
    // The signature check needs the key, so this runs *before* a request is
    // authenticated, and on Windows each read spawns a PowerShell process.
    const h = harness(enabled());
    const retrieve = vi.fn(async () => 'shared-secret');
    h.setRetrieve(retrieve);
    h.sync.sync();
    await h.sync.settled();

    for (let i = 0; i < 20; i += 1) expect(await h.sync.resolveSecret()).toBe('shared-secret');
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent deliveries onto a single decrypt', async () => {
    let release: (value: string) => void = () => undefined;
    const retrieve = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const h = harness(enabled());
    h.setRetrieve(retrieve);
    h.sync.sync();
    await h.sync.settled();

    const pending = Array.from({ length: 8 }, () => h.sync.resolveSecret());
    release('shared-secret');
    expect(await Promise.all(pending)).toEqual(Array(8).fill('shared-secret'));
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it('negative-caches a vault failure but recovers after the TTL', async () => {
    // Without the negative cache a degraded vault plus a stream of unsigned
    // requests is one spawned process each — the endpoint becomes an amplifier
    // exactly when the machine is already unhealthy.
    let fail = true;
    const retrieve = vi.fn(async () => {
      if (fail) throw new Error('DPAPI unavailable');
      return 'shared-secret';
    });
    const h = harness(enabled());
    h.setRetrieve(retrieve);
    h.sync.sync();
    await h.sync.settled();

    expect(await h.sync.resolveSecret()).toBeUndefined();
    for (let i = 0; i < 10; i += 1) expect(await h.sync.resolveSecret()).toBeUndefined();
    expect(retrieve).toHaveBeenCalledTimes(1);

    h.advance(5_000);
    fail = false;
    expect(await h.sync.resolveSecret()).toBe('shared-secret');
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it('resolves to undefined without touching the vault when no handle is configured', async () => {
    const retrieve = vi.fn(async () => 'shared-secret');
    const h = harness(enabled({ secretHandle: undefined, enabled: false }));
    h.setRetrieve(retrieve);
    h.sync.sync();
    await h.sync.settled();
    expect(await h.sync.resolveSecret()).toBeUndefined();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('follows a rotated secret handle', async () => {
    // A rotation mints a new handle, which also changes the binding
    // fingerprint — but the cache must key on the handle regardless.
    const secrets: Record<string, string> = { 'handle-1': 'old', 'handle-2': 'new' };
    const h = harness(enabled());
    h.setRetrieve(async (handle) => secrets[handle] ?? '');
    h.sync.sync();
    await h.sync.settled();
    expect(await h.sync.resolveSecret()).toBe('old');

    h.setConfig(enabled({ secretHandle: 'handle-2' }));
    h.sync.sync();
    await h.sync.settled();
    expect(await h.sync.resolveSecret()).toBe('new');
  });

  it('treats an empty stored secret as unavailable', async () => {
    // The handler turns `undefined` into a 500 rather than serving
    // unauthenticated traffic; an empty string must take that same path.
    const h = harness(enabled());
    h.setRetrieve(async () => '');
    h.sync.sync();
    await h.sync.settled();
    expect(await h.sync.resolveSecret()).toBeUndefined();
  });
});
