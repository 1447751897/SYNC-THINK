// NewMax-style embedded browser surface. The guest webview is still hardened
// in the main process; this component owns the browser chrome and its state.
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Cookie,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FolderDown,
  Globe,
  Globe2,
  History,
  Home,
  KeyRound,
  Loader2,
  Maximize2,
  Minus,
  Monitor,
  MoreHorizontal,
  Plus,
  Printer,
  RotateCw,
  Search,
  Settings2,
  Smartphone,
  Tablet,
  Trash2,
  UserRound,
  Download,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { canonicalizeLocalWebPageUrl, isLocalWebPageUrl } from '../../local-web-page-contract.js';
import {
  activateBrowserWebview,
  registerBrowserWebview,
  unregisterBrowserWebview,
  type BrowserWebviewElement,
} from './browser-commands.js';
import { siteFaviconUrl } from './ExternalSourceIcon.js';
import { DEFAULT_EMBEDDED_BROWSER_PARTITION, type EmbeddedBrowserSessionInfo } from '../../browser-session-info.js';
import {
  contentBlockingConfig,
  isContentBlockingEnabledForUrl,
  loadEmbeddedBrowserSettings,
  onEmbeddedBrowserSettingsChange,
  saveEmbeddedBrowserSettings,
  setContentBlockingForUrl,
  type EmbeddedBrowserSettings,
} from './embedded-browser-settings.js';
import { embeddedBrowserProfileName, readDefaultEmbeddedBrowserProfile } from './embedded-browser-profile.js';
import { lazyPanel } from './lazy-panel.js';
import { ToggleControl } from './ToggleControl.js';
import { useDialog } from './Dialog.js';
import type { BrowserDataManagerProps, BrowserDataManagerView } from './BrowserDataManager.js';
import './browser-profile-info.css';

const BrowserDataManager = lazyPanel<BrowserDataManagerProps>(() => import('./BrowserDataManager.js').then(module => ({ default: module.BrowserDataManager })), '浏览器设置', 'BrowserDataManager');

// NewMax opens a fresh embedded tab as an empty page. Search is still routed
// to Bing for non-URL address input, but the home/new-tab target stays blank.
const HOME_URL = 'about:blank';
const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const MIN_AUTO_ZOOM = 0.5;
const MAX_AUTO_ZOOM = 1;
const GUEST_ZOOM_PREFIX = '__SYNC_THINK_BROWSER_ZOOM__:';

export function browserZoomStepFromWheel(deltaY: number): -1 | 1 {
  return deltaY < 0 ? 1 : -1;
}

export function parseGuestZoomDelta(message: string): number | null {
  if (!message.startsWith(GUEST_ZOOM_PREFIX)) return null;
  const delta = Number(message.slice(GUEST_ZOOM_PREFIX.length));
  return Number.isFinite(delta) && delta !== 0 ? delta : null;
}

export function guestBrowserZoomBridgeScript(): string {
  return `(() => {
    if (window.__syncThinkBrowserZoomBound) return true;
    window.__syncThinkBrowserZoomBound = true;
    window.addEventListener('wheel', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      console.debug(${JSON.stringify(GUEST_ZOOM_PREFIX)} + event.deltaY);
    }, { passive: false, capture: true });
    return true;
  })()`;
}

function isEmptyBrowserUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '' || normalized === 'about:blank';
}

function externalBrowserUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  if (!/\s/.test(candidate) && candidate.includes('.')) return `https://${candidate}`;
  return null;
}

function advanceBrowserLoadProgress(progress: number, elapsedMs: number): number {
  const ceiling = 0.92;
  const clamped = Math.min(Math.max(progress, 0), ceiling);
  const consumedRatio = 1 - Math.exp(-Math.max(elapsedMs, 0) / 1_200);
  return Math.min(ceiling, clamped + (ceiling - clamped) * consumedRatio);
}

