// AI 操控内置浏览器：渲染层执行器。
// Runtime 发出 browser.command_requested（带 requestId）→ ChatView 调用这里，
// 在 BrowserPanel 注册的 <webview> 上执行 executeJavaScript / capturePage，
// 结果经 conversation.submitBrowserResult 回传给等待中的工具循环。
// 安全边界：脚本只在 guest 页执行；回传值 JSON 序列化并截断（64KB 上限）。
import { resolveBrowserClickTarget } from '@sync-think/shared';

/** Guest 页可见文本读取上限（约 8KB），避免整页 dump 挤爆模型上下文。 */
export const BROWSER_READ_TEXT_MAX_CHARS = 8_192;
/** 回传 JSON 的硬上限（与 runtime 端 BROWSER_COMMAND_RESULT_MAX_CHARS 对齐）。 */
export const BROWSER_RESULT_MAX_CHARS = 64_000;

export interface BrowserWebviewElement extends HTMLElement {
  src: string;
  getURL(): string;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  /** Electron webview guest id — main 进程用它 capturePage（沙箱渲染层拿不到 NativeImage）。 */
  getWebContentsId(): number;
}

// Multiple browser panes may stay mounted at once. Keep every live instance and
// route commands to the pane that is focused or was interacted with most recently.
const registeredWebviews: BrowserWebviewElement[] = [];
const intendedUrls = new WeakMap<BrowserWebviewElement, string>();
let activeWebview: BrowserWebviewElement | null = null;

function normalizeGuestUrl(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function guestUrlsMatch(left: string | undefined, right: string): boolean {
  if (!left) return false;
  return normalizeGuestUrl(left) === normalizeGuestUrl(right);
}

function currentGuestUrl(view: BrowserWebviewElement): string {
  try {
    return view.getURL?.() || view.src || '';
  } catch {
    return view.src || '';
  }
}

export function registerBrowserWebview(
  view: BrowserWebviewElement | null,
  activate = true,
  intendedUrl?: string,
): void {
  if (!view) {
    registeredWebviews.splice(0, registeredWebviews.length);
    activeWebview = null;
    return;
  }
  if (!registeredWebviews.includes(view)) registeredWebviews.push(view);
  if (intendedUrl) intendedUrls.set(view, intendedUrl);
  if (activate || !activeWebview) activeWebview = view;
}

export function findRegisteredBrowserWebview(url: string): BrowserWebviewElement | null {
  return (
    registeredWebviews.find(
      (view) =>
        guestUrlsMatch(intendedUrls.get(view), url) || guestUrlsMatch(currentGuestUrl(view), url),
    ) ?? null
  );
}

export function activateBrowserWebview(view: BrowserWebviewElement | null): void {
  if (!view) return;
  if (!registeredWebviews.includes(view)) registeredWebviews.push(view);
  activeWebview = view;
}

export function unregisterBrowserWebview(view: BrowserWebviewElement | null): void {
  if (!view) return;
  const index = registeredWebviews.indexOf(view);
  if (index >= 0) registeredWebviews.splice(index, 1);
  if (activeWebview === view) activeWebview = registeredWebviews.at(-1) ?? null;
}

export function getActiveBrowserWebview(): BrowserWebviewElement | null {
  return activeWebview;
}

export interface BrowserCommandOutcome {
  ok: boolean;
  resultJson?: string;
  error?: string;
}

const PANEL_NOT_READY_ERROR =
  '内置浏览器面板未打开或页面未就绪。请先调用 browser_open 打开目标页面（会自动弹出右栏），等待加载后再操作。';

function clampResult(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value ?? {});
  } catch {
    json = JSON.stringify({ note: 'result not serializable' });
  }
  if (json.length > BROWSER_RESULT_MAX_CHARS) {
    // 截断后仍需是合法 JSON——退化为包含截断文本的包装对象。
    json = JSON.stringify({
      truncated: true,
      partial: json.slice(0, BROWSER_RESULT_MAX_CHARS - 200),
    });
  }
  return json;
}

function isVisibleGuestElementSource(): string {
  return `function isVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    }
    function labelOf(el) {
      return String(el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
    }
    function clickableNodes() {
      return Array.from(document.querySelectorAll('a[href], button, [role="button"], [role="link"], input[type="submit"], input[type="button"], [onclick]'));
    }`;
}

