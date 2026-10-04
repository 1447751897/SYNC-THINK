// AI 操控内置浏览器：渲染层执行器。
// Runtime 发出 browser.command_requested（带 requestId）→ ChatView 调用这里，
// 在 BrowserPanel 注册的 <webview> 上执行 executeJavaScript / capturePage，
// 结果经 conversation.submitBrowserResult 回传给等待中的工具循环。
// 安全边界：脚本只在 guest 页执行；回传值 JSON 序列化并截断（64KB 上限）。

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
  isLoading?(): boolean;
}

// Multiple browser panes may stay mounted at once. Keep every live instance and
// route commands to the pane that is focused or was interacted with most recently.
const registeredWebviews: BrowserWebviewElement[] = [];
const intendedUrls = new WeakMap<BrowserWebviewElement, string>();
const pendingNavigations = new WeakMap<BrowserWebviewElement, string>();
let activeWebview: BrowserWebviewElement | null = null;
let viewOwners = new WeakMap<BrowserWebviewElement, string>();
const ownerWebviews = new Map<string, WeakRef<BrowserWebviewElement> | null>();

function bindOwner(ownerId: string, view: BrowserWebviewElement | null): void {
  if (view) viewOwners.set(view, ownerId);
  ownerWebviews.set(ownerId, view ? new WeakRef(view) : null);
  if (ownerWebviews.size > 256) ownerWebviews.delete(ownerWebviews.keys().next().value!);
}

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
  ownerId?: string,
): void {
  if (!view) {
    registeredWebviews.splice(0, registeredWebviews.length);
    activeWebview = null;
    ownerWebviews.clear();
    viewOwners = new WeakMap();
    return;
  }
  if (!registeredWebviews.includes(view)) registeredWebviews.push(view);
  if (intendedUrl) intendedUrls.set(view, intendedUrl);
  if (ownerId) {
    viewOwners.set(view, ownerId);
    const previous = ownerWebviews.get(ownerId)?.deref();
    if (activate || !previous || !registeredWebviews.includes(previous)) bindOwner(ownerId, view);
  }
  if (activate || !activeWebview) activeWebview = view;
}

function ownedByAnotherConversation(view: BrowserWebviewElement, ownerId?: string): boolean {
  const owner = viewOwners.get(view);
  return !!ownerId && !!owner && owner !== ownerId;
}

export function findRegisteredBrowserWebview(url: string, ownerId?: string): BrowserWebviewElement | null {
  return (
    registeredWebviews.find(
      (view) =>
        !ownedByAnotherConversation(view, ownerId) &&
        (guestUrlsMatch(intendedUrls.get(view), url) || guestUrlsMatch(currentGuestUrl(view), url)),
    ) ?? null
  );
}

export function activateBrowserWebview(view: BrowserWebviewElement | null): void {
  if (!view) return;
  if (!registeredWebviews.includes(view)) registeredWebviews.push(view);
  const owner = viewOwners.get(view);
  if (owner) bindOwner(owner, view);
  activeWebview = view;
}

export function unregisterBrowserWebview(view: BrowserWebviewElement | null): void {
  if (!view) return;
  const index = registeredWebviews.indexOf(view);
  if (index >= 0) registeredWebviews.splice(index, 1);
  if (activeWebview === view) activeWebview = registeredWebviews.at(-1) ?? null;
}

export function getOwnedBrowserWebview(ownerId: string): BrowserWebviewElement | undefined {
  const view = ownerWebviews.get(ownerId)?.deref();
  return view && registeredWebviews.includes(view) && viewOwners.get(view) === ownerId ? view : undefined;
}

export function getActiveBrowserWebview(): BrowserWebviewElement | null {
  return activeWebview;
}

