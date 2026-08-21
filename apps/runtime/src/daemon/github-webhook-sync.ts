/**
 * Reconciles the GitHub webhook listener with the persisted configuration.
 *
 * The daemon re-reads `app_setting` every 15s and calls `sync()`. This module
 * owns the decision of what that should do: leave the listener alone, refresh
 * its routes in place, or tear it down and rebuild it. It lives outside
 * `main.ts` so the reconciliation can be driven directly by tests — the two
 * bugs it exists to prevent (a wedged in-flight guard and a snapshotted config)
 * are both invisible to any test that only exercises the HTTP handler.
 *
 * Two rules shape everything here:
 *
 *   1. **Only a binding change restarts the listener.** Closing a socket drops
 *      in-flight deliveries, and GitHub reports those as failures. Route edits,
 *      which are the common case, are applied to the live listener instead.
 *   2. **A webhook problem must never take the daemon down.** The daemon also
 *      runs the scheduler and supervises the Runtime. Every failure path here
 *      logs, leaves the fingerprint unapplied so the next rescan retries, and
 *      returns.
 */
import {
  githubWebhookBindingFingerprint,
  shouldServeGitHubWebhook,
  GITHUB_WEBHOOK_PATH,
  type GitHubWebhookConfig,
} from './github-webhook.js';
import type {
  GitHubWebhookServer,
  GitHubWebhookServerOptions,
  GitHubWebhookSubmitResult,
} from './github-webhook-server.js';
import type { ExternalEventEnvelope } from '@sync-think/shared';

/**
 * How long a failed vault read suppresses further reads.
 *
 * Short enough that a transient failure (locked profile, a race with a
 * rotation) self-heals well inside GitHub's redelivery window; long enough that
 * a degraded vault cannot be turned into an amplifier.
 */
export const GITHUB_SECRET_FAILURE_TTL_MS = 5_000;

export interface GitHubWebhookSyncDeps {
  /** Read the current persisted config. Called once per `sync()`. */
  readConfig: () => GitHubWebhookConfig;
  /** Bind a listener. Injected so tests do not open sockets. */
  startServer: (options: GitHubWebhookServerOptions) => Promise<GitHubWebhookServer>;
  /** Hand a verified envelope to the durable inbox. */
  submit: (event: ExternalEventEnvelope) => GitHubWebhookSubmitResult;
  /** Lazily built: on a non-Windows dev box the DPAPI vault is unavailable. */
  secureStore: () => { retrieveSecret(handle: string): Promise<string> };
  log?: (message: string) => void;
  warn?: (message: string, error?: unknown) => void;
  /** Monotonic clock, for the failure TTL. Injectable so tests need no timers. */
  now?: () => number;
}

export interface GitHubWebhookSync {
  /** Reconcile against the current config. Never throws, never blocks. */
  sync(): void;
  /** Await the in-flight reconciliation, if any. Used by tests and shutdown. */
  settled(): Promise<void>;
  /** Stop the listener. Waits for an in-flight reconciliation first. */
  close(): Promise<void>;
  /** The running listener, or undefined. Diagnostics and tests. */
  readonly server: GitHubWebhookServer | undefined;
  /** Resolve the shared secret, with caching. Exposed for tests. */
  resolveSecret(): Promise<string | undefined>;
}