/** 解析目标：可见 CSS / 可见文本；坐标回传给主进程做可信点击。 */
function buildResolveClickScript(args: Record<string, unknown>): string {
  const target = resolveBrowserClickTarget({
    selector: typeof args.selector === 'string' ? args.selector : undefined,
    text: typeof args.text === 'string' ? args.text : undefined,
    x: typeof args.x === 'number' ? args.x : undefined,
    y: typeof args.y === 'number' ? args.y : undefined,
  });
  const css = target.css ?? '';
  const text = target.text ?? '';
  const x = target.x ?? -1;
  const y = target.y ?? -1;
  return `(() => {
    ${isVisibleGuestElementSource()}
    const css = ${JSON.stringify(css)};
    const text = ${JSON.stringify(text)};
    const needle = text.toLowerCase();
    let el = null;
    let reason = '';
    if (css) {
      try {
        const matches = Array.from(document.querySelectorAll(css)).filter(isVisible);
        el = needle
          ? matches.find((node) => labelOf(node).toLowerCase().includes(needle)) || null
          : matches[0] || null;
        if (!el) reason = needle ? 'no visible element matches selector and text' : 'no visible element matches selector';
      } catch {
        reason = 'invalid CSS selector';
      }
    } else if (needle) {
      el = clickableNodes().filter(isVisible).find((node) => {
        const label = labelOf(node).toLowerCase();
        return label === needle || label.includes(needle);
      }) || null;
      if (!el) reason = 'no visible link or button matches text';
    } else {
      el = document.elementFromPoint(${x}, ${y});
      if (!el) reason = 'no element at coordinates';
    }
    if (!el) {
      const candidates = clickableNodes().filter(isVisible).slice(0, 12).map(labelOf).filter(Boolean);
      return { found: false, clicked: false, reason, candidates, url: location.href };
    }
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const rect = el.getBoundingClientRect();
    return {
      found: true,
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      tag: el.tagName.toLowerCase(),
      text: labelOf(el).slice(0, 120),
      href: el instanceof HTMLAnchorElement ? el.href : undefined,
      url: location.href,
    };
  })()`;
}

function buildSyntheticClickScript(x: number, y: number): string {
  return `(() => {
    const el = document.elementFromPoint(${x}, ${y});
    if (!el) return { clicked: false, reason: 'no element at coordinates', url: location.href };
    const opts = { bubbles: true, cancelable: true, view: window, clientX: ${x}, clientY: ${y} };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', opts));
    return { clicked: true, tag: el.tagName.toLowerCase(), url: location.href };
  })()`;
}

/** 输入脚本：native value setter + input/change 事件，兼容 React 受控输入。 */
function buildTypeScript(args: Record<string, unknown>): string {
  const selector = typeof args.selector === 'string' ? args.selector : '';
  const text = typeof args.text === 'string' ? args.text : '';
  return `(() => {
    const sel = ${JSON.stringify(selector)};
    const text = ${JSON.stringify(text)};
    const el = document.querySelector(sel);
    if (!el) return { typed: false, reason: 'no element matches selector', url: location.href };
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, text);
      else el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: true, tag: el.tagName.toLowerCase(), valueLength: el.value.length, url: location.href };
    }
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return { typed: true, tag: 'contenteditable', valueLength: text.length, url: location.href };
    }
    return { typed: false, reason: 'element is not an input / textarea / contentEditable', url: location.href };
  })()`;
}

/** 读取脚本：标题 / URL / 可见文本（截断）+ 链接与按钮概要，供 AI 理解页面。 */
function buildReadScript(args: Record<string, unknown>): string {
  const selector = typeof args.selector === 'string' ? args.selector : '';
  return `(() => {
    const sel = ${JSON.stringify(selector)};
    const max = ${BROWSER_READ_TEXT_MAX_CHARS};
    const target = sel ? document.querySelector(sel) : document.body;
    if (!target) {
      return { found: false, error: 'no element matches selector', title: document.title, url: location.href };
    }
    const isVisible = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const fullText = String(target.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(isVisible)
      .map((a) => ({ text: String(a.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80), href: a.href }))
      .filter((l) => l.text)
      .slice(0, 80);
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'))
      .filter(isVisible)
      .map((b) => String(b.innerText || b.value || b.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 40);
    return {
      found: true,
      title: document.title,
      url: location.href,
      text: fullText.slice(0, max),
      truncated: fullText.length > max,
      links,
      buttons,
    };
  })()`;
}

