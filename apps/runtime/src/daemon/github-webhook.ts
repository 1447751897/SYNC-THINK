/**
 * GitHub webhook → external event mapping (pure functions).
 *
 * This is the thin producer layer TD-046 deferred: it turns an authenticated
 * GitHub delivery into the existing `ExternalEventEnvelope` and hands it to the
 * daemon inbox that already owns dedupe, leases, fencing and Runtime dispatch.
 * Nothing here talks to the network or the database, so every rule below is
 * directly testable.
 *
 * Three invariants this file exists to protect:
 *
 * 1. **Signature over raw bytes.** GitHub signs the exact body it sent. Parsing
 *    to JSON and re-serializing changes key order and whitespace, so the HMAC
 *    must be computed on the untouched Buffer, before any parse.
 * 2. **Delivery id is the dedupe key.** GitHub retries a delivery on non-2xx
 *    with the same `X-GitHub-Delivery`, so a retry collapses onto the same
 *    inbox row (`INSERT OR IGNORE` on dedupe_key) instead of starting a second
 *    run.
 * 3. **Metadata must survive the protocol boundary.** `parseMetadata` rejects
 *    the whole envelope over 64KiB or on any key matching
 *    SENSITIVE_METADATA_KEY — and `signature` matches (GitHub ships a GPG
 *    `head_commit.verification.signature`). A raw push payload with a few
 *    hundred commits blows both limits, and the failure mode is a silently
 *    dropped event. So the payload is projected down to a bounded summary here
 *    rather than forwarded verbatim.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ExternalEventEnvelope, ScheduledTaskTarget } from '@sync-think/shared';
import {
  createGitPushEvent,
  createWebhookEvent,
  type ExternalEventRoute,
} from './external-event-adapters.js';

/** GitHub's own delivery cap is 25 MB; anything larger is not from GitHub. */
export const GITHUB_WEBHOOK_BODY_CAP = 25 * 1024 * 1024;

/** app_setting key holding the webhook configuration. */
export const GITHUB_WEBHOOK_SETTING_KEY = 'github-webhook';

/** Default loopback path; the tunnel/proxy decides the public URL. */
export const GITHUB_WEBHOOK_PATH = '/webhooks/github';

const DEFAULT_PORT = 8765;
const DEFAULT_HOST = '127.0.0.1';
/** Commit detail kept per push; the rest collapses into counts. */
const MAX_COMMITS = 20;
const MAX_COMMIT_MESSAGE = 200;
/**
 * Caps for the remaining projected strings.
 *
 * Every field copied out of the payload needs one. Bounding only the commit
 * message would leave the summary's size at the mercy of fields nobody thinks
 * of as large — an author display name, a compare URL — and the failure mode is
 * a silently rejected envelope, not a truncated one. With all of them bounded
 * the summary is bounded by construction: 20 × ~(200 + 120 + 40) plus a handful
 * of ≤512-byte identifiers, comfortably under METADATA_BUDGET_BYTES.
 */
const MAX_COMMIT_AUTHOR = 120;
const MAX_COMMIT_TIMESTAMP = 40;
const MAX_IDENTIFIER = 512;
/**
 * Metadata budget, below the protocol's 64KiB hard limit. The remaining
 * headroom absorbs the envelope fields the daemon adds around metadata.
 */
const METADATA_BUDGET_BYTES = 48 * 1024;

export interface GitHubWebhookRouteConfig {
  id: string;
  /** `owner/name`, matched case-insensitively. */
  repository: string;
  /** GitHub event names this route accepts. Defaults to `['push']`. */
  events?: string[];
  /** `refs/heads/main` or the bare `main`. Omitted = any ref. */
  ref?: string;
  target: ScheduledTaskTarget;
  workspaceId?: string;
  /** Overrides the derived `repo:<owner/name>:<branch>` conversation key. */
  conversationKey?: string;
  instruction?: string;
  skillVersionIds?: string[];
  title?: string;
}

export interface GitHubWebhookConfig {
  enabled: boolean;
  port: number;
  host: string;
  /** SecureStore handle for the shared webhook secret. Never the secret. */
  secretHandle?: string;
  routes: GitHubWebhookRouteConfig[];
}

