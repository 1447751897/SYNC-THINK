/** One watcher per repository shared by composers and review panels. */
const observers = new Map<
  string,
  {
    root: string;
    listeners: Set<() => void>;
    stop?: () => void;
    ready: Promise<unknown>;
    release?: ReturnType<typeof setTimeout>;
  }
>();
export function repositoryKey(root: string): string {
  const path = root.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(path) ? path.toLowerCase() : path;
}
export function invalidateGitRepository(root: string): void {
  observers.get(repositoryKey(root))?.listeners.forEach((listener) => listener());
}
export function subscribeGitRepository(root: string, listener: () => void): () => void {
  const key = repositoryKey(root),
    api = window.syncThink?.runtime;
  if (!key) return () => {};
  let entry = observers.get(key);
  if (!entry) {
    entry = { root, listeners: new Set(), ready: Promise.resolve() };
    observers.set(key, entry);
    const current = entry;
    current.stop = api?.onGitWatched?.((event) => {
      if (repositoryKey(event.root) === key) current.listeners.forEach((fn) => fn());
    });
    current.ready = Promise.resolve(api?.gitWatch?.({ root })).catch(() => undefined);
  }
  const current = entry;
  clearTimeout(current.release);
  current.listeners.add(listener);
  window.addEventListener('focus', listener);
  return () => {
    window.removeEventListener('focus', listener);
    current.listeners.delete(listener);
    if (current.listeners.size) return;
    current.release = setTimeout(() => {
      void current.ready.then(() => {
        if (current.listeners.size || observers.get(key) !== current) return;
        current.stop?.();
        observers.delete(key);
        void api?.gitUnwatch?.({ root: current.root }).catch(() => undefined);
      });
    }, 0);
  };
}
