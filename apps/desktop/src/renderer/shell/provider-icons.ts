import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { PROVIDER_BRAND_LOGOS } from './brand-icons.js';

export type ProviderIconPreference =
  { kind: 'brand'; brandId: string } | { kind: 'image'; dataUrl: string };
const PREFIX = 'sync-think.provider-icon.v1:';
const CHANGE_EVENT = 'sync-think:provider-icon-changed';
export const MAX_PROVIDER_ICON_LENGTH = 128 * 1024;

export function parseProviderIcon(value: string | null): ProviderIconPreference | undefined {
  if (!value || value.length > MAX_PROVIDER_ICON_LENGTH) return;
  try {
    const icon = JSON.parse(value) as Partial<ProviderIconPreference>;
    if (
      icon.kind === 'brand' &&
      typeof icon.brandId === 'string' &&
      Object.hasOwn(PROVIDER_BRAND_LOGOS, icon.brandId)
    )
      return { kind: 'brand', brandId: icon.brandId };
    if (
      icon.kind === 'image' &&
      typeof icon.dataUrl === 'string' &&
      /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(icon.dataUrl)
    )
      return { kind: 'image', dataUrl: icon.dataUrl };
  } catch {
    /* Ignore damaged display preferences, retaining the automatic icon. */
  }
}
function readStoredIcon(providerId?: string): string | null {
  if (!providerId || typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(PREFIX + providerId);
  } catch {
    return null;
  }
}
export function readProviderIcon(providerId: string): ProviderIconPreference | undefined {
  return parseProviderIcon(readStoredIcon(providerId));
}
export function saveProviderIcon(providerId: string, icon?: ProviderIconPreference): void {
  if (!providerId) throw new Error('请先保存供应商');
  if (icon) {
    const encoded = JSON.stringify(icon);
    if (!parseProviderIcon(encoded)) throw new Error('图标格式无效，请重新选择图片');
    localStorage.setItem(PREFIX + providerId, encoded);
  } else localStorage.removeItem(PREFIX + providerId);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: providerId }));
}
export function useProviderIcon(providerId?: string): ProviderIconPreference | undefined {
  const subscribe = useCallback(
    (notify: () => void) => {
      const local = (event: Event) => {
        if ((event as CustomEvent).detail === providerId) notify();
      };
      const stored = (event: StorageEvent) => {
        if (!event.key || event.key === PREFIX + providerId) notify();
      };
      window.addEventListener(CHANGE_EVENT, local);
      window.addEventListener('storage', stored);
      return () => {
        window.removeEventListener(CHANGE_EVENT, local);
        window.removeEventListener('storage', stored);
      };
    },
    [providerId],
  );
  const snapshot = useCallback(() => readStoredIcon(providerId), [providerId]);
  const encoded = useSyncExternalStore(subscribe, snapshot, () => null);
  return useMemo(() => parseProviderIcon(encoded), [encoded]);
}