/** 把地址栏输入规范成可导航 URL：无协议按 https 补全；带空格当搜索词。 */
export function normalizeBrowserInput(raw: string): string {
  const text = raw.trim();
  if (!text) return HOME_URL;
  if (isLocalWebPageUrl(text)) return canonicalizeLocalWebPageUrl(text);
  if (/^(?:about:blank|data:text\/html(?:;|,))/i.test(text)) return text;
  if (/^https?:\/\//i.test(text)) return text;
  // 明显是域名（无空格且含点）→ 补 https；否则丢给搜索引擎。
  if (!/\s/.test(text) && text.includes('.')) return `https://${text}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
}

type BrowserDevicePreset = 'responsive' | 'phone' | 'tablet';

interface BrowserFindResult {
  activeMatch: number;
  matches: number;
}

interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL?(url: string): Promise<void>;
  getURL(): string;
  getTitle?(): string;
  getWebContentsId(): number;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  setZoomFactor?(factor: number): void;
  findInPage?(text: string, options?: { forward?: boolean; findNext?: boolean }): number;
  stopFindInPage?(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): void;
  print?(options?: unknown, callback?: (success: boolean, failureReason: string) => void): void;
  clearHistory?(): void;
}

function firstFavicon(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const favicon = value.find((item) => typeof item === 'string' && item.trim());
  return typeof favicon === 'string' ? favicon.trim() : undefined;
}

function fallbackSiteFavicon(url: string): string | undefined {
  if (isEmptyBrowserUrl(url)) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) return undefined;
    return siteFaviconUrl(host);
  } catch {
    return undefined;
  }
}

/** Electron <webview> ignores percentage height; the guest needs a pixel box. */
export function browserGuestBox(size: { width: number; height: number }): {
  width: number;
  height: number;
} | null {
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function nextZoom(value: number, direction: -1 | 1): number {
  const currentIndex = ZOOM_LEVELS.findIndex((level) => level >= value - 0.001);
  const index = currentIndex < 0 ? ZOOM_LEVELS.length - 1 : currentIndex;
  return ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, index + direction))] ?? 1;
}

interface BrowserPanelProps {
  /** 初始打开的 URL（例如从消息里的链接唤起）。 */
  initialUrl?: string;
  /** 外部（AI browser_open 工具）下发的导航 URL。 */
  navigateUrl?: string;
  /** 相同 URL 重复导航时递增的序号。 */
  navigateSeq?: number;
  /** 嵌在多面板 Dock 里：隐藏自身关闭按钮（由 Dock 头部统一管理）。 */
  embedded?: boolean;
  /** 当前项目根目录，用于保存浏览器截图。 */
  projectFolder?: string;
  /** webview 新窗口请求交给宿主创建一个新的浏览器 Tab。 */
  onNewTab?: (url?: string) => void;
  /**
   * 显式隔离域用于本地 HTML 预览；普通网页读取已设置的默认资料。
   */
  partition?: string;
  /** 是否把本实例的 webview 注册到 browser-commands 的 activeWebview 单例。 */
  registerForAutomation?: boolean;
  /** 宿主认定的当前聚焦窗格，优先接收 AI 浏览器命令。 */
  automationActive?: boolean;
  automationOwnerId?: string;
  /** Live page chrome for the pane tab (favicon + title). */
  onPageMeta?(meta: { title?: string; favicon?: string; url: string }): void;
  onClose(): void;
}

export function BrowserPanel(props: BrowserPanelProps) {
  // Do not mutate a mounted guest's storage identity or erase an older profile.
  const [partition] = useState(() => props.partition ?? readDefaultEmbeddedBrowserProfile());
  return <BrowserPanelSession {...props} partition={partition} />;
}

function BrowserPanelSession(props: BrowserPanelProps) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const dialog = useDialog();
  const initialUrl = canonicalizeLocalWebPageUrl(props.initialUrl ?? HOME_URL);
  const [address, setAddress] = useState(isEmptyBrowserUrl(initialUrl) ? '' : initialUrl);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [sourceUrl, setSourceUrl] = useState(isEmptyBrowserUrl(initialUrl) ? 'about:blank' : initialUrl);
  const [addressEditing, setAddressEditing] = useState(false);
  const [addressHovered, setAddressHovered] = useState(false);
  const [title, setTitle] = useState('');
  const [favicon, setFavicon] = useState<string>();
  const onPageMetaRef = useRef(props.onPageMeta);
  onPageMetaRef.current = props.onPageMeta;
  const [loading, setLoading] = useState(true);
  const [pageReady, setPageReady] = useState(false);
  const pageReadyRef = useRef(false);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [progress, setProgress] = useState<number | null>(
    isEmptyBrowserUrl(initialUrl) ? null : 0.12,
  );
  const [zoomFactor, setZoomFactor] = useState(1);
  const [browserSettings, setBrowserSettings] = useState<EmbeddedBrowserSettings>(
    () => loadEmbeddedBrowserSettings(),
  );
  const [autoFit, setAutoFit] = useState(() => loadEmbeddedBrowserSettings().autoFit);
  const [guestBox, setGuestBox] = useState<{ width: number; height: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomFactorRef = useRef(1);
  const [devicePreset, setDevicePreset] = useState<BrowserDevicePreset>('responsive');
  const [isDeviceToolbarOpen, setIsDeviceToolbarOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<BrowserFindResult>({ activeMatch: 0, matches: 0 });
  const [moreOpen, setMoreOpen] = useState(false);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [dataManager, setDataManager] = useState<{ webContentsId: number; initialView: BrowserDataManagerView }>();
  const partition = props.partition ?? DEFAULT_EMBEDDED_BROWSER_PARTITION;
  const [sessionInfo, setSessionInfo] = useState<EmbeddedBrowserSessionInfo>();
  const persistentProfile = sessionInfo?.persistent ?? (partition === '' || partition.startsWith('persist:'));
  const [sessionError, setSessionError] = useState('');
  const openDataManager = (initialView: BrowserDataManagerView) => {
    try {
      const webContentsId = webviewRef.current?.getWebContentsId();
      if (!webContentsId) throw new Error('not ready');
      setMoreOpen(false); setProfileOpen(false); setDataManager({ webContentsId, initialView });
    } catch { setSessionError('页面尚未就绪，请等待加载后重试'); }
  };
  const profileRef = useRef<HTMLDivElement>(null);
  const profileCardRef = useRef<HTMLElement>(null);
  const [profilePosition, setProfilePosition] = useState({ top: 0, right: 12 });
  useLayoutEffect(() => {
    if (!profileOpen) return;
    const position = () => {
      const rect = profileRef.current?.getBoundingClientRect();
      if (rect) setProfilePosition({ top: rect.bottom + 9, right: Math.max(12, Math.min(window.innerWidth - rect.right, window.innerWidth - Math.min(360, window.innerWidth - 28) - 12)) });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [profileOpen]);
  useEffect(() => {
    if (!profileOpen) return;
    let cancelled = false;
    setSessionError('');
    const api = window.syncThink?.runtime?.getEmbeddedBrowserSessionInfo;
    if (!api) setSessionError('当前环境尚未接入资料目录查询；桌面端更新并重启后可查看。');
    else {
      try {
        const id = webviewRef.current?.getWebContentsId();
        if (!id) throw new Error('页面尚未就绪，请等待加载后重试');
        void api({webContentsId:id}).then(info => { if (!cancelled) setSessionInfo(info); }).catch(() => { if (!cancelled) setSessionError('读取资料目录失败，请等待页面就绪后重试'); });
      } catch { setSessionError('页面尚未就绪，请等待加载后重试'); }
    }
    const close = (event: PointerEvent) => { if (!profileRef.current?.contains(event.target as Node) && !profileCardRef.current?.contains(event.target as Node)) setProfileOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setProfileOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => { cancelled = true; document.removeEventListener('pointerdown',close); document.removeEventListener('keydown',escape); };
  }, [profileOpen, pageReady]);
  const [notice, setNotice] = useState<string>();
  const autoFitRef = useRef(autoFit);
  const currentUrlRef = useRef(currentUrl);
  const registerForAutomation = props.registerForAutomation ?? true;
  const automationActive = props.automationActive ?? true;

  useEffect(() => {
    autoFitRef.current = autoFit;
  }, [autoFit]);

  useEffect(() => {
    pageReadyRef.current = pageReady;
  }, [pageReady]);

  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  // Content blocking config lives in the Renderer; push it to the main process
  // whenever it changes, and once when the guest attaches.
  const pushContentBlocking = useCallback((settings: EmbeddedBrowserSettings) => {
    const api = window.syncThink?.runtime?.configureEmbeddedBrowserContentBlocking;
    if (!api) return;
    try {
      const webContentsId = webviewRef.current?.getWebContentsId();
      if (!webContentsId) return;
      void api({ webContentsId, ...contentBlockingConfig(settings) }).catch(() => undefined);
    } catch {
      // The guest is not attached yet; the did-attach listener retries.
    }
  }, []);

  // Every embedded tab follows the same broadcast, exactly like NewMax: one tab
  // toggling a switch updates the settings of all mounted browser panels.
  useEffect(() => {
    const apply = (settings: EmbeddedBrowserSettings) => {
      setBrowserSettings(settings);
      setAutoFit(settings.autoFit);
      autoFitRef.current = settings.autoFit;
      pushContentBlocking(settings);
    };
    return onEmbeddedBrowserSettingsChange(apply);
  }, [pushContentBlocking]);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return;
    const attach = () => pushContentBlocking(loadEmbeddedBrowserSettings());
    view.addEventListener('did-attach', attach);
    return () => view.removeEventListener('did-attach', attach);
  }, [pushContentBlocking]);

  const activateForAutomation = useCallback(() => {
    if (!registerForAutomation) return;
    activateBrowserWebview(webviewRef.current as unknown as BrowserWebviewElement | null);
  }, [registerForAutomation]);

  // Register each mounted webview without stealing focus from another pane.
  // Direct interaction and host pane focus explicitly activate the target.
  useEffect(() => {
    if (!registerForAutomation) return;
    const register = () => {
      const current = webviewRef.current as unknown as BrowserWebviewElement | null;
      if (current) registerBrowserWebview(current, false, canonicalizeLocalWebPageUrl(props.navigateUrl || initialUrl), props.automationOwnerId);
    };
    register();
    const view = webviewRef.current;
    view?.addEventListener('did-attach', register);
    view?.addEventListener('focus', activateForAutomation);
    view?.addEventListener('pointerdown', activateForAutomation);
    return () => {
      view?.removeEventListener('did-attach', register);
      view?.removeEventListener('focus', activateForAutomation);
      view?.removeEventListener('pointerdown', activateForAutomation);
      unregisterBrowserWebview(view as unknown as BrowserWebviewElement | null);
    };
  }, [activateForAutomation, initialUrl, props.navigateUrl, props.automationOwnerId, registerForAutomation]);

  useEffect(() => {
    if (automationActive) activateForAutomation();
  }, [activateForAutomation, automationActive]);

  const displayFavicon = favicon ?? fallbackSiteFavicon(currentUrl);

  useEffect(() => {
    onPageMetaRef.current?.({
      title: title || undefined,
      favicon: displayFavicon,
      url: currentUrl,
    });
  }, [currentUrl, displayFavicon, title]);

  const syncNavigationState = useCallback(() => {
    const view = webviewRef.current;
    if (!view) return;
    try {
      setCanBack(view.canGoBack());
      setCanForward(view.canGoForward());
      const url = canonicalizeLocalWebPageUrl(view.getURL());
      if (url) {
        setCurrentUrl(url);
        setAddress(isEmptyBrowserUrl(url) ? '' : url);
        currentUrlRef.current = url;
      }
    } catch {
      setCanBack(false);
      setCanForward(false);
    }
  }, []);

  const applyZoom = useCallback((factor: number, manual = false) => {
    const view = webviewRef.current;
    const clamped = Math.max(0.25, Math.min(2, factor));
    try {
      view?.setZoomFactor?.(clamped);
    } catch {
      return;
    }
    setZoomFactor(clamped);
    zoomFactorRef.current = clamped;
    if (manual) setAutoFit(false);
  }, []);

  const applyWheelZoom = useCallback(
    (deltaY: number) => {
      if (!pageReadyRef.current) return;
      applyZoom(nextZoom(zoomFactorRef.current, browserZoomStepFromWheel(deltaY)), true);
    },
    [applyZoom],
  );

  const detectPageWidth = useCallback(async () => {
    const view = webviewRef.current;
    if (!view || typeof view.executeJavaScript !== 'function' || !pageReadyRef.current) return null;
    try {
      const value = await view.executeJavaScript(`(() => Math.max(
        document.body?.scrollWidth || 0,
        document.documentElement?.scrollWidth || 0,
        document.body?.offsetWidth || 0,
        document.documentElement?.offsetWidth || 0
      ))()`);
      const width = Number(value);
      return Number.isFinite(width) && width > 0 ? width : null;
    } catch {
      return null;
    }
  }, []);

  const calculateAutoFit = useCallback(async () => {
    if (!autoFitRef.current || !canvasRef.current || !pageReadyRef.current) return;
    const containerWidth = canvasRef.current.clientWidth;
    if (containerWidth <= 0) return;
    const pageWidth = await detectPageWidth();
    if (!pageWidth || pageWidth <= containerWidth) return;
    const factor = Math.max(MIN_AUTO_ZOOM, Math.min(MAX_AUTO_ZOOM, containerWidth / pageWidth));
    if (Math.abs(factor - zoomFactorRef.current) < 0.01) return;
    applyZoom(factor);
  }, [applyZoom, detectPageWidth]);

  // webview 是自定义元素，React 不识别其事件，手动接入 NewMax 的导航生命周期。
  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return;
    const onStart = () => {
      setLoading(true);
      pageReadyRef.current = false;
      setPageReady(false);
      setFailure(undefined);
      setNotice(undefined);
      setFavicon(undefined);
      setTitle('');
    };
    const onDomReady = () => {
      pageReadyRef.current = true;
      setPageReady(true);
      syncNavigationState();
      if (typeof view.executeJavaScript === 'function') {
        void view.executeJavaScript(guestBrowserZoomBridgeScript()).catch(() => undefined);
      }
      if (autoFitRef.current) window.requestAnimationFrame(() => void calculateAutoFit());
    };
    const onConsoleMessage = (event: Event) => {
      const message = (event as Event & { message?: string }).message;
      if (typeof message !== 'string') return;
      const delta = parseGuestZoomDelta(message);
      if (delta == null) return;
      applyWheelZoom(delta);
    };
    const onStop = () => {
      setLoading(false);
      pageReadyRef.current = true;
      setPageReady(true);
      syncNavigationState();
      if (autoFitRef.current) window.requestAnimationFrame(() => void calculateAutoFit());
    };
    const onNavigate = (event: Event) => {
      const detail = event as Event & { url?: string; isMainFrame?: boolean };
      if (detail.isMainFrame === false) return;
      syncNavigationState();
      if (detail.url) {
        const url = canonicalizeLocalWebPageUrl(detail.url);
        setCurrentUrl(url);
        setAddress(isEmptyBrowserUrl(url) ? '' : url);
        currentUrlRef.current = url;
      }
    };
    const onTitle = (event: Event) => {
      const detail = event as Event & { title?: string };
      if (typeof detail.title === 'string') setTitle(detail.title.trim());
    };
    const onFavicon = (event: Event) => {
      const detail = event as Event & { favicons?: unknown };
      setFavicon(firstFavicon(detail.favicons));
    };
    const onFound = (event: Event) => {
      const detail = event as Event & {
        result?: { activeMatchOrdinal?: number; matches?: number };
      };
      setFindResult({
        activeMatch: detail.result?.activeMatchOrdinal ?? 0,
        matches: detail.result?.matches ?? 0,
      });
    };
    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (detail.isMainFrame === false || detail.errorCode === -3) return;
      setLoading(false);
      setPageReady(false);
      setFailure(detail.errorDescription || '页面加载失败');
    };
    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('dom-ready', onDomReady);
    view.addEventListener('console-message', onConsoleMessage);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-finish-load', onStop);
    view.addEventListener('did-navigate', onNavigate);
    view.addEventListener('did-navigate-in-page', onNavigate);
    view.addEventListener('did-start-navigation', onNavigate);
    view.addEventListener('page-title-updated', onTitle);
    view.addEventListener('page-favicon-updated', onFavicon);
    view.addEventListener('found-in-page', onFound);
    view.addEventListener('did-fail-load', onFail);
    return () => {
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('dom-ready', onDomReady);
      view.removeEventListener('console-message', onConsoleMessage);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-finish-load', onStop);
      view.removeEventListener('did-navigate', onNavigate);
      view.removeEventListener('did-navigate-in-page', onNavigate);
      view.removeEventListener('did-start-navigation', onNavigate);
      view.removeEventListener('page-title-updated', onTitle);
      view.removeEventListener('page-favicon-updated', onFavicon);
      view.removeEventListener('found-in-page', onFound);
      view.removeEventListener('did-fail-load', onFail);
    };
  }, [applyWheelZoom, calculateAutoFit, syncNavigationState]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      applyWheelZoom(event.deltaY);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [applyWheelZoom]);

  // Auto-fit tracks pane resize and remains bounded to the NewMax 50%-100% range.
  useEffect(() => {
    if (!autoFit || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void calculateAutoFit(), 180);
    };
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(schedule);
      observer.observe(canvas);
      return () => {
        observer.disconnect();
        if (timer !== undefined) window.clearTimeout(timer);
      };
    }
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('resize', schedule);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [autoFit, calculateAutoFit]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const sync = () => {
      const next = browserGuestBox({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
      if (!next) return;
      setGuestBox((current) =>
        current?.width === next.width && current.height === next.height ? current : next,
      );
    };
    sync();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', sync);
      return () => window.removeEventListener('resize', sync);
    }
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const navigate = useCallback((raw: string) => {
    const url = normalizeBrowserInput(raw);
    const previousUrl = currentUrlRef.current;
    setFailure(undefined);
    setPageReady(false);
    setLoading(true);
    setCurrentUrl(url);
    currentUrlRef.current = url;
    setSourceUrl(isEmptyBrowserUrl(url) ? 'about:blank' : url);
    setAddress(isEmptyBrowserUrl(url) ? '' : url);
    setAddressEditing(false);
    setFindOpen(false);
    setFindQuery('');
    setFindResult({ activeMatch: 0, matches: 0 });
    setFavicon(undefined);
    const view = webviewRef.current;
    if (!view) return;
    try {
      if (url === previousUrl && view.loadURL) void view.loadURL(url);
      else view.src = url;
    } catch {
      view.src = url;
    }
  }, []);

  const beginAddressEditing = useCallback(() => {
    setAddress(isEmptyBrowserUrl(currentUrlRef.current) ? '' : currentUrlRef.current);
    setAddressEditing(true);
    window.setTimeout(() => {
      addressInputRef.current?.focus();
      addressInputRef.current?.select();
    }, 0);
  }, []);

  const cancelAddressEditing = useCallback(() => {
    setAddress(isEmptyBrowserUrl(currentUrlRef.current) ? '' : currentUrlRef.current);
    setAddressEditing(false);
  }, []);

  // AI browser_open 工具驱动的外部导航（seq 递增支持重复打开同一 URL）。
  useEffect(() => {
    if (props.navigateUrl) navigate(props.navigateUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.navigateUrl, props.navigateSeq]);

  const closeFind = useCallback(() => {
    webviewRef.current?.stopFindInPage?.('clearSelection');
    setFindOpen(false);
    setFindQuery('');
    setFindResult({ activeMatch: 0, matches: 0 });
  }, []);

  // Electron 33 no longer dispatches WebView `new-window` DOM events. The
  // main process denies the popup and relays the opener guest id through the
  // preload bridge; only the tab that owns that guest may create a new tab.
  const onNewTab = props.onNewTab;
  const handleBrowserNewTab = useCallback(
    (payload: { openerWebContentsId: number; url: string }) => {
      const view = webviewRef.current;
      if (!view || typeof payload?.url !== 'string') return;
      try {
        if (view.getWebContentsId() !== payload.openerWebContentsId) return;
      } catch {
        return;
      }
       onNewTab?.(payload.url);
    },
    [onNewTab],
  );

  useEffect(() => {
    const subscribe = window.syncThink?.runtime?.onBrowserNewTab;
    if (!subscribe) return;
    return subscribe(handleBrowserNewTab);
  }, [handleBrowserNewTab]);

  const updateFindQuery = useCallback((value: string) => {
    setFindQuery(value);
    setFindResult({ activeMatch: 0, matches: 0 });
    const view = webviewRef.current;
    if (!view || !pageReady) return;
    if (!value) {
      view.stopFindInPage?.('clearSelection');
      return;
    }
    view.findInPage?.(value);
  }, [pageReady]);

  const findNext = useCallback((forward: boolean) => {
    if (!findQuery || !pageReady) return;
    webviewRef.current?.findInPage?.(findQuery, { forward, findNext: true });
  }, [findQuery, pageReady]);

  const toggleAutoFit = useCallback(() => {
    const next = !autoFitRef.current;
    saveEmbeddedBrowserSettings({ autoFit: next });
    autoFitRef.current = next;
    setAutoFit(next);
    if (next) window.requestAnimationFrame(() => void calculateAutoFit());
  }, [calculateAutoFit]);

  const canToggleSiteContentBlocking = !isEmptyBrowserUrl(currentUrl) && browserSettings.contentBlocking;
  const siteContentBlockingEnabled = isContentBlockingEnabledForUrl(browserSettings, currentUrl);

  const toggleSiteContentBlocking = useCallback((enabled: boolean) => {
    const next = saveEmbeddedBrowserSettings(
      setContentBlockingForUrl(loadEmbeddedBrowserSettings(), currentUrlRef.current, enabled),
    );
    setBrowserSettings(next);
    pushContentBlocking(next);
    webviewRef.current?.reload();
  }, [pushContentBlocking]);

  const openDownloads = useCallback(async () => {
    try {
      const result = await window.syncThink?.runtime?.openBrowserDownloads?.();
      if (result && !result.ok) setNotice(result.error || '无法打开下载目录');
    } catch {
      setNotice('无法打开下载目录');
    }
  }, []);

  const clearCookiesAndSiteData = useCallback(async () => {
    const view = webviewRef.current;
    if (!view?.getWebContentsId || !window.syncThink?.runtime?.manageEmbeddedBrowserData) return;
    const ok = await dialog.confirm({
      title: '清除浏览数据',
      message: '将清除所有内嵌网页标签共用的 Cookie、缓存和网站登录状态，不影响应用登录态或自动化浏览器 Profile。此操作无法撤销。',
      confirmText: '清除',
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await window.syncThink.runtime.manageEmbeddedBrowserData({
        action: 'clear-session',
        webContentsId: view.getWebContentsId(),
      });
      setNotice(result.ok ? result.message || '浏览数据已清除' : result.error);
      if (result.ok) view.reload();
    } catch {
      setNotice('清除浏览数据失败');
    }
  }, [dialog]);

  const clearBrowsingHistory = useCallback(async () => {
    const view = webviewRef.current;
    if (!view?.clearHistory) return;
    const ok = await dialog.confirm({
      title: '清除浏览数据',
      message: '将清除当前网页标签的后退和前进历史记录。此操作无法撤销。',
      confirmText: '清除',
      danger: true,
    });
    if (!ok) return;
    view.clearHistory();
    setNotice('浏览数据已清除');
  }, [dialog]);

  const openExternal = useCallback((value: string) => {
    const target = externalBrowserUrl(value);
    if (!target) return;
    void window.syncThink?.runtime?.openExternalUrl?.(target);
  }, []);

  const takeScreenshot = useCallback(async () => {
    const view = webviewRef.current;
    if (!props.projectFolder || !view?.getWebContentsId || !window.syncThink?.runtime?.saveBrowserScreenshot) {
      setNotice('截图需要绑定项目后才能保存');
      return;
    }
    try {
      const result = await window.syncThink.runtime.saveBrowserScreenshot({
        root: props.projectFolder,
        webContentsId: view.getWebContentsId(),
      });
      setNotice(
        result.ok
          ? `截图已保存${result.relativePath ? `：${result.relativePath}` : ''}`
          : result.error || '截图保存失败',
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '截图保存失败');
    }
    window.setTimeout(() => setNotice(undefined), 2_600);
  }, [props.projectFolder]);

  // NewMax fills a matching saved login 200ms after a page settles. A page with
  // no saved entry is a silent no-op, and the main process re-checks the origin.
  useEffect(() => {
    if (!browserSettings.autofill || loading || !pageReady || isEmptyBrowserUrl(currentUrl)) return;
    const timer = window.setTimeout(() => {
      const view = webviewRef.current;
      const api = window.syncThink?.runtime?.manageEmbeddedBrowserData;
      if (!view?.getWebContentsId || !api) return;
      try {
        void api({ action: 'autofill', webContentsId: view.getWebContentsId() }).catch(() => undefined);
      } catch {
        // The guest detached before the timer fired.
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [browserSettings.autofill, currentUrl, loading, pageReady]);

  const isEmptyPage = isEmptyBrowserUrl(currentUrl);
  const externalUrl = externalBrowserUrl(currentUrl);
  const deviceWidth =
    isDeviceToolbarOpen && devicePreset === 'phone'
      ? 390
      : isDeviceToolbarOpen && devicePreset === 'tablet'
        ? 768
        : undefined;
  const toolbarLoading = !isEmptyPage && (loading || !pageReady);

  // NewMax's progress starts at 12%, approaches 92% while Chromium is busy,
  // and remains visible for 620ms as a completed line before disappearing.
  useEffect(() => {
    if (toolbarLoading) {
      setProgress((value) => (value === null || value >= 1 ? 0.12 : value));
      const timer = window.setInterval(() => {
        setProgress((value) =>
          advanceBrowserLoadProgress(value ?? 0.12, 160),
        );
      }, 160);
      return () => window.clearInterval(timer);
    }
    setProgress((value) => (value === null ? null : 1));
    const hideTimer = window.setTimeout(() => setProgress(null), 620);
    return () => window.clearTimeout(hideTimer);
  }, [toolbarLoading]);

  return (
    <div
      className="shell-browser flex h-full min-h-0 min-w-0 flex-1"
      data-testid="browser-panel"
      onPointerDownCapture={activateForAutomation}
      onFocusCapture={activateForAutomation}
    >
      <div className="shell-browser__toolbar">
        <div className="shell-browser__nav-group">
          <button
            type="button"
            className="shell-browser__icon-button"
            disabled={!canBack}
            title="后退"
            aria-label="后退"
            onClick={() => webviewRef.current?.goBack()}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            className="shell-browser__icon-button"
            disabled={!canForward}
            title="前进"
            aria-label="前进"
            onClick={() => webviewRef.current?.goForward()}
          >
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            className="shell-browser__icon-button"
            title={loading ? '停止加载' : '刷新'}
            aria-label={loading ? '停止加载' : '刷新'}
            onClick={() => {
              const view = webviewRef.current;
              if (!view) return;
              if (loading) {
                view.stop();
                setLoading(false);
                setPageReady(true);
              } else view.reload();
            }}
          >
            {loading ? <Loader2 size={15} className="shell-browser__spin" /> : <RotateCw size={15} />}
          </button>
        </div>
        <button
          type="button"
          className="shell-browser__icon-button"
          title="主页"
          aria-label="主页"
          onClick={() => navigate(HOME_URL)}
        >
          <Home size={15} />
        </button>
        <div
          className={`shell-browser__address-shell${addressEditing ? ' is-editing' : ''}`}
          data-address-alignment={addressEditing ? 'left' : 'center'}
          role={addressEditing ? undefined : 'button'}
          tabIndex={addressEditing ? -1 : 0}
          onClick={() => {
            if (!addressEditing) beginAddressEditing();
          }}
          onKeyDown={(event) => {
            if (!addressEditing && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              beginAddressEditing();
            }
          }}
          onMouseEnter={() => setAddressHovered(true)}
          onMouseLeave={() => setAddressHovered(false)}
          aria-label={addressEditing ? '地址栏' : `当前页面 ${currentUrl}`}
        >
          {progress !== null ? (
            <span className="shell-browser__progress" aria-hidden="true">
              <span
                className="shell-browser__progress-glow"
                style={{ width: `${Math.min(1, progress) * 100}%`, opacity: progress >= 1 ? 0 : 1 }}
              />
              <span
                className="shell-browser__progress-halo"
                style={{ width: `${Math.min(1, progress) * 100}%`, opacity: progress >= 1 ? 0 : 1 }}
              />
              <span
                className="shell-browser__progress-line"
                style={{ width: `${Math.min(1, progress) * 100}%`, opacity: progress >= 1 ? 0 : 1 }}
              />
            </span>
          ) : null}
          {!addressEditing ? (
            <span className="shell-browser__address-label" data-testid="browser-address-label">
              {displayFavicon ? (
                <img className="shell-browser__favicon" src={displayFavicon} alt="" />
              ) : null}
              <span className="shell-browser__address-text">
                {isEmptyPage ? '输入网址或搜索' : currentUrl}
              </span>
            </span>
          ) : (
            <>
              {displayFavicon ? (
                <img className="shell-browser__favicon" src={displayFavicon} alt="" />
              ) : (
                <Globe className="shell-browser__address-icon" size={13} aria-hidden="true" />
              )}
              <input
                ref={addressInputRef}
                data-testid="browser-address-input"
                className="shell-browser__address-input"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    navigate(address);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelAddressEditing();
                  }
                }}
                onBlur={() => {
                  if (addressEditing) cancelAddressEditing();
                }}
                placeholder="输入网址或搜索"
                aria-label="地址栏"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </>
          )}
          {externalUrl && (addressHovered || addressEditing) ? (
            <button
              type="button"
              className="shell-browser__external-button"
              title="在默认浏览器中打开"
              aria-label="在默认浏览器中打开"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                openExternal(currentUrl);
              }}
            >
              <ExternalLink size={13} />
            </button>
          ) : null}
        </div>
        <div ref={profileRef} className="shell-browser-profile">
          <button type="button" className="shell-browser-profile__trigger" aria-label="浏览器资料与登录保存位置" aria-expanded={profileOpen} onClick={() => { setMoreOpen(false); setProfileOpen(value=>!value); }}>
            <UserRound size={14} /><span>{embeddedBrowserProfileName(partition)}</span>
          </button>
          {profileOpen && createPortal(<section ref={profileCardRef} className="shell-browser-profile__card" style={{ ...profilePosition, maxHeight: `calc(100vh - ${profilePosition.top + 12}px)` }} aria-label="当前浏览器资料">
            <strong>内置浏览器 · {embeddedBrowserProfileName(partition)}</strong>
            <p>{sessionInfo ? persistentProfile ? '登录状态保存在本机；同一资料的新标签与重启后继续使用。' : '当前是临时会话，退出后不会保留登录状态。' : sessionError || '正在检查当前页面的实际存储会话…'}</p>
            <span className="shell-browser-profile__label">资料目录</span>
            <code>{sessionInfo?.storagePath ?? (sessionInfo && !sessionInfo.persistent ? '内存会话，无持久化目录' : sessionError || '读取中…')}</code>
            <button type="button" disabled={!pageReady} onClick={() => openDataManager('passwords')}>密码和 Cookie 设置</button>
            <small>内置浏览器默认沿用同一份资料，不自动共享 Chrome / Edge 的个人登录状态。网站登录过期仍需重新登录。</small>
            {sessionInfo?.storagePath && <button type="button" onClick={async () => {
              try {
                if (window.syncThink?.editing) await window.syncThink.editing.writeText(sessionInfo.storagePath!);
                else await navigator.clipboard.writeText(sessionInfo.storagePath!);
                setSessionError('目录已复制');
              } catch { setSessionError('复制失败，请手动选择目录文本'); }
            }}>复制目录</button>}
            {sessionError && <p role="status">{sessionError}</p>}
          </section>, document.body)}
        </div>
        <button
          type="button"
          className={`shell-browser__icon-button${moreOpen ? ' is-active' : ''}`}
          title="更多浏览器选项"
          aria-label="更多浏览器选项"
          aria-expanded={moreOpen}
          data-testid="browser-more-button"
          onClick={() => setMoreOpen((value) => !value)}
        >
          <MoreHorizontal size={17} />
        </button>
        {!props.embedded ? (
          <button
            type="button"
            className="shell-browser__icon-button"
            title="关闭浏览器"
            aria-label="关闭浏览器"
            onClick={props.onClose}
          >
            <X size={15} />
          </button>
        ) : null}
      </div>
      {moreOpen ? (
        <div className="shell-browser__more-menu" data-testid="browser-more-menu" role="menu">
          <button type="button" role="menuitem" disabled={!pageReady} onClick={() => { setMoreOpen(false); setFindOpen(true); }}>
            <Search size={14} />
            <span>在页面中查找</span>
          </button>
          <button type="button" role="menuitem" disabled={!pageReady} onClick={() => { setMoreOpen(false); webviewRef.current?.print?.(); }}>
            <Printer size={14} />
            <span>打印页面</span>
          </button>
          <div className="shell-browser__menu-divider" />
          <div className="shell-browser__zoom-row" role="group" aria-label="页面缩放">
            <span>缩放</span>
            <div className="shell-browser__zoom-controls">
              <button type="button" disabled={!pageReady || zoomFactor <= 0.25} title="缩小" aria-label="缩小" onClick={() => applyZoom(nextZoom(zoomFactor, -1), true)}><Minus size={13} /></button>
              <button type="button" title="重置缩放" aria-label="重置缩放" onClick={() => applyZoom(1, true)}>{Math.round(zoomFactor * 100)}%</button>
              <button type="button" disabled={!pageReady || zoomFactor >= 2} title="放大" aria-label="放大" onClick={() => applyZoom(nextZoom(zoomFactor, 1), true)}><Plus size={13} /></button>
              <button type="button" className={autoFit ? 'is-selected' : ''} title={autoFit ? '关闭自动适配' : '自动适配宽度'} aria-label={autoFit ? '关闭自动适配' : '自动适配宽度'} aria-pressed={autoFit} onClick={toggleAutoFit}><Maximize2 size={14} /></button>
            </div>
          </div>
          <div className="shell-browser__menu-divider" />
          <div className="shell-browser__switch-row" role="group" aria-label="拦截此网站的广告">
            <span>拦截此网站的广告</span>
            <ToggleControl
              checked={siteContentBlockingEnabled}
              disabled={!canToggleSiteContentBlocking}
              label="拦截此网站的广告"
              onChange={toggleSiteContentBlocking}
              className="shell-browser__switch"
              thumbClassName="shell-browser__switch-thumb"
            />
          </div>
          <div className="shell-browser__menu-divider" />
          <button type="button" role="menuitem" disabled={!pageReady} onClick={() => { setMoreOpen(false); setIsDeviceToolbarOpen(true); }}>
            <Smartphone size={14} />
            <span>设备预览</span>
            <small>{!isDeviceToolbarOpen || devicePreset === 'responsive' ? '自适应' : devicePreset === 'phone' ? '手机' : '平板'}</small>
          </button>
          <button type="button" role="menuitem" disabled={!pageReady} onClick={() => { setMoreOpen(false); void takeScreenshot(); }}>
            <Camera size={14} />
            <span>保存截图</span>
          </button>
          <div className="shell-browser__menu-divider" />
          <button type="button" role="menuitem" disabled={!pageReady} onClick={() => openDataManager('import')}><Download size={14} /><span>导入 Cookie 和密码…</span></button>
          <button type="button" role="menuitem" disabled={!pageReady} onClick={() => openDataManager('passwords')}><KeyRound size={14} /><span>密码和自动填充</span></button>
          <button type="button" role="menuitem" disabled={!pageReady} onClick={() => { setMoreOpen(false); void openDownloads(); }}><FolderDown size={14} /><span>下载内容</span></button>
          <div className="shell-browser__submenu-row">
            <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={clearDataOpen} disabled={!pageReady} onClick={() => setClearDataOpen((value) => !value)}>
              <Trash2 size={14} />
              <span>清除浏览数据</span>
              <ChevronDown size={13} />
            </button>
            {clearDataOpen ? (
              <div className="shell-browser__submenu" role="menu" aria-label="清除浏览数据">
                <button type="button" role="menuitem" onClick={() => { setClearDataOpen(false); void clearCookiesAndSiteData(); }}><Cookie size={14} /><span>Cookie 和网站数据</span></button>
                <button type="button" role="menuitem" onClick={() => { setClearDataOpen(false); void clearBrowsingHistory(); }}><History size={14} /><span>浏览历史记录</span></button>
              </div>
            ) : null}
          </div>
          <div className="shell-browser__menu-divider" />
          <button type="button" role="menuitem" onClick={() => openDataManager('settings')}><Settings2 size={14} /><span>浏览器设置</span></button>
        </div>
      ) : null}
      {notice ? <div className="shell-browser__notice" role="status">{notice}</div> : null}
      {dataManager && <BrowserDataManager {...dataManager} currentUrl={currentUrl} onClose={() => setDataManager(undefined)} />}
      {isDeviceToolbarOpen ? (
        <div className="shell-browser__device-toolbar" data-testid="browser-device-toolbar">
          <button type="button" className={devicePreset === 'responsive' ? 'is-active' : ''} onClick={() => setDevicePreset('responsive')}><Monitor size={14} /> 自适应</button>
          <button type="button" className={devicePreset === 'phone' ? 'is-active' : ''} onClick={() => setDevicePreset('phone')}><Smartphone size={14} /> 手机 <small>390 × 844</small></button>
          <button type="button" className={devicePreset === 'tablet' ? 'is-active' : ''} onClick={() => setDevicePreset('tablet')}><Tablet size={14} /> 平板 <small>768 × 1024</small></button>
          <button type="button" className="shell-browser__device-close" title="关闭设备预览" aria-label="关闭设备预览" onClick={() => setIsDeviceToolbarOpen(false)}><X size={14} /></button>
        </div>
      ) : null}
      <div
        className={`shell-browser__canvas${isDeviceToolbarOpen && devicePreset !== 'responsive' ? ' is-device-preview' : ''}`}
        ref={canvasRef}
        data-testid="browser-canvas"
      >
        <div
          ref={viewportRef}
          className="shell-browser__viewport"
          data-testid="browser-viewport"
          style={{ width: deviceWidth, maxWidth: '100%' }}
        >
          {findOpen ? (
            <div className="shell-browser__find" data-testid="browser-find-bar">
              <Search size={13} aria-hidden="true" />
              <input
                autoFocus
                value={findQuery}
                onChange={(event) => updateFindQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); findNext(!event.shiftKey); }
                  if (event.key === 'Escape') { event.preventDefault(); closeFind(); }
                }}
                placeholder="查找页面内容"
                aria-label="查找页面内容"
              />
              <span className="shell-browser__find-count">{findQuery ? `${findResult.activeMatch} / ${findResult.matches}` : '0 / 0'}</span>
              <button type="button" title="上一个" aria-label="上一个匹配" disabled={!findQuery || !findResult.matches} onClick={() => findNext(false)}><ChevronUp size={14} /></button>
              <button type="button" title="下一个" aria-label="下一个匹配" disabled={!findQuery || !findResult.matches} onClick={() => findNext(true)}><ChevronDown size={14} /></button>
              <button type="button" title="关闭查找" aria-label="关闭查找" onClick={closeFind}><X size={14} /></button>
            </div>
          ) : null}
          {toolbarLoading ? <div className="shell-browser__loading" data-testid="browser-loading-skeleton" aria-label="正在加载页面"><span /><span /><span /></div> : null}
          {failure ? (
            <div className="shell-browser__failure" role="alert">
              <Globe size={24} aria-hidden="true" />
              <strong>{failure}</strong>
              <button type="button" onClick={() => navigate(currentUrl)}>重试</button>
            </div>
          ) : null}
          {isEmptyPage ? (
            <div className="shell-browser__empty" data-testid="browser-empty-state">
              <Globe2 size={30} strokeWidth={1.5} aria-hidden="true" />
              <strong>输入网址或搜索</strong>
              <span>打开网页，或粘贴链接开始浏览</span>
            </div>
          ) : null}
          <webview
            ref={webviewRef as never}
            src={sourceUrl}
            partition={partition}
            // @ts-expect-error 自定义元素属性
            allowpopups="true"
            className="shell-browser__webview"
            style={{
              position: 'absolute',
              inset: 0,
              width: guestBox ? `${guestBox.width}px` : '100%',
              height: guestBox ? `${guestBox.height}px` : '100%',
              opacity: toolbarLoading || failure ? 0 : 1,
            }}
          />
        </div>
      </div>
    </div>
  );
}
