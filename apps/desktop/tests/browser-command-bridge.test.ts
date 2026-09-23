// AI 操控内置浏览器：请求-响应桥的桌面端接线测试。
// runtime 发 browser.command_requested → ChatView 执行 → submitBrowserResult 回传。
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  activateBrowserWebview,
  BROWSER_READ_TEXT_MAX_CHARS,
  BROWSER_RESULT_MAX_CHARS,
  executeBrowserCommand,
  getActiveBrowserWebview,
  navigateOwnedBrowserWebview,
  registerBrowserWebview,
  unregisterBrowserWebview,
  type BrowserWebviewElement,
} from '../src/renderer/shell/browser-commands.js';

const mainSource = [
  'index.ts',
  'conversation-query-handlers.ts',
  'conversation-transient-handlers.ts',
  'conversation-browser-handlers.ts',
]
  .map((file) => readFileSync(new URL(`../src/main/${file}`, import.meta.url), 'utf8'))
  .join('\n');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');
const chatViewSource = readFileSync(
  new URL('../src/renderer/shell/ChatView.tsx', import.meta.url),
  'utf8',
);
const browserPanelSource = readFileSync(
  new URL('../src/renderer/shell/BrowserPanel.tsx', import.meta.url),
  'utf8',
);
const markdownSource = readFileSync(
  new URL('../src/renderer/shell/MarkdownContent.tsx', import.meta.url),
  'utf8',
);

function fakeWebview(overrides: Partial<BrowserWebviewElement> = {}): BrowserWebviewElement {
  return {
    getURL: () => 'https://example.com/',
    executeJavaScript: async () => ({ found: true }),
    getWebContentsId: () => 42,
    ...overrides,
  } as unknown as BrowserWebviewElement;
}

describe('browser command bridge wiring', () => {
  it('bridges listConversationMessages through main / preload / global.d.ts', () => {
    expect(mainSource).toContain("'runtime:conversation-list-messages'");
    expect(mainSource).toContain("'conversation.listMessages'");
    expect(preloadSource).toContain('listConversationMessages:');
    expect(preloadSource).toContain("'runtime:conversation-list-messages'");
    expect(globalSource).toContain('listConversationMessages(');
  });

  it('bridges getConversationContextStatus through main / preload / global.d.ts', () => {
    expect(mainSource).toContain("'runtime:conversation-get-context-status'");
    expect(mainSource).toContain("'conversation.getContextStatus'");
    expect(preloadSource).toContain('getConversationContextStatus:');
    expect(preloadSource).toContain("'runtime:conversation-get-context-status'");
    expect(globalSource).toContain('getConversationContextStatus(');
  });

  it('bridges getConversationRunProcess through main / preload / global.d.ts', () => {
    expect(mainSource).toContain("'runtime:conversation-get-run-process'");
    expect(mainSource).toContain("'conversation.getRunProcess'");
    expect(preloadSource).toContain('getConversationRunProcess:');
    expect(preloadSource).toContain("'runtime:conversation-get-run-process'");
    expect(globalSource).toContain('getConversationRunProcess(');
  });

  it('bridges conversation transient subscriptions through main / preload / global.d.ts', () => {
    expect(mainSource).toContain("'runtime:conversation-subscribe-transient'");
    expect(mainSource).toContain('getRuntimeSession().subscribeConversationTransientStream(input)');
    expect(mainSource).toContain("'runtime:conversation-transient'");
    expect(preloadSource).toContain('subscribeConversationTransientStream:');
    expect(preloadSource).toContain("'runtime:conversation-subscribe-transient'");
    expect(preloadSource).toContain("'runtime:conversation-unsubscribe-transient'");
    expect(globalSource).toContain('subscribeConversationTransientStream(');
  });

  it('bridges submitBrowserResult and screenshot IPC through main / preload / global.d.ts', () => {
    expect(mainSource).toContain("'runtime:conversation-submit-browser-result'");
    expect(mainSource).toContain("'conversation.submitBrowserResult'");
    expect(mainSource).toContain("ipcMain.handle('desktop:save-browser-screenshot'");
    expect(mainSource).toContain("'.sync-think', 'screenshots'");
    expect(preloadSource).toContain('submitBrowserResult:');
    expect(preloadSource).toContain("'runtime:conversation-submit-browser-result'");
    expect(preloadSource).toContain('saveBrowserScreenshot:');
    expect(preloadSource).toContain("'desktop:save-browser-screenshot'");
    expect(mainSource).toContain("ipcMain.handle('desktop:browser-trusted-click'");
    expect(mainSource).toContain('sendInputEvent');
    expect(preloadSource).toContain('sendBrowserTrustedClick:');
    expect(preloadSource).toContain("'desktop:browser-trusted-click'");
    expect(globalSource).toContain('submitBrowserResult(');
    expect(globalSource).toContain('saveBrowserScreenshot(');
    expect(globalSource).toContain('sendBrowserTrustedClick(');
  });

  it('screenshot IPC only captures webview guests and serves PNGs via sync-think-image', () => {
    // Only <webview> guests with http(s) URLs may be captured (no arbitrary ids).
    expect(mainSource).toContain("guest.getType() !== 'webview'");
    // Screenshot protocol host restricted to .sync-think/screenshots/ PNGs.
    expect(mainSource).toContain("url.hostname === 'screenshot'");
    expect(mainSource).toContain("'/.sync-think/screenshots/'");
    // Markdown renderer allows the protocol for ![](embedUrl) embedding.
    expect(markdownSource).toContain('sync-think-image://');
    expect(markdownSource).toContain('defaultUrlTransform');
  });

  it('executes live browser commands in the persistent shell, not chat history', () => {
    const shell = readFileSync(
      new URL('../src/renderer/shell/ShellApp.tsx', import.meta.url),
      'utf8',
    );
    expect(shell).toContain('createBrowserCommandDispatcher');
    expect(shell).toContain('dispatchBrowserCommand(event)');
    expect(chatViewSource).not.toContain('executeBrowserCommand');
  });

  it('BrowserPanel registers its webview for AI commands and unregisters on unmount', () => {
    expect(browserPanelSource).toContain('registerBrowserWebview(');
    expect(browserPanelSource).toContain('unregisterBrowserWebview(');
  });
});