export function createGitHubWebhookSync(deps: GitHubWebhookSyncDeps): GitHubWebhookSync {
  const now = deps.now ?? (() => performance.now());
  const log = deps.log ?? (() => undefined);
  const warn = deps.warn ?? (() => undefined);

  /**
   * The config the running listener serves.
   *
   * Deliberately mutable and read through a getter by the listener: this is
   * what makes an in-place route refresh possible without a restart.
   */
  let current: GitHubWebhookConfig = deps.readConfig();
  let server: GitHubWebhookServer | undefined;
  let fingerprint: string | undefined;
  let syncing: Promise<void> | undefined;
  let secureStore: { retrieveSecret(handle: string): Promise<string> } | undefined;
  /**
   * Decrypted secret, cached per handle.
   *
   * The signature check needs the key, so the vault read happens *before* a
   * request is authenticated — without a cache every unsigned request from
   * anyone who can reach the port would force a decrypt. The handle is the
   * cache key, so rotating the secret (which mints a new handle) invalidates
   * it; a handle change also alters the binding fingerprint and rebuilds the
   * listener anyway.
   */
  let secretCache: { handle: string; secret: string | undefined } | undefined;
  /**
   * In-flight vault read, so concurrent deliveries share one decrypt.
   *
   * `promise` is optional because the ticket is published *before* the async
   * body starts — see the assignment order below.
   */
  let secretInFlight: { handle: string; promise?: Promise<string | undefined> } | undefined;
  /** Monotonic timestamp of the last failed vault read; drives the negative cache. */
  let secretFailedAt: number | undefined;
  /** Consecutive failed binds; drives log throttling for a permanently taken port. */
  let startFailures = 0;

  const resolveSecret = async (): Promise<string | undefined> => {
    const handle = current.secretHandle;
    if (!handle) return undefined;
    if (secretCache?.handle === handle) return secretCache.secret;
    // Negative cache. `WindowsDpapiBackend.retrieve` spawns a PowerShell
    // process per call with a 10s timeout, and this runs pre-authentication:
    // without this, a degraded vault plus a stream of unsigned requests is one
    // spawned process each. Failures are not keyed by handle — retrying after
    // the TTL is what lets a transient failure recover.
    if (secretFailedAt !== undefined && now() - secretFailedAt < GITHUB_SECRET_FAILURE_TTL_MS) {
      return undefined;
    }
    // Single-flight: concurrent deliveries collapse onto one decrypt.
    if (secretInFlight?.handle === handle) return secretInFlight.promise;
    // The ticket is published before the body starts, so a caller that arrives
    // while the decrypt is running joins it instead of starting a second one.
    // The `finally` compares ticket identity, which is why it cannot clear a
    // newer read's ticket.
    const ticket: { handle: string; promise?: Promise<string | undefined> } = { handle };
    secretInFlight = ticket;
    ticket.promise = (async (): Promise<string | undefined> => {
      try {
        secureStore ??= deps.secureStore();
        const secret = (await secureStore.retrieveSecret(handle)) || undefined;
        secretCache = { handle, secret };
        secretFailedAt = undefined;
        return secret;
      } catch (error) {
        secretFailedAt = now();
        // Drop the half-built store too: on a platform without a vault the
        // constructor itself is what threw, and keeping it would pin the
        // failure past the TTL.
        secureStore = undefined;
        warn('[daemon] failed to read the GitHub webhook secret', error);
        return undefined;
      } finally {
        if (secretInFlight === ticket) secretInFlight = undefined;
      }
    })();
    return ticket.promise;
  };

  const sync = (): void => {
    if (syncing) return;
    const config = deps.readConfig();
    const next = githubWebhookBindingFingerprint(config);
    if (next === fingerprint) {
      // Same binding: routes may still have changed, so refresh them in place
      // rather than dropping deliveries during a restart. Unconditional — the
      // listener reads this through a getter, and gating on `server` would
      // silently discard route edits made while a start is being retried.
      current = config;
      return;
    }
    const task = (async () => {
      try {
        if (server) {
          await server.close();
          server = undefined;
          log('[daemon] github webhook listener stopped');
        }
        current = config;
        fingerprint = next;
        if (!shouldServeGitHubWebhook(config)) return;
        server = await deps.startServer({
          // Both read through the mutable `current`, not a snapshot: a route
          // edit or a rotated secret handle must apply on the next rescan
          // without restarting the listener.
          config: () => current,
          resolveSecret,
          submit: deps.submit,
          onLog: log,
          onError: () => {
            // Drop the applied fingerprint so the next rescan rebuilds; the
            // server handle stays so the rebuild closes it first.
            fingerprint = undefined;
          },
        });
        startFailures = 0;
        log(
          `[daemon] github webhook listening on http://${server.host}:${server.port}${GITHUB_WEBHOOK_PATH}`,
        );
      } catch (error) {
        // A taken port must not take the scheduler down with it; the next
        // rescan retries because the fingerprint stays unapplied.
        fingerprint = undefined;
        startFailures += 1;
        // Retries are every 15s forever, so log the first few attempts and
        // then only once a minute. `daemon.log` has no rotation, and an
        // occupied port would otherwise append ~5.7k lines a day indefinitely.
        if (startFailures <= 3 || startFailures % 4 === 0) {
          warn(
            `[daemon] github webhook listener failed to start (attempt ${startFailures})`,
            error,
          );
        }
      }
    })();
    // Assign before the clearing callback can run. An async function body runs
    // synchronously up to its first `await`, and the "not serving" path has
    // none — a `finally` *inside* the body would clear `syncing` before this
    // assignment, parking an already-resolved promise there and making the
    // guard above no-op every future rescan. That is the default install path
    // (the daemon boots unconfigured), so the webhook could never be enabled
    // without a daemon restart. The identity check stops a stale task from
    // clearing a newer one's handle.
    syncing = task;
    void task.finally(() => {
      if (syncing === task) syncing = undefined;
    });
  };

  const settled = async (): Promise<void> => {
    if (syncing) await syncing.catch(() => undefined);
  };

  return {
    sync,
    settled,
    resolveSecret,
    get server() {
      return server;
    },
    close: async () => {
      await settled();
      if (!server) return;
      await server.close().catch((error) => {
        warn('[daemon] github webhook listener close failed', error);
      });
      server = undefined;
      fingerprint = undefined;
    },
  };
}