export const DISABLED_GITHUB_WEBHOOK_CONFIG: GitHubWebhookConfig = {
  enabled: false,
  port: DEFAULT_PORT,
  host: DEFAULT_HOST,
  routes: [],
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function parseTarget(value: unknown): ScheduledTaskTarget | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const model = nonEmptyString(raw.modelId);
  if (raw.kind === 'model' && model) return { kind: 'model', modelId: model };
  const agent = nonEmptyString(raw.agentId);
  if (raw.kind === 'agent' && agent) return { kind: 'agent', agentId: agent };
  const team = nonEmptyString(raw.teamId);
  if (raw.kind === 'team' && team) return { kind: 'team', teamId: team };
  return undefined;
}

function parseRoute(value: unknown): GitHubWebhookRouteConfig | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const repository = nonEmptyString(raw.repository);
  const target = parseTarget(raw.target);
  // A route without a repository or a target cannot resolve a run; dropping it
  // is safer than defaulting, which would silently send pushes somewhere the
  // user never chose.
  if (!repository || !target) return undefined;
  const events = Array.isArray(raw.events)
    ? raw.events.map((item) => nonEmptyString(item)).filter((item): item is string => Boolean(item))
    : undefined;
  const skills = Array.isArray(raw.skillVersionIds)
    ? raw.skillVersionIds
        .map((item) => nonEmptyString(item))
        .filter((item): item is string => Boolean(item))
    : undefined;
  return {
    id: nonEmptyString(raw.id) ?? repository,
    repository,
    ...(events && events.length > 0 ? { events } : {}),
    ...(nonEmptyString(raw.ref) ? { ref: nonEmptyString(raw.ref)! } : {}),
    target,
    ...(nonEmptyString(raw.workspaceId) ? { workspaceId: nonEmptyString(raw.workspaceId)! } : {}),
    ...(nonEmptyString(raw.conversationKey)
      ? { conversationKey: nonEmptyString(raw.conversationKey)! }
      : {}),
    ...(nonEmptyString(raw.instruction) ? { instruction: nonEmptyString(raw.instruction)! } : {}),
    ...(skills && skills.length > 0 ? { skillVersionIds: skills } : {}),
    ...(nonEmptyString(raw.title) ? { title: nonEmptyString(raw.title)! } : {}),
  };
}

/**
 * Parse the persisted app_setting value.
 *
 * Always returns a usable config: a malformed or absent setting yields the
 * disabled default so a bad edit can never crash the daemon's startup path.
 */
export function parseGitHubWebhookConfig(value: unknown): GitHubWebhookConfig {
  const raw = asRecord(value);
  if (!raw) return DISABLED_GITHUB_WEBHOOK_CONFIG;
  const portValue = Number(raw.port);
  // `>= 1`, not `>= 0`: port 0 asks the OS for an ephemeral port, which would
  // bind successfully, change on every daemon restart, and leave the binding
  // fingerprint stable — a listener GitHub can never reach again, with nothing
  // in the logs to say why. Fall back to the default instead.
  const port =
    Number.isSafeInteger(portValue) && portValue >= 1 && portValue <= 65_535
      ? portValue
      : DEFAULT_PORT;
  const routes = Array.isArray(raw.routes)
    ? raw.routes
        .map((item) => parseRoute(item))
        .filter((item): item is GitHubWebhookRouteConfig => Boolean(item))
    : [];
  return {
    enabled: raw.enabled === true,
    port,
    host: nonEmptyString(raw.host) ?? DEFAULT_HOST,
    ...(nonEmptyString(raw.secretHandle)
      ? { secretHandle: nonEmptyString(raw.secretHandle)! }
      : {}),
    routes,
  };
}

/**
 * Whether the listener should be running.
 *
 * A secret is not optional: an unauthenticated listener would let anyone who
 * can reach the port start a kernel run in the user's workspace. Enabling
 * without one keeps the port closed.
 */
export function shouldServeGitHubWebhook(config: GitHubWebhookConfig): boolean {
  return config.enabled && Boolean(config.secretHandle) && config.routes.length > 0;
}

/** Restart key: the listener is rebuilt only when one of these changes. */
export function githubWebhookBindingFingerprint(config: GitHubWebhookConfig): string {
  return JSON.stringify([
    shouldServeGitHubWebhook(config),
    config.host,
    config.port,
    config.secretHandle ?? '',
  ]);
}

/**
 * Constant-time `X-Hub-Signature-256` check.
 *
 * `rawBody` must be the bytes as received. Comparing hex digests of equal,
 * fixed length keeps `timingSafeEqual` from throwing on length mismatch, which
 * would itself be an observable side channel.
 */