export interface ExecuteBrowserCommandInput {
  action: string;
  args: Record<string, unknown>;
  /** 截图保存目标（绑定项目文件夹的绝对路径）。 */
  projectFolder?: string;
  /** 主进程截图落盘桥（preload saveBrowserScreenshot：capturePage + 写文件都在 main）。 */
  saveScreenshot?: (payload: { root: string; webContentsId: number }) => Promise<{
    ok: boolean;
    path?: string;
    relativePath?: string;
    embedUrl?: string;
    error?: string;
  }>;
  /** 主进程对 webview guest 发送可信鼠标事件（isTrusted）。 */
  sendTrustedClick?: (payload: {
    webContentsId: number;
    x: number;
    y: number;
  }) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * 在当前注册的 webview 上执行一条 AI 浏览器命令。
 * 永不 throw——所有失败都折叠为 { ok:false, error } 回传给工具循环。
 */
export async function executeBrowserCommand(
  input: ExecuteBrowserCommandInput,
): Promise<BrowserCommandOutcome> {
  if (input.action === 'browser_open') {
    const url = typeof input.args.url === 'string' ? input.args.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'browser_open: 需要有效的 http(s) URL。' };
    }
    const matching = findRegisteredBrowserWebview(url);
    if (matching) activateBrowserWebview(matching);
    else if (activeWebview) activeWebview = null;
    return {
      ok: true,
      resultJson: clampResult({ ok: true, opened: true, url }),
    };
  }

  const view = await waitForActiveWebview();
  if (!view) return { ok: false, error: PANEL_NOT_READY_ERROR };

  try {
    if (input.action === 'navigate') {
      const url = typeof input.args.url === 'string' ? input.args.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, error: 'browser_open: 需要有效的 http(s) URL。' };
      }
      const matching = findRegisteredBrowserWebview(url);
      if (matching) activateBrowserWebview(matching);
      else view.src = url;
      return {
        ok: true,
        resultJson: clampResult({ ok: true, opened: true, url }),
      };
    }
    if (input.action === 'browser_click') {
      const resolved = (await view.executeJavaScript(buildResolveClickScript(input.args))) as {
        found?: boolean;
        clicked?: boolean;
        x?: number;
        y?: number;
        tag?: string;
        text?: string;
        href?: string;
        url?: string;
        reason?: string;
        candidates?: string[];
      };
      const x = Math.round(Number(resolved?.x));
      const y = Math.round(Number(resolved?.y));
      if (!resolved || resolved.found !== true || !Number.isFinite(x) || !Number.isFinite(y)) {
        return {
          ok: false,
          error: resolved?.reason
            ? `browser_click: 没有点到可见元素（${resolved.reason}）。请改用可见文案、更精确的 CSS，或先 browser_read。`
            : 'browser_click: 没有点到可见元素。请改用可见文案、更精确的 CSS，或先 browser_read。',
          resultJson: clampResult(resolved ?? { clicked: false }),
        };
      }
      let trusted = false;
      if (input.sendTrustedClick) {
        try {
          const webContentsId = view.getWebContentsId();
          const sent = await input.sendTrustedClick({ webContentsId, x, y });
          trusted = sent.ok === true;
        } catch {
          trusted = false;
        }
      }
      if (!trusted) {
        await view.executeJavaScript(buildSyntheticClickScript(x, y));
      }
      return {
        ok: true,
        resultJson: clampResult({
          clicked: true,
          trusted,
          tag: resolved.tag,
          text: resolved.text,
          href: resolved.href,
          url: view.getURL() || resolved.url,
        }),
      };
    }
    if (input.action === 'browser_type') {
      const result = await view.executeJavaScript(buildTypeScript(input.args));
      return { ok: true, resultJson: clampResult(result) };
    }
    if (input.action === 'browser_read') {
      const result = await view.executeJavaScript(buildReadScript(input.args));
      return { ok: true, resultJson: clampResult(result) };
    }
    if (input.action === 'browser_screenshot') {
      const root = input.projectFolder?.trim();
      if (!root) {
        return { ok: false, error: '当前对话没有绑定项目文件夹，截图无处保存。请先绑定项目。' };
      }
      if (!input.saveScreenshot) {
        return { ok: false, error: '截图桥不可用（desktop bridge 未注入）。' };
      }
      let webContentsId: number;
      try {
        webContentsId = view.getWebContentsId();
      } catch {
        return { ok: false, error: '截图失败：浏览器页面尚未加载完成，请稍后重试。' };
      }
      // capturePage 与 PNG 落盘都在主进程完成（沙箱渲染层拿不到 NativeImage）。
      const saved = await input.saveScreenshot({ root, webContentsId });
      if (!saved.ok) {
        return { ok: false, error: saved.error || '截图保存失败。' };
      }
      return {
        ok: true,
        resultJson: clampResult({
          path: saved.path,
          relativePath: saved.relativePath,
          embedUrl: saved.embedUrl,
          pageUrl: view.getURL(),
          note: '在 markdown 回复中用 ![说明](embedUrl) 内嵌这张截图。',
        }),
      };
    }
    return { ok: false, error: `未知浏览器命令：${input.action}` };
  } catch (error) {
    return {
      ok: false,
      error: `浏览器命令执行失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The BrowserPanel may be mounted in response to the request event itself. */
async function waitForActiveWebview(timeoutMs = 5_000): Promise<BrowserWebviewElement | null> {
  const deadline = Date.now() + timeoutMs;
  const setTimer =
    typeof globalThis.setTimeout === 'function'
      ? globalThis.setTimeout.bind(globalThis)
      : ((resolve: () => void, delay: number) => setTimeout(resolve, delay));
  while (!activeWebview && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimer(resolve, 50));
  }
  return activeWebview;
}
