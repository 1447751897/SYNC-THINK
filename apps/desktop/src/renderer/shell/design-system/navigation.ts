const ROUTE_STATE_KEY = 'syncThink.designLibrary.route';
const ROUTE_PREFIX = '#ds/';

function historyState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state && typeof state === 'object' && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
}

/** Migrate old library links before the desktop shell makes its first IPC request. */
export function restoreDesktopLibraryNavigation(): void {
  if (!window.syncThink?.runtime || !window.location.hash.startsWith(ROUTE_PREFIX)) return;
  const route = window.location.hash;
  const entryUrl = new URL(window.location.href);
  entryUrl.hash = '';
  window.history.replaceState({ ...historyState(), [ROUTE_STATE_KEY]: route }, '', entryUrl.href);
}

/** Also recover old history entries while another shell page is active. */
export function installDesktopLibraryNavigation(): () => void {
  restoreDesktopLibraryNavigation();
  window.addEventListener('popstate', restoreDesktopLibraryNavigation);
  window.addEventListener('hashchange', restoreDesktopLibraryNavigation);
  return () => {
    window.removeEventListener('popstate', restoreDesktopLibraryNavigation);
    window.removeEventListener('hashchange', restoreDesktopLibraryNavigation);
  };
}

export function readLibraryNavigation(): string {
  if (!window.syncThink?.runtime) return window.location.hash;
  restoreDesktopLibraryNavigation();
  const route = historyState()[ROUTE_STATE_KEY];
  return typeof route === 'string' && route.startsWith(ROUTE_PREFIX) ? route : '#ds/overview';
}

/** Desktop IPC trusts the exact entry document, so keep its URL unchanged. */
export function pushLibraryNavigation(route: string): void {
  if (readLibraryNavigation() === route) return;
  if (window.syncThink?.runtime) {
    window.history.pushState({ ...historyState(), [ROUTE_STATE_KEY]: route }, '');
  } else {
    window.history.pushState(null, '', route);
  }
}
