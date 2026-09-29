/**
 * Loopback redirect URIs.
 *
 * Several providers — GitHub, Slack, Notion, Figma and Gitee — refuse a
 * redirect_uri that is not byte-identical to one registered in their console.
 * A system-assigned port therefore cannot work for them: the user would have to
 * re-register the app on every authorization.
 *
 * So each provider gets a stable port derived from its id. The same provider
 * always produces the same redirect URI, which the settings dialog shows and
 * the user pastes into the provider console exactly once.
 */

/** Providers with a pinned redirect live in this window; the upper bound is IANA dynamic. */
const PORT_BASE = 51200;
const PORT_SPAN = 400;

/** FNV-1a. Only needs to spread provider ids across the window, not to be cryptographic. */
function hashProviderId(providerId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < providerId.length; i += 1) {
    hash ^= providerId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The port the loopback server tries to bind for this provider.
 *
 * Deterministic but not unique: two provider ids may collide, in which case the
 * second flow fails to bind and the user is told the port is taken. That is
 * preferable to silently redirecting to a URI the provider will reject.
 */
export function stablePortFor(providerId: string): number {
  return PORT_BASE + (hashProviderId(providerId.trim().toLowerCase()) % PORT_SPAN);
}

export function buildRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}/oauth/callback`;
}

export function defaultRedirectUriFor(providerId: string): string {
  return buildRedirectUri(stablePortFor(providerId));
}

/**
 * Recover the port from a redirect URI the user supplied.
 *
 * Returns undefined for anything that is not a loopback http URI, so a typo in
 * the settings dialog degrades to the derived default instead of crashing the
 * flow at listen time.
 */
export function parseRedirectPort(redirectUri: string | undefined): number | undefined {
  const raw = redirectUri?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:') return undefined;
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return undefined;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
  return port;
}

/**
 * The redirect URI to display and to send on the authorize request.
 *
 * An explicit user value wins, because it is the one already registered with the
 * provider; otherwise the derived default is used, which is what the user is
 * told to register.
 */
export function resolveRedirectUri(providerId: string, explicit?: string): string {
  const port = parseRedirectPort(explicit);
  return buildRedirectUri(port ?? stablePortFor(providerId));
}
