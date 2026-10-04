import { DEFAULT_EMBEDDED_BROWSER_PARTITION, LEGACY_EMBEDDED_BROWSER_PARTITION } from '../../browser-session-info.js';

const KEY = 'sync-think:embedded-browser-default-profile:v1';
export const EMBEDDED_BROWSER_PROFILES = [
  { partition: DEFAULT_EMBEDDED_BROWSER_PARTITION, name: '默认浏览器资料' },
  { partition: LEGACY_EMBEDDED_BROWSER_PARTITION, name: '默认浏览器资料' },
] as const;

export function readDefaultEmbeddedBrowserProfile(): string {
  try {
    const partition = window.localStorage.getItem(KEY);
    if (EMBEDDED_BROWSER_PROFILES.some(profile => profile.partition === partition)) return partition!;
  } catch {
    // All tabs fall back to the same persisted built-in browser profile.
  }
  return DEFAULT_EMBEDDED_BROWSER_PARTITION;
}

export function writeDefaultEmbeddedBrowserProfile(partition: string): boolean {
  if (!EMBEDDED_BROWSER_PROFILES.some(profile => profile.partition === partition)) return false;
  try {
    window.localStorage.setItem(KEY, partition);
    return true;
  } catch {
    return false;
  }
}

export function embeddedBrowserProfileName(partition: string): string {
  return EMBEDDED_BROWSER_PROFILES.find(profile => profile.partition === partition)?.name
    ?? (partition.startsWith('persist:') ? '独立资料' : '临时资料');
}