export function verifyGitHubSignature(input: {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  secret: string;
}): boolean {
  const header = input.signatureHeader?.trim();
  if (!header || !input.secret) return false;
  const expected = `sha256=${createHmac('sha256', input.secret).update(input.rawBody).digest('hex')}`;
  const provided = Buffer.from(header, 'utf8');
  const reference = Buffer.from(expected, 'utf8');
  if (provided.length !== reference.length) return false;
  return timingSafeEqual(provided, reference);
}

/** `refs/heads/main` → `main`; other ref namespaces are left intact. */
export function branchFromRef(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

function refMatches(configured: string | undefined, ref: string): boolean {
  if (!configured) return true;
  return configured === ref || configured === branchFromRef(ref);
}

export interface GitHubDelivery {
  /** `X-GitHub-Event` */
  event: string;
  /** `X-GitHub-Delivery` */
  deliveryId: string;
  payload: Record<string, unknown>;
}

/** Repository full name (`owner/name`) as reported by the payload. */
export function deliveryRepository(payload: Record<string, unknown>): string | undefined {
  const repository = asRecord(payload.repository);
  return nonEmptyString(repository?.full_name);
}

/** Ref of a push delivery; other event types have none. */
export function deliveryRef(payload: Record<string, unknown>): string | undefined {
  return nonEmptyString(payload.ref);
}

export function matchGitHubRoute(
  config: GitHubWebhookConfig,
  delivery: GitHubDelivery,
): GitHubWebhookRouteConfig | undefined {
  const repository = deliveryRepository(delivery.payload);
  if (!repository) return undefined;
  const ref = deliveryRef(delivery.payload);
  return config.routes.find((route) => {
    if (route.repository.toLowerCase() !== repository.toLowerCase()) return false;
    const events = route.events ?? ['push'];
    if (!events.includes(delivery.event)) return false;
    // A ref filter only constrains deliveries that carry a ref; a configured
    // filter must never let a ref-less event (e.g. `issues`) through by
    // accident, so those are rejected when a filter is present.
    if (route.ref) return ref ? refMatches(route.ref, ref) : false;
    return true;
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

interface CommitSummary {
  id: string;
  message: string;
  author?: string;
  timestamp?: string;
  /** Counts, not file lists: a rename-heavy commit lists thousands of paths. */
  changed: { added: number; removed: number; modified: number };
}

function summarizeCommit(value: unknown): CommitSummary | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const id = nonEmptyString(raw.id) ?? nonEmptyString(raw.sha);
  if (!id) return undefined;
  const author = asRecord(raw.author);
  const message = nonEmptyString(raw.message) ?? '';
  return {
    id: id.slice(0, 12),
    // First line only: commit bodies routinely carry long trailers.
    message: truncate(message.split('\n')[0] ?? '', MAX_COMMIT_MESSAGE),
    // `name` only — the commit author's email is PII the run never needs.
    ...(nonEmptyString(author?.name)
      ? { author: truncate(nonEmptyString(author!.name)!, MAX_COMMIT_AUTHOR) }
      : {}),
    ...(nonEmptyString(raw.timestamp)
      ? { timestamp: truncate(nonEmptyString(raw.timestamp)!, MAX_COMMIT_TIMESTAMP) }
      : {}),
    changed: {
      added: Array.isArray(raw.added) ? raw.added.length : 0,
      removed: Array.isArray(raw.removed) ? raw.removed.length : 0,
      modified: Array.isArray(raw.modified) ? raw.modified.length : 0,
    },
  };
}

export interface GitHubPushSummary {
  repository: string;
  ref: string;
  branch: string;
  before?: string;
  after: string;
  commitCount: number;
  commits: CommitSummary[];
  pusher?: string;
  sender?: string;
  compare?: string;
  created: boolean;
  deleted: boolean;
  forced: boolean;
  /** True when commit detail was dropped to stay inside the metadata budget. */
  truncated: boolean;
}

/**
 * Project a push payload onto a bounded summary.
 *
 * Verbatim forwarding is not an option: `head_commit.verification.signature`
 * alone would make the daemon reject the envelope, and a large push exceeds the
 * 64KiB metadata cap. Both failures are silent drops, so the projection happens
 * here where it is visible and tested.
 */
export function summarizeGitHubPush(
  payload: Record<string, unknown>,
): GitHubPushSummary | undefined {
  const repository = deliveryRepository(payload);
  const ref = deliveryRef(payload);
  const after = nonEmptyString(payload.after);
  if (!repository || !ref || !after) return undefined;
  const rawCommits = Array.isArray(payload.commits) ? payload.commits : [];
  const commits = rawCommits
    .slice(0, MAX_COMMITS)
    .map((item) => summarizeCommit(item))
    .filter((item): item is CommitSummary => Boolean(item));
  const pusher = asRecord(payload.pusher);
  const sender = asRecord(payload.sender);
  // Every string below is truncated, including the ones that "cannot" be long:
  // the payload is attacker-influenced (a branch name and a repo name are user
  // input), so an unbounded copy is a way to push the envelope past the
  // protocol's metadata cap and have the event silently dropped.
  const summary: GitHubPushSummary = {
    repository: truncate(repository, MAX_IDENTIFIER),
    ref: truncate(ref, MAX_IDENTIFIER),
    branch: truncate(branchFromRef(ref), MAX_IDENTIFIER),
    ...(nonEmptyString(payload.before)
      ? { before: truncate(nonEmptyString(payload.before)!, MAX_IDENTIFIER) }
      : {}),
    after: truncate(after, MAX_IDENTIFIER),
    commitCount: rawCommits.length,
    commits,
    ...(nonEmptyString(pusher?.name)
      ? { pusher: truncate(nonEmptyString(pusher!.name)!, MAX_COMMIT_AUTHOR) }
      : {}),
    ...(nonEmptyString(sender?.login)
      ? { sender: truncate(nonEmptyString(sender!.login)!, MAX_COMMIT_AUTHOR) }
      : {}),
    ...(nonEmptyString(payload.compare)
      ? { compare: truncate(nonEmptyString(payload.compare)!, MAX_IDENTIFIER) }
      : {}),
    created: payload.created === true,
    deleted: payload.deleted === true,
    forced: payload.forced === true,
    truncated: rawCommits.length > commits.length,
  };
  // Backstop only. With every field capped above the summary is bounded by
  // construction and this branch is unreachable; it stays as insurance against
  // a future field being added to the projection without a cap.
  if (Buffer.byteLength(JSON.stringify(summary), 'utf8') > METADATA_BUDGET_BYTES) {
    return { ...summary, commits: [], truncated: true };
  }
  return summary;
}

function routeFor(route: GitHubWebhookRouteConfig, conversationKey: string): ExternalEventRoute {
  return {
    target: route.target,
    ...(route.workspaceId ? { workspaceId: route.workspaceId } : {}),
    ...(route.skillVersionIds ? { skillVersionIds: route.skillVersionIds } : {}),
    conversationKey: route.conversationKey ?? conversationKey,
    ...(route.title ? { title: route.title } : {}),
  };
}

/**
 * Build the envelope for a matched delivery.
 *
 * Push deliveries take the git adapter (so the source reads as `git`, matching
 * how the event is surfaced in the UI); every other subscribed event falls back
 * to the generic webhook adapter.
 */
export function buildGitHubEventEnvelope(input: {
  delivery: GitHubDelivery;
  route: GitHubWebhookRouteConfig;
}): ExternalEventEnvelope | undefined {
  const { delivery, route } = input;
  if (delivery.event === 'push') {
    const summary = summarizeGitHubPush(delivery.payload);
    if (!summary) return undefined;
    const conversationKey = `repo:${summary.repository}:${summary.branch}`;
    return createGitPushEvent({
      ...routeFor(route, conversationKey),
      provider: 'github',
      deliveryId: delivery.deliveryId,
      repository: summary.repository,
      ref: summary.ref,
      ...(summary.before ? { before: summary.before } : {}),
      after: summary.after,
      // The adapter re-sanitizes; passing the projected summary means the
      // sanitizer has nothing left to strip.
      commits: summary.commits,
      ...(route.instruction ? { instruction: route.instruction } : {}),
    });
  }
  const repository = deliveryRepository(delivery.payload);
  if (!repository) return undefined;
  const conversationKey = `repo:${repository}:${delivery.event}`;
  return createWebhookEvent({
    ...routeFor(route, conversationKey),
    integration: `github:${delivery.event}`,
    deliveryId: delivery.deliveryId,
    instruction:
      route.instruction ??
      `处理来自 GitHub 的 ${delivery.event} 事件，概括变更并指出需要处理的事项。`,
    payload: {
      repository,
      event: delivery.event,
      action: nonEmptyString(delivery.payload.action),
    },
  });
}
