/**
 * Host-side guest bridge, ported from NewMax's `InlineVisualization` component
 * (`html-vis.js`): attach `dom-ready` / `ipc-message` / `did-fail-load`
 * listeners, push the design system on dom-ready and whenever the shell theme
 * changes, and take the stage height from the guest's `:height` report.
 *
 * The host never calls `executeJavaScript` on the guest — that is the whole
 * point of the port. Measurement failures inside the guest can no longer take
 * the shell down, and there is no bounded-timer polling loop.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { VISUALIZATION_CHANNELS, buildVisualizationDesignSystem } from './design-system.js';
import { createVisualizationPartition } from './partition.js';

export type VisualizationGuestStatus = 'loading' | 'ready' | 'error';

/** Electron's <webview> element, narrowed to what the bridge uses. */
export interface VisualizationWebviewElement extends HTMLElement {
  send?: (channel: string, ...args: unknown[]) => void;
  reload?: () => void;
}

export interface VisualizationHeightReport {
  height?: unknown;
}

export interface VisualizationErrorReport {
  message?: unknown;
}

export interface UseVisualizationGuestOptions {
  /** Guest document URL; null while the source is still being read. */
  src: string | null;
  /** False while the preview is collapsed or showing source, which detaches it. */
  active: boolean;
  /** Stage height before the guest reports one. */
  initialHeight: number;
  minHeight: number;
  maxHeight: number;
  /**
   * Maps a guest-reported height to the stage height. Defaults to a plain
   * clamp; design drafts additionally keep a host pane floor.
   */
  resolveReportedHeight?: (reported: number) => number;
}

export interface VisualizationGuest {
  webviewRef: MutableRefObject<VisualizationWebviewElement | null>;
  partition: string;
  status: VisualizationGuestStatus;
  height: number;
  errorDetail: string | null;
  /** Host-driven height (design drafts fill the host pane). */
  setHeight: Dispatch<SetStateAction<number>>;
  /** Remount the guest (retry / refresh). */
  reload: () => void;
}

export function useVisualizationGuest({
  src,
  active,
  initialHeight,
  minHeight,
  maxHeight,
  resolveReportedHeight,
}: UseVisualizationGuestOptions): VisualizationGuest {
  const webviewRef = useRef<VisualizationWebviewElement | null>(null);
  const partition = useMemo(() => createVisualizationPartition(), []);
  const readyRef = useRef(false);
  const resolveRef = useRef(resolveReportedHeight);
  resolveRef.current = resolveReportedHeight;

  const [status, setStatus] = useState<VisualizationGuestStatus>('loading');
  const [height, setHeight] = useState(initialHeight);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const clamp = useCallback(
    (reported: number) => Math.max(minHeight, Math.min(Math.ceil(reported), maxHeight)),
    [maxHeight, minHeight],
  );

  const sendDesignSystem = useCallback(() => {
    const webview = webviewRef.current;
    if (!readyRef.current || !webview?.isConnected) return;
    // Read the tokens at send time so a theme switch is reflected immediately.
    webview.send?.(VISUALIZATION_CHANNELS.setDesignSystem, buildVisualizationDesignSystem());
  }, []);

  // Attach the guest and wire its events. Mirrors html-vis.js: the src is set
  // imperatively after the listeners exist, so no report can be missed.
  useEffect(() => {
    readyRef.current = false;
    setStatus('loading');
    setHeight(initialHeight);
    setErrorDetail(null);
    const webview = webviewRef.current;
    if (!webview || !active || !src) return;

    const handleDomReady = () => {
      readyRef.current = true;
      sendDesignSystem();
    };
    const handleIpcMessage = (rawEvent: Event) => {
      const event = rawEvent as Event & { channel?: string; args?: unknown[] };
      if (event.channel === VISUALIZATION_CHANNELS.ready) {
        readyRef.current = true;
        setStatus('ready');
        sendDesignSystem();
        return;
      }
      if (event.channel === VISUALIZATION_CHANNELS.height) {
        const payload = event.args?.[0] as VisualizationHeightReport | undefined;
        const reported = payload?.height;
        if (typeof reported !== 'number' || !Number.isFinite(reported)) return;
        const resolve = resolveRef.current;
        setHeight(resolve ? resolve(reported) : clamp(reported));
        return;
      }
      if (event.channel === VISUALIZATION_CHANNELS.error) {
        readyRef.current = false;
        const payload = event.args?.[0] as VisualizationErrorReport | undefined;
        setErrorDetail(typeof payload?.message === 'string' ? payload.message : null);
        setStatus('error');
      }
    };
    const handleLoadFailure = () => {
      readyRef.current = false;
      setErrorDetail(null);
      setStatus('error');
    };

    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('ipc-message', handleIpcMessage);
    webview.addEventListener('did-fail-load', handleLoadFailure);
    // Navigate only after listeners are attached so cached loads cannot lose
    // the ready/error messages. Reusing an unchanged source avoids duplicate
    // guest navigations during ordinary rerenders.
    if (webview.getAttribute('src') !== src) {
      webview.setAttribute('src', src);
    } else if (reloadKey > 0) {
      webview.reload?.();
    }
    return () => {
      readyRef.current = false;
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('ipc-message', handleIpcMessage);
      webview.removeEventListener('did-fail-load', handleLoadFailure);
    };
  }, [active, clamp, initialHeight, reloadKey, sendDesignSystem, src]);

  // The shell theme can change without the guest navigating: class/data-theme
  // swaps on <html> and token re-definitions both land in the style attribute.
  useEffect(() => {
    if (!active || !src) return;
    const target = typeof document === 'undefined' ? null : document.documentElement;
    if (!target) return;
    const observer = new MutationObserver(sendDesignSystem);
    observer.observe(target, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    const motion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    const canObserveMotion =
      typeof motion?.addEventListener === 'function' &&
      typeof motion?.removeEventListener === 'function';
    if (canObserveMotion) motion.addEventListener('change', sendDesignSystem);
    return () => {
      observer.disconnect();
      if (canObserveMotion) motion.removeEventListener('change', sendDesignSystem);
    };
  }, [active, sendDesignSystem, src]);

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  return { webviewRef, partition, status, height, errorDetail, setHeight, reload };
}

/** Electron's `<webview>` needs explicit preferences; sandbox stays on. */
export const VISUALIZATION_WEBVIEW_PREFERENCES =
  'sandbox=yes,contextIsolation=yes,nodeIntegration=no,webSecurity=yes';
