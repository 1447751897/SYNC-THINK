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
}

// BrowserPanel 挂载时注册自己的 webview；卸载（右栏关闭）时注销。
let activeWebview: BrowserWebviewElement | null = null;

export function registerBrowserWebview(view: BrowserWebviewElement | null): void {
  activeWebview = view;
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

/** 点击脚本：selector 优先；无 selector 时用 elementFromPoint(x, y)。 */
function buildClickScript(args: Record<string, unknown>): string {
  const selector = typeof args.selector === 'string' ? args.selector : '';
  const x = typeof args.x === 'number' ? Math.round(args.x) : -1;
  const y = typeof args.y === 'number' ? Math.round(args.y) : -1;
  return `(() => {
    const sel = ${JSON.stringify(selector)};
    let el = null;
    if (sel) el = document.querySelector(sel);
    else el = document.elementFromPoint(${x}, ${y});
    if (!el) {
      return { clicked: false, reason: sel ? 'no element matches selector' : 'no element at coordinates', url: location.href };
    }
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    const rect = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    if (typeof el.click === 'function') el.click();
    else el.dispatchEvent(new MouseEvent('click', opts));
    return {
      clicked: true,
      tag: el.tagName.toLowerCase(),
      text: String(el.innerText || el.value || '').trim().slice(0, 120),
      url: location.href,
    };
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
    const fullText = String(target.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    const links = Array.from(document.querySelectorAll('a[href]')).slice(0, 40)
      .map((a) => ({ text: String(a.innerText || '').trim().slice(0, 80), href: a.href }))
      .filter((l) => l.text);
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'))
      .slice(0, 40)
      .map((b) => String(b.innerText || b.value || b.getAttribute('aria-label') || '').trim().slice(0, 80))
      .filter(Boolean);
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
}

/**
 * 在当前注册的 webview 上执行一条 AI 浏览器命令。
 * 永不 throw——所有失败都折叠为 { ok:false, error } 回传给工具循环。
 */
export async function executeBrowserCommand(
  input: ExecuteBrowserCommandInput,
): Promise<BrowserCommandOutcome> {
  const view = activeWebview;
  if (!view) return { ok: false, error: PANEL_NOT_READY_ERROR };

  try {
    if (input.action === 'browser_click') {
      const result = await view.executeJavaScript(buildClickScript(input.args));
      return { ok: true, resultJson: clampResult(result) };
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