describe('executeBrowserCommand', () => {
  it('reuses the task guest for navigation so its cookie partition is preserved', async () => {
    const view = fakeWebview({ src: 'https://example.com/index' });
    view.getURL = () => view.src;
    registerBrowserWebview(view);
    try {
      await executeBrowserCommand({ action: 'browser_read', args: {}, ownerId: 'signed-in-task' });
      expect(navigateOwnedBrowserWebview('signed-in-task', 'https://example.com/checkin')).toBe(
        true,
      );
      const opened = await executeBrowserCommand({
        action: 'browser_open',
        args: { url: 'https://example.com/checkin' },
        ownerId: 'signed-in-task',
      });
      expect(opened.ok).toBe(true);
      expect(getActiveBrowserWebview()).toBe(view);
      expect(JSON.parse(opened.resultJson!).url).toBe('https://example.com/checkin');
    } finally {
      registerBrowserWebview(null);
    }
  });

  it('keeps commands on the explicitly active webview across multi-pane cleanup', () => {
    const first = fakeWebview({ getURL: () => 'https://first.test/' });
    const second = fakeWebview({ getURL: () => 'https://second.test/' });
    registerBrowserWebview(first);
    registerBrowserWebview(second, false);
    expect(getActiveBrowserWebview()).toBe(first);

    activateBrowserWebview(second);
    expect(getActiveBrowserWebview()).toBe(second);
    unregisterBrowserWebview(first);
    expect(getActiveBrowserWebview()).toBe(second);

    unregisterBrowserWebview(second);
    expect(getActiveBrowserWebview()).toBeNull();
  });

  it('waits for the requested guest instead of reporting success on the old page', async () => {
    vi.useFakeTimers();
    const github = fakeWebview({
      src: 'https://github.com/sync-think',
      getURL: () => 'https://github.com/sync-think',
    });
    registerBrowserWebview(github, true, 'https://github.com/sync-think');
    let loaded = false;
    const target = fakeWebview({
      getURL: () => (loaded ? 'https://example.com/game' : 'about:blank'),
      isLoading: () => !loaded,
    });
    try {
      let completed = false;
      const opening = executeBrowserCommand({
        action: 'browser_open',
        args: { url: 'https://example.com/game' },
        ownerId: 'task-a',
      }).then((result) => {
        completed = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(completed).toBe(false);
      registerBrowserWebview(target, false, 'https://example.com/game');
      await vi.advanceTimersByTimeAsync(100);
      expect(completed).toBe(false);
      loaded = true;
      await vi.advanceTimersByTimeAsync(50);
      expect((await opening).ok).toBe(true);
      expect(github.src).toBe('https://github.com/sync-think');
      expect(getActiveBrowserWebview()).toBe(target);
      activateBrowserWebview(github);
      target.executeJavaScript = vi.fn(async () => ({ url: 'https://example.com/game' }));
      await executeBrowserCommand({ action: 'browser_read', args: {}, ownerId: 'task-a' });
      expect(target.executeJavaScript).toHaveBeenCalledOnce();
      unregisterBrowserWebview(target);
      expect(
        (await executeBrowserCommand({ action: 'browser_read', args: {}, ownerId: 'task-a' })).ok,
      ).toBe(false);
    } finally {
      registerBrowserWebview(null);
      vi.useRealTimers();
    }
  });

  it('reports a missing target rather than claiming browser_open succeeded', async () => {
    vi.useFakeTimers();
    try {
      const opening = executeBrowserCommand({
        action: 'browser_open',
        args: { url: 'https://missing.test/' },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect((await opening).ok).toBe(false);
    } finally {
      registerBrowserWebview(null);
      vi.useRealTimers();
    }
  });

  it('bridges the readonly history navigation directory through main, preload and renderer types', () => {
    expect(mainSource).toContain("'runtime:conversation-list-navigation'");
    expect(mainSource).toContain("'conversation.listNavigation'");
    expect(preloadSource).toContain('listConversationNavigation:');
    expect(preloadSource).toContain("'runtime:conversation-list-navigation'");
    expect(globalSource).toContain('listConversationNavigation(');
  });

  it('fails with a recovery hint when no webview is registered', async () => {
    registerBrowserWebview(null);
    const outcome = await executeBrowserCommand({ action: 'browser_read', args: {} });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('browser_open');
  });

  it('runs read / click / type scripts inside the guest page and returns JSON', async () => {
    const executed: string[] = [];
    registerBrowserWebview(
      fakeWebview({
        executeJavaScript: async (code: string) => {
          executed.push(code);
          if (code.includes('clickableNodes') || code.includes('no visible element matches')) {
            return {
              found: true,
              x: 8,
              y: 9,
              tag: 'a',
              text: 'Go',
              url: 'https://example.com/',
            };
          }
          return { found: true, title: 'Example', url: 'https://example.com/' };
        },
      }),
    );
    try {
      const read = await executeBrowserCommand({
        action: 'browser_read',
        args: { selector: 'main' },
      });
      expect(read.ok).toBe(true);
      expect(JSON.parse(read.resultJson ?? '{}').title).toBe('Example');
      // Read script truncates page text to ~8KB inside the guest.
      expect(executed[0]).toContain(String(BROWSER_READ_TEXT_MAX_CHARS));

      await executeBrowserCommand({ action: 'browser_click', args: { selector: '#go' } });
      expect(
        executed.some((code) => code.includes('querySelectorAll') && code.includes('#go')),
      ).toBe(true);
      await executeBrowserCommand({ action: 'browser_click', args: { x: 5, y: 6 } });
      expect(executed.some((code) => code.includes('elementFromPoint'))).toBe(true);

      await executeBrowserCommand({
        action: 'browser_type',
        args: { selector: 'input', text: 'hi' },
      });
      // React controlled inputs need the native value setter + input event.
      const typeScript = executed.find((code) => code.includes('getOwnPropertyDescriptor'));
      expect(typeScript).toContain("new Event('input'");
    } finally {
      registerBrowserWebview(null);
    }
  });

  it('clamps oversized guest results to the 64KB JSON cap', async () => {
    registerBrowserWebview(
      fakeWebview({
        executeJavaScript: async () => ({ text: 'x'.repeat(BROWSER_RESULT_MAX_CHARS * 2) }),
      }),
    );
    try {
      const outcome = await executeBrowserCommand({ action: 'browser_read', args: {} });
      expect(outcome.ok).toBe(true);
      expect((outcome.resultJson ?? '').length).toBeLessThanOrEqual(BROWSER_RESULT_MAX_CHARS);
      expect(JSON.parse(outcome.resultJson ?? '{}').truncated).toBe(true);
    } finally {
      registerBrowserWebview(null);
    }
  });

  it('screenshot requires a bound project folder and routes through the main-process bridge', async () => {
    registerBrowserWebview(fakeWebview());
    try {
      const noFolder = await executeBrowserCommand({ action: 'browser_screenshot', args: {} });
      expect(noFolder.ok).toBe(false);
      expect(noFolder.error).toContain('项目文件夹');

      const calls: Array<{ root: string; webContentsId: number }> = [];
      const saved = await executeBrowserCommand({
        action: 'browser_screenshot',
        args: {},
        projectFolder: 'D:/demo/project',
        saveScreenshot: async (payload) => {
          calls.push(payload);
          return {
            ok: true,
            path: 'D:/demo/project/.sync-think/screenshots/browser-x.png',
            relativePath: '.sync-think/screenshots/browser-x.png',
            embedUrl: 'sync-think-image://screenshot/abc',
          };
        },
      });
      expect(saved.ok).toBe(true);
      expect(calls[0]).toEqual({ root: 'D:/demo/project', webContentsId: 42 });
      const result = JSON.parse(saved.resultJson ?? '{}');
      expect(result.embedUrl).toBe('sync-think-image://screenshot/abc');
      expect(result.note).toContain('![');
    } finally {
      registerBrowserWebview(null);
    }
  });

  it('turns Playwright :has-text locators into visible text matches and reports misses', async () => {
    const executed: string[] = [];
    registerBrowserWebview(
      fakeWebview({
        executeJavaScript: async (code: string) => {
          executed.push(code);
          return {
            found: false,
            reason: 'no visible element matches selector and text',
            candidates: ['造梦西游'],
            url: 'https://www.4399.com/',
          };
        },
      }),
    );
    try {
      const outcome = await executeBrowserCommand({
        action: 'browser_click',
        args: { selector: 'a:has-text("造梦西游online")' },
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('没有点到可见元素');
      expect(executed[0]).toContain('造梦西游online');
      expect(executed[0]).not.toContain(':has-text');
      expect(JSON.parse(outcome.resultJson ?? '{}').candidates).toEqual(['造梦西游']);
    } finally {
      registerBrowserWebview(null);
    }
  });

  it('uses a trusted main-process click when the guest reports coordinates', async () => {
    const clicks: Array<{ webContentsId: number; x: number; y: number }> = [];
    registerBrowserWebview(
      fakeWebview({
        executeJavaScript: async () => ({
          found: true,
          x: 24,
          y: 48,
          tag: 'a',
          text: '造梦西游online',
          href: 'https://www.4399.com/flash/123.htm',
          url: 'https://www.4399.com/',
        }),
      }),
    );
    try {
      const outcome = await executeBrowserCommand({
        action: 'browser_click',
        args: { text: '造梦西游online' },
        sendTrustedClick: async (payload) => {
          clicks.push(payload);
          return { ok: true };
        },
      });
      expect(outcome.ok).toBe(true);
      expect(clicks).toEqual([{ webContentsId: 42, x: 24, y: 48 }]);
      expect(JSON.parse(outcome.resultJson ?? '{}')).toMatchObject({
        clicked: true,
        trusted: true,
        href: 'https://www.4399.com/flash/123.htm',
      });
    } finally {
      registerBrowserWebview(null);
    }
  });

  it('folds guest execution failures into ok:false instead of throwing', async () => {
    registerBrowserWebview(
      fakeWebview({
        executeJavaScript: async () => {
          throw new Error('Script failed to execute');
        },
      }),
    );
    try {
      const outcome = await executeBrowserCommand({
        action: 'browser_click',
        args: { selector: '#x' },
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).toContain('Script failed to execute');
    } finally {
      registerBrowserWebview(null);
    }
  });
});
