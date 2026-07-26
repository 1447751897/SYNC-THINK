// AI 操控内置浏览器：请求-响应桥的桌面端接线测试。
// runtime 发 browser.command_requested → ChatView 执行 → submitBrowserResult 回传。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BROWSER_READ_TEXT_MAX_CHARS,
  BROWSER_RESULT_MAX_CHARS,
  executeBrowserCommand,
  registerBrowserWebview,
  type BrowserWebviewElement,
} from '../src/renderer/shell/browser-commands.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
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
  it('bridges submitBrowserResult and screenshot IPC through main / preload / global.d.ts', () => {
    expect(mainSource).toContain("ipcMain.handle('runtime:conversation-submit-browser-result'");
    expect(mainSource).toContain("'conversation.submitBrowserResult'");
    expect(mainSource).toContain("ipcMain.handle('desktop:save-browser-screenshot'");
    expect(mainSource).toContain("'.sync-think', 'screenshots'");
    expect(preloadSource).toContain('submitBrowserResult:');
    expect(preloadSource).toContain("'runtime:conversation-submit-browser-result'");
    expect(preloadSource).toContain('saveBrowserScreenshot:');
    expect(preloadSource).toContain("'desktop:save-browser-screenshot'");
    expect(globalSource).toContain('submitBrowserResult(');
    expect(globalSource).toContain('saveBrowserScreenshot(');
  });

  it('screenshot IPC only captures webview guests and serves PNGs via sync-think-image', () => {
    // Only <webview> guests with http(s) URLs may be captured (no arbitrary ids).
    expect(mainSource).toContain("guest.getType() !== 'webview'");
    // Screenshot protocol host restricted to .sync-think/screenshots/ PNGs.
    expect(mainSource).toContain("url.hostname === 'screenshot'");
    expect(mainSource).toContain("'/.sync-think/screenshots/'");
    // Markdown renderer allows the protocol for ![](embedUrl) embedding.
    expect(markdownSource).toContain("sync-think-image://");
    expect(markdownSource).toContain('defaultUrlTransform');
  });

  it('ChatView listens for browser.command_requested and replies via submitBrowserResult', () => {
    expect(chatViewSource).toContain("'browser.command_requested'");
    expect(chatViewSource).toContain('executeBrowserCommand');
    expect(chatViewSource).toContain('submitBrowserResult');
    // History replay must not re-run stale commands (runtime side already timed out).
    expect(chatViewSource).toContain('browserCommandPrimedRef');
  });

  it('BrowserPanel registers its webview for AI commands and unregisters on unmount', () => {
    expect(browserPanelSource).toContain('registerBrowserWebview(');
    expect(browserPanelSource).toContain('registerBrowserWebview(null)');
  });
});

describe('executeBrowserCommand', () => {
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
      expect(executed[1]).toContain('querySelector');
      await executeBrowserCommand({ action: 'browser_click', args: { x: 5, y: 6 } });
      expect(executed[2]).toContain('elementFromPoint');

      await executeBrowserCommand({
        action: 'browser_type',
        args: { selector: 'input', text: 'hi' },
      });
      // React controlled inputs need the native value setter + input event.
      expect(executed[3]).toContain('getOwnPropertyDescriptor');
      expect(executed[3]).toContain("new Event('input'");
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