/** Navigate the task's existing guest so cookies survive same-task navigation. */
export function navigateOwnedBrowserWebview(ownerId: string, url: string): boolean {
  const view = getOwnedBrowserWebview(ownerId);
  if (!view || !/^https?:\/\//i.test(url)) return false;
  const sameTarget = guestUrlsMatch(currentGuestUrl(view), url) || guestUrlsMatch(intendedUrls.get(view), url);
  intendedUrls.set(view, url);
  if (!sameTarget) {
    pendingNavigations.set(view, currentGuestUrl(view));
    view.src = url;
  }
  activateBrowserWebview(view);
  return true;
}

export interface BrowserCommandOutcome {
  ok: boolean;
  resultJson?: string;
  error?: string;
}

const PANEL_NOT_READY_ERROR =
  '内置浏览器面板未打开或页面未就绪。请先调用 browser_open 打开目标页面（会自动弹出右栏），等待加载后再操作。';

const failureMessages: Record<string, string> = {
  'invalid-selector': '选择器语法不受支持，请使用 browser_read 返回的 controls.selector 或可见文字重新定位。',
  'ambiguous-target': '匹配到多个目标，尚未点击。请使用 browser_read 返回的唯一选择器。',
  'disabled-target': '目标当前不可点击，尚未发送点击。请检查输入校验或加载状态。',
  'target-not-found': '当前页面没有匹配到目标，请重新读取页面后定位。',
  'occluded-target': '目标被遮挡或已移动，尚未点击。请读取当前页面后重试。',
  'page-not-ready': PANEL_NOT_READY_ERROR,
  'trusted-click-failed': '可信点击发送失败，未重复发送模拟点击。请重新读取页面状态。',
  'input-target-invalid': '输入目标不是可编辑字段，未写入内容。',
};
function browserCommandFailure(reason: string, error = failureMessages[reason] ?? failureMessages['target-not-found']!): BrowserCommandOutcome {
  const code = Object.hasOwn(failureMessages, reason) ? `browser.${reason}` : 'browser.target-not-found';
  return { ok: false, error, resultJson: JSON.stringify({ ok: false, code }) };
}

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

export interface ExecuteBrowserCommandInput {
  action: string;
  args: Record<string, unknown>;
  ownerId?: string;
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
    const owned = input.ownerId ? ownerWebviews.get(input.ownerId)?.deref() : undefined;
    const matching = await waitForBrowserPage(
      url,
      owned && registeredWebviews.includes(owned) ? owned : undefined,
      input.ownerId,
    );
    if (!matching)
      return { ok: false, error: 'browser_open: 目标页面尚未就绪，请检查浏览器标签页后重试。' };
    activateBrowserWebview(matching);
    if (input.ownerId) bindOwner(input.ownerId, matching);
    return {
      ok: true,
      resultJson: clampResult({ ok: true, opened: true, url: currentGuestUrl(matching) }),
    };
  }

  const view =
    input.ownerId && ownerWebviews.has(input.ownerId)
      ? ownerWebviews.get(input.ownerId)?.deref()
      : await waitForActiveWebview();
  if (!view || !registeredWebviews.includes(view) || ownedByAnotherConversation(view, input.ownerId))
    return browserCommandFailure('page-not-ready', PANEL_NOT_READY_ERROR);
  if (input.ownerId) bindOwner(input.ownerId, view);

  try {
    const { buildResolveClickScript, buildSyntheticClickScript, buildTypeScript, buildReadScript } = await import('./browser-command-scripts.js');
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
        return browserCommandFailure(resolved?.reason ?? 'target-not-found');
      }
      let trusted = false;
      if (input.sendTrustedClick) {
        try {
          const webContentsId = view.getWebContentsId();
          const sent = await input.sendTrustedClick({ webContentsId, x, y });
          if (!sent.ok) return browserCommandFailure('trusted-click-failed');
          trusted = true;
        } catch {
          return browserCommandFailure('trusted-click-failed');
        }
      }
      if (!trusted) {
        const clicked = await view.executeJavaScript(buildSyntheticClickScript(x, y)) as { clicked?: boolean };
        if (!clicked?.clicked) return browserCommandFailure('occluded-target');
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
      const result = await view.executeJavaScript(buildTypeScript(input.args)) as { typed?: boolean; reason?: string };
      if (!result?.typed) return browserCommandFailure(result?.reason && Object.hasOwn(failureMessages, result.reason) ? result.reason : 'input-target-invalid');
      return { ok: true, resultJson: clampResult(result) };
    }
    if (input.action === 'browser_read') {
      const result = await view.executeJavaScript(buildReadScript(input.args)) as { found?: boolean; reason?: string };
      if (!result?.found) return browserCommandFailure(result?.reason ?? 'target-not-found');
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

/** Do not report navigation success until the requested guest has actually loaded. */
async function waitForBrowserPage(
  url: string,
  owned?: BrowserWebviewElement,
  ownerId?: string,
  timeoutMs = 10_000,
): Promise<BrowserWebviewElement | null> {
  const deadline = Date.now() + timeoutMs;
  const loading = new WeakSet<BrowserWebviewElement>();
  while (Date.now() < deadline) {
    const view = (ownerId ? getOwnedBrowserWebview(ownerId) : undefined) ?? owned ?? findRegisteredBrowserWebview(url, ownerId);
    if (view) {
      try {
        const isLoading = view.isLoading?.() ?? false;
        if (isLoading) loading.add(view);
        const actual = currentGuestUrl(view);
        if (
          !isLoading &&
          /^https?:\/\//i.test(actual) &&
          (!pendingNavigations.has(view) || !guestUrlsMatch(actual, pendingNavigations.get(view)!) || loading.has(view)) &&
          (guestUrlsMatch(actual, url) || guestUrlsMatch(intendedUrls.get(view), url) || loading.has(view))
        ) {
          pendingNavigations.delete(view);
          return view;
        }
      } catch {
        /* guest is attaching */
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

/** The BrowserPanel may be mounted in response to the request event itself. */
async function waitForActiveWebview(timeoutMs = 5_000): Promise<BrowserWebviewElement | null> {
  const deadline = Date.now() + timeoutMs;
  const setTimer =
    typeof globalThis.setTimeout === 'function'
      ? globalThis.setTimeout.bind(globalThis)
      : (resolve: () => void, delay: number) => setTimeout(resolve, delay);
  while (!activeWebview && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimer(resolve, 50));
  }
  return activeWebview;
}
