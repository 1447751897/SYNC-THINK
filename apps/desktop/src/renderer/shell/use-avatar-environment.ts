import { useSyncExternalStore } from 'react';

// One observer/listener for the entire roster, rather than one per avatar.
const subscribers = new Set<() => void>();
let observer: MutationObserver | undefined;
let motionQuery: MediaQueryList | undefined;
const notify = () => {
  for (const subscriber of subscribers) subscriber();
};

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  if (subscribers.size === 1 && typeof document !== 'undefined') {
    observer = new MutationObserver(notify);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-reduced-motion'],
    });
    motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    motionQuery?.addEventListener?.('change', notify);
  }
  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      observer?.disconnect();
      observer = undefined;
      motionQuery?.removeEventListener?.('change', notify);
      motionQuery = undefined;
    }
  };
}

function snapshot(): string {
  if (typeof document === 'undefined') return 'light:still';
  const root = document.documentElement;
  const dark = root.classList.contains('dark') || root.dataset.theme === 'dark';
  const reduced =
    root.hasAttribute('data-reduced-motion') ||
    (motionQuery ?? window.matchMedia?.('(prefers-reduced-motion: reduce)'))?.matches;
  return `${dark ? 'dark' : 'light'}:${reduced ? 'still' : 'motion'}`;
}

export function useAvatarEnvironment(): { theme: 'dark' | 'light'; reducedMotion: boolean } {
  const value = useSyncExternalStore(subscribe, snapshot, () => 'light:still');
  return {
    theme: value.startsWith('dark:') ? 'dark' : 'light',
    reducedMotion: value.endsWith(':still'),
  };
}
