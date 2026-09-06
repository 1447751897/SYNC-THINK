import { KeyRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { hasUsableModelProvider } from './kernel-beta-availability.js';

export const FIRST_LAUNCH_GUIDE_KEY = 'sync-think.firstLaunchGuide.v1.dismissed';

export function readFirstLaunchGuideDismissed(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    const source = storage ?? window.localStorage;
    return source.getItem(FIRST_LAUNCH_GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeFirstLaunchGuideDismissed(
  dismissed: boolean,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
  try {
    const target = storage ?? window.localStorage;
    if (dismissed) target.setItem(FIRST_LAUNCH_GUIDE_KEY, '1');
    else target.removeItem(FIRST_LAUNCH_GUIDE_KEY);
  } catch {
    // The guide remains usable when localStorage is unavailable.
  }
}

export function FirstLaunchGuide({
  hasWorkspace,
  hasProvider,
  onOpenModelSettings,
}: {
  hasWorkspace: boolean;
  hasProvider?: boolean;
  onOpenWorkspaceMenu?(): void;
  onOpenModelSettings?(): void;
  onPickTrack?(track: 'model' | 'agent' | 'team'): void;
}) {
  const [dismissed, setDismissed] = useState(() => readFirstLaunchGuideDismissed());
  const [resolvedHasProvider, setResolvedHasProvider] = useState(hasProvider === true);

  useEffect(() => {
    if (typeof hasProvider === 'boolean') {
      setResolvedHasProvider(hasProvider);
      return;
    }
    let active = true;
    const listProviders = window.syncThink?.runtime?.listProviders;
    if (!listProviders) {
      setResolvedHasProvider(false);
      return;
    }
    void listProviders({})
      .then((response) => {
        if (active) setResolvedHasProvider(hasUsableModelProvider(response.providers ?? []));
      })
      .catch(() => {
        if (active) setResolvedHasProvider(false);
      });
    return () => {
      active = false;
    };
  }, [hasProvider]);

  if (dismissed || !hasWorkspace || resolvedHasProvider) return null;

  const dismiss = () => {
    writeFirstLaunchGuideDismissed(true);
    setDismissed(true);
  };

  return (
    <div className="shell-empty-newmax-tips shell-first-launch" role="status">
      <span className="shell-empty-newmax-tips__icon" aria-hidden="true">
        <KeyRound size={16} />
      </span>
      <span className="shell-empty-newmax-tips__text">添加自己的 API 密钥后即可发送</span>
      <button type="button" className="shell-first-launch__action" onClick={() => onOpenModelSettings?.()}>
        添加 API 密钥
      </button>
      <button
        type="button"
        className="shell-first-launch__dismiss"
        aria-label="关闭首次使用引导"
        onClick={dismiss}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
