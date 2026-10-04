/** Public scheme for newly created local HTML pages. */
export const LOCAL_WEB_PAGE_SCHEME = 'sync-think-local-web';

/** Read-only compatibility alias for URLs saved by older desktop versions. */
export const LEGACY_LOCAL_WEB_PAGE_SCHEME = 'newmax-local-web';
export const LOCAL_WEB_PAGE_SCHEMES = [
  LOCAL_WEB_PAGE_SCHEME,
  LEGACY_LOCAL_WEB_PAGE_SCHEME,
] as const;

const localPageUrlPattern = new RegExp(`^(?:${LOCAL_WEB_PAGE_SCHEMES.join('|')})://[^/]+/`, 'i');

export function isLocalWebPageUrl(value: string): boolean {
  return localPageUrlPattern.test(value);
}

/** Preserve the token, encoded path, query and fragment while updating the brand. */
export function canonicalizeLocalWebPageUrl(value: string): string {
  return isLocalWebPageUrl(value) ? value.replace(/^[^:]+:/, `${LOCAL_WEB_PAGE_SCHEME}:`) : value;
}
