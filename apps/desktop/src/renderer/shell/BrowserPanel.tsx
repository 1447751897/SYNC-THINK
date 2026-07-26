// 内置浏览器面板（NewMax 风格）：右栏内嵌 <webview> 浏览公网页面。
// 安全边界：guest 在 main 的 will-attach-webview 中被强制去权限（无 node/preload、
// 强制沙箱），这里只允许 http(s) 导航，弹窗一律收进当前 webview。
import { ArrowLeft, ArrowRight, Globe, Home, Loader2, RotateCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { registerBrowserWebview, type BrowserWebviewElement } from './browser-commands.js';

const HOME_URL = 'https://www.bing.com';

/** 把地址栏输入规范成可导航 URL：无协议按 https 补全；带空格当搜索词。 */
export function normalizeBrowserInput(raw: string): string {
  const text = raw.trim();
  if (!text) return HOME_URL;
  if (/^https?:\/\//i.test(text)) return text;
  // 明显是域名（无空格且含点）→ 补 https；否则丢给搜索引擎。
  if (!/\s/.test(text) && text.includes('.')) return `https://${text}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
}

interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  getURL(): string;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  getWebContentsId(): number;
}

export function BrowserPanel(props: {
  /** 初始打开的 URL（例如从消息里的链接唤起）。 */
  initialUrl?: string;
  /** 外部（AI browser_open 工具）下发的导航 URL。 */
  navigateUrl?: string;
  /** 相同 URL 重复导航时递增的序号。 */
  navigateSeq?: number;
  /** 嵌在多面板 Dock 里：隐藏自身关闭按钮（由 Dock 头部统一管理）。 */
  embedded?: boolean;
  /**
   * webview 的 session partition（Cookie / 登录态隔离域）。默认与右栏共用
   * 'persist:browser-panel'。注意：Electron webview 的 partition 挂载后不可再改，
   * 宿主如需切换 partition 必须换 key 强制重建本组件（BrowserStage 就是这么做的）。
   */
  partition?: string;
  /**
   * 是否把本实例的 webview 注册到 browser-commands 的 activeWebview 单例
   * （AI browser_* 工具的操控目标）。默认 true 保持右栏行为；浏览器独立页
   * （BrowserStage）传 false，避免两个实例互相抢注册。
   */
  registerForAutomation?: boolean;
  onClose(): void;
}) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const [address, setAddress] = useState(props.initialUrl ?? HOME_URL);
  const [currentUrl, setCurrentUrl] = useState(props.initialUrl ?? HOME_URL);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [failure, setFailure] = useState<string>();

  const registerForAutomation = props.registerForAutomation ?? true;

  // AI 浏览器命令执行器：面板挂载时把 webview 注册给 browser-commands，
  // 卸载（右栏关闭）时注销 —— 此时 AI 操作工具会得到「面板未打开」错误。
  // registerForAutomation=false（浏览器独立页）时完全不碰单例。
  useEffect(() => {
    if (!registerForAutomation) return;
    registerBrowserWebview(webviewRef.current as unknown as BrowserWebviewElement | null);
    return () => registerBrowserWebview(null);
  }, [registerForAutomation]);

  // webview 是自定义元素，React 不识别其事件 —— 手动挂监听。
  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return;
    const syncNav = () => {
      setCanBack(view.canGoBack());
      setCanForward(view.canGoForward());
      const url = view.getURL();
      if (url && url !== 'about:blank') {
        setCurrentUrl(url);
        setAddress(url);
      }
    };
    const onStart = () => {
      setLoading(true);
      setFailure(undefined);
    };
    const onStop = () => {
      setLoading(false);
      syncNav();
    };
    const onNavigate = () => syncNav();
    const onTitle = (event: Event) => {
      const detail = event as Event & { title?: string };
      if (typeof detail.title === 'string') setTitle(detail.title);
    };
    const onFail = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      // 子资源失败（广告/统计脚本）不提示；-3 是用户主动中断。
      if (detail.isMainFrame === false || detail.errorCode === -3) return;
      setLoading(false);
      setFailure(detail.errorDescription || '页面加载失败');
    };
    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-navigate', onNavigate);
    view.addEventListener('did-navigate-in-page', onNavigate);
    view.addEventListener('page-title-updated', onTitle);
    view.addEventListener('did-fail-load', onFail);
    return () => {
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-navigate', onNavigate);
      view.removeEventListener('did-navigate-in-page', onNavigate);
      view.removeEventListener('page-title-updated', onTitle);
      view.removeEventListener('did-fail-load', onFail);
    };
  }, []);

  const navigate = useCallback((raw: string) => {
    const url = normalizeBrowserInput(raw);
    setFailure(undefined);
    setCurrentUrl(url);
    setAddress(url);
    const view = webviewRef.current;
    if (view) view.src = url;
  }, []);

  // AI browser_open 工具驱动的外部导航（seq 递增支持重复打开同一 URL）。
  useEffect(() => {
    if (props.navigateUrl) navigate(props.navigateUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.navigateUrl, props.navigateSeq]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="browser-panel">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
        <button
          type="button"
          className="flex h-6.5 w-6.5 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text disabled:opacity-30"
          disabled={!canBack}
          title="后退"
          onClick={() => webviewRef.current?.goBack()}
        >
          <ArrowLeft size={13} />
        </button>
        <button
          type="button"
          className="flex h-6.5 w-6.5 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text disabled:opacity-30"
          disabled={!canForward}
          title="前进"
          onClick={() => webviewRef.current?.goForward()}
        >
          <ArrowRight size={13} />
        </button>
        <button
          type="button"
          className="flex h-6.5 w-6.5 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
          title={loading ? '停止' : '刷新'}
          onClick={() => {
            const view = webviewRef.current;
            if (!view) return;
            if (loading) view.stop();
            else view.reload();
          }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
        </button>
        <button
          type="button"
          className="flex h-6.5 w-6.5 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
          title="主页"
          onClick={() => navigate(HOME_URL)}
        >
          <Home size={13} />
        </button>
        <div className="relative min-w-0 flex-1">
          <Globe size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-faint" />
          <input
            data-testid="browser-address-input"
            className="h-7 w-full rounded-md border border-border bg-page pl-6.5 pr-2 text-[11.5px] text-text focus:border-accent focus:outline-none"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') navigate(address);
            }}
            onFocus={(event) => event.currentTarget.select()}
            placeholder="输入网址或搜索"
            spellCheck={false}
          />
        </div>
        {!props.embedded ? (
          <button
            type="button"
            className="flex h-6.5 w-6.5 items-center justify-center rounded text-text-faint hover:bg-hover hover:text-text"
            title="关闭浏览器"
            onClick={props.onClose}
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      {title ? (
        <div className="shrink-0 truncate border-b border-border bg-page px-3 py-1 text-[10.5px] text-text-faint" title={currentUrl}>
          {title}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        {failure ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface px-6 text-center">
            <Globe size={22} className="text-text-faint" />
            <div className="text-[12.5px] text-text-secondary">{failure}</div>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-text-secondary hover:bg-hover"
              onClick={() => navigate(currentUrl)}
            >
              重试
            </button>
          </div>
        ) : null}
        {/* React 对自定义元素直接透传属性；partition 隔离登录态与主渲染进程。
            partition 挂载后不可动态更改 —— 切换 Profile 由宿主用 key 重建组件。 */}
        <webview
          ref={webviewRef as never}
          src={currentUrl}
          partition={props.partition ?? 'persist:browser-panel'}
          // @ts-expect-error 自定义元素属性
          allowpopups="false"
          className="h-full w-full"
          style={{ display: 'flex' }}
        />
      </div>
    </div>
  );
}
