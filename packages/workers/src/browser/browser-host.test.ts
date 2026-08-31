import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserHost,
  BrowserHostError,
  PlaywrightDriverPage,
  browserRecordingInstallScript,
  buildBrowserProfileOriginInventory,
  clearBrowserProfileSiteData,
  discoverSystemBrowser,
  inspectBrowserProfileSiteData,
  projectBrowserRecordingDomEvent,
  resolveBrowserProfileDirectory,
  resolveBrowserSiteKey,
  resolveBrowserScreenshotPath,
  sanitizeBrowserRecordingUrl,
  withProfilePageCdpSession,
  type BrowserAction,
  type BrowserDriverPage,
  type BrowserDriverSession,
  type BrowserPageExecutionOptions,
  type BrowserPageExecutionResult,
  type BrowserSessionFactory,
  type BrowserRecordingMutation,
  type BrowserPageRecordingOptions,
} from './browser-host.js';

describe('Profile Page CDP session', () => {
  it('uses an existing Page target for Storage commands', async () => {
    const page = { isClosed: () => false, close: vi.fn(async () => undefined) };
    const send = vi.fn(async () => ({ usage: 0 }));
    const detach = vi.fn(async () => undefined);
    const session = { send, detach };
    const context = {
      pages: () => [page],
      newPage: vi.fn(async () => page),
      newCDPSession: vi.fn(async () => session),
    };

    await expect(
      withProfilePageCdpSession(context as never, async (cdp) =>
        cdp.send('Storage.clearDataForOrigin', {
          origin: 'https://example.com',
          storageTypes: 'all',
        }),
      ),
    ).resolves.toEqual({ usage: 0 });
    expect(context.newCDPSession).toHaveBeenCalledWith(page);
    expect(context.newPage).not.toHaveBeenCalled();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(page.close).not.toHaveBeenCalled();
  });

  it('closes a temporary Page target after the Storage command', async () => {
    const page = { isClosed: () => false, close: vi.fn(async () => undefined) };
    const detach = vi.fn(async () => undefined);
    const context = {
      pages: () => [],
      newPage: vi.fn(async () => page),
      newCDPSession: vi.fn(async () => ({ send: vi.fn(), detach })),
    };

    await withProfilePageCdpSession(context as never, async () => undefined);
    expect(context.newPage).toHaveBeenCalledTimes(1);
    expect(context.newCDPSession).toHaveBeenCalledWith(page);
    expect(detach).toHaveBeenCalledTimes(1);
    expect(page.close).toHaveBeenCalledTimes(1);
  });

  it('closes a temporary Page when creating its CDP session fails', async () => {
    const page = { isClosed: () => false, close: vi.fn(async () => undefined) };
    const context = {
      pages: () => [],
      newPage: vi.fn(async () => page),
      newCDPSession: vi.fn(async () => {
        throw new Error('CDP target unavailable');
      }),
    };

    await expect(
      withProfilePageCdpSession(context as never, async () => undefined),
    ).rejects.toThrow('CDP target unavailable');
    expect(page.close).toHaveBeenCalledTimes(1);
  });
});

describe('Profile site-data origin inventory', () => {
  it('combines known Pages and bounded Cookie-derived origins', () => {
    expect(
      buildBrowserProfileOriginInventory(
        ['https://known.example.test/path'],
        ['https://page.example.test/workflow', 'about:blank'],
        [
          { domain: '.secure.example.test', secure: true },
          { domain: 'plain.example.test', secure: false },
        ],
      ),
    ).toEqual([
      'http://plain.example.test',
      'https://known.example.test',
      'https://page.example.test',
      'https://plain.example.test',
      'https://secure.example.test',
    ]);
  });

  it('rejects an inventory that exceeds the origin query budget', () => {
    const knownOrigins = Array.from(
      { length: 512 },
      (_, index) => `https://origin-${index}.example.test`,
    );
    expect(() =>
      buildBrowserProfileOriginInventory(
        knownOrigins,
        [],
        [{ domain: 'overflow.example.test', secure: true }],
      ),
    ).toThrowError(expect.objectContaining({ code: 'browser.profile-origins-too-many' }));
  });

  it('uses aggregate Page CDP usage and never requests a storage snapshot', async () => {
    const page = {
      isClosed: () => false,
      url: () => 'https://page.example.test/path',
      close: vi.fn(async () => undefined),
      goto: vi.fn(async () => undefined),
    };
    const send = vi.fn(async (method: string, params: { origin?: string }) => {
      if (method === 'Storage.getUsageAndQuota') {
        return {
          usage: params.origin === 'https://known.example.test' ? 2_048 : 0,
          usageBreakdown: [
            {
              storageType: 'indexeddb',
              usage: params.origin === 'https://known.example.test' ? 2_048 : 0,
            },
          ],
        };
      }
      return undefined;
    });
    const storageState = vi.fn(() => {
      throw new Error('storage snapshots must not be requested');
    });
    const context = {
      cookies: vi.fn(async () => [
        {
          name: 'session',
          value: 'secret-value',
          domain: '.example.test',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax' as const,
        },
      ]),
      clearCookies: vi.fn(async () => undefined),
      pages: () => [page],
      newPage: vi.fn(async () => page),
      newCDPSession: vi.fn(async () => ({
        send,
        detach: vi.fn(async () => undefined),
      })),
      storageState,
    };

    const snapshot = await inspectBrowserProfileSiteData(context as never, 'work', [
      'https://known.example.test',
    ]);

    expect(storageState).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('Storage.getUsageAndQuota', {
      origin: 'https://known.example.test',
    });
    expect(snapshot).toMatchObject({
      profileId: 'work',
      sites: [
        {
          siteKey: 'example.test',
          cookieCount: 1,
          storageBytes: 2_048,
          storageTypes: ['cookies', 'indexed_db'],
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret-value');
  });

  it('clears matching cookies and origins through the Page CDP target', async () => {
    const page = {
      isClosed: () => false,
      url: () => 'https://app.example.test/dashboard',
      close: vi.fn(async () => undefined),
      goto: vi.fn(async () => undefined),
    };
    const send = vi.fn(async () => undefined);
    const storageState = vi.fn(() => {
      throw new Error('storage snapshots must not be requested');
    });
    const clearCookies = vi.fn(async () => undefined);
    const context = {
      cookies: vi.fn(async () => [
        {
          name: 'session',
          value: 'secret-value',
          domain: '.example.test',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax' as const,
        },
        {
          name: 'other',
          value: 'other-secret',
          domain: '.other.test',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: 'Lax' as const,
        },
      ]),
      clearCookies,
      pages: () => [page],
      newPage: vi.fn(async () => page),
      newCDPSession: vi.fn(async () => ({
        send,
        detach: vi.fn(async () => undefined),
      })),
      storageState,
    };

    const result = await clearBrowserProfileSiteData(context as never, 'work', 'example.test', [
      'https://app.example.test',
    ]);

    expect(storageState).not.toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith('about:blank', {
      waitUntil: 'commit',
      timeout: 5_000,
    });
    expect(clearCookies).toHaveBeenCalledTimes(1);
    expect(clearCookies).toHaveBeenCalledWith({
      name: 'session',
      domain: '.example.test',
      path: '/',
    });
    expect(send).toHaveBeenCalledWith('Storage.clearDataForOrigin', {
      origin: 'https://app.example.test',
      storageTypes: 'all',
    });
    expect(send).toHaveBeenCalledWith('Storage.clearDataForOrigin', {
      origin: 'https://example.test',
      storageTypes: 'all',
    });
    expect(result).toMatchObject({
      profileId: 'work',
      siteKey: 'example.test',
      deletedCookieCount: 1,
      clearedOrigins: ['https://app.example.test', 'https://example.test'],
    });
  });
});

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    // Node 20 on Windows can leave a directory junction in place while
    // recursively removing its parent, then fail the parent with ENOTEMPTY. A
    // dangling junction is also invisible to Node's lstat/rm, so recreate its
    // fixture target before removing the known Profile reparse point.
    mkdirSync(join(root, 'missing-outside'), { recursive: true });
    rmSync(join(root, 'profiles', 'work'), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function createProfileRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-host-unit-'));
  tempRoots.push(root);
  return join(root, 'profiles');
}

let nextFakePageId = 1;

class FakePage implements BrowserDriverPage {
  readonly pageId: string;
  closed = false;
  currentUrl = 'about:blank';
  recordingOptions?: BrowserPageRecordingOptions;
  readonly closeListeners = new Set<() => void>();
  constructor(pageId = `page-${nextFakePageId++}`) {
    this.pageId = pageId;
  }

  executeImpl: (
    action: BrowserAction,
    options: BrowserPageExecutionOptions,
  ) => Promise<BrowserPageExecutionResult> = async (action) => {
    if (action.kind === 'navigate') this.currentUrl = action.url;
    return { url: this.currentUrl, title: 'Fixture page' };
  };

  isClosed(): boolean {
    return this.closed;
  }

  async execute(
    action: BrowserAction,
    options: BrowserPageExecutionOptions,
  ): Promise<BrowserPageExecutionResult> {
    return this.executeImpl(action, options);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }

  async startRecording(options: BrowserPageRecordingOptions): Promise<void> {
    this.recordingOptions = options;
  }

  async stopRecording(): Promise<void> {
    this.recordingOptions = undefined;
  }

  onClosed(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async emitRecordingMutation(mutation: BrowserRecordingMutation): Promise<void> {
    await this.recordingOptions?.onMutation(mutation);
  }
}

function fakeSessionFactory(state?: {
  launches?: string[];
  pages?: FakePage[];
}): BrowserSessionFactory {
  return async (input) => {
    state?.launches?.push(input.profileId);
    const session: BrowserDriverSession = {
      browserKind: 'edge',
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      profileDirectory: input.profileDirectory,
      cdpEndpoint: 'http://127.0.0.1:43123',
      isConnected: () => true,
      newPage: async () => {
        const page = new FakePage();
        state?.pages?.push(page);
        return page;
      },
      close: vi.fn(async () => undefined),
    };
    return session;
  };
}

describe('system browser discovery and safe output paths', () => {
  it('prefers an explicit executable, then Chrome, then Edge', () => {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const chrome = 'C:/Users/test/AppData/Local/Google/Chrome/Application/chrome.exe';
    const existing = new Set([edge, chrome, 'D:/portable/chrome.exe']);
    const common = {
      platform: 'win32' as const,
      env: {
        'ProgramFiles(x86)': 'C:/Program Files (x86)',
        LOCALAPPDATA: 'C:/Users/test/AppData/Local',
      },
      exists: (candidate: string) => existing.has(candidate.replaceAll('\\', '/')),
    };

    expect(discoverSystemBrowser({ ...common, executablePath: 'D:/portable/chrome.exe' })).toEqual({
      kind: 'chrome',
      executablePath: 'D:/portable/chrome.exe',
    });
    const discoveredChrome = discoverSystemBrowser(common);
    expect(discoveredChrome.kind).toBe('chrome');
    expect(discoveredChrome.executablePath.replaceAll('\\', '/')).toBe(chrome);
    existing.delete(chrome);
    const discoveredEdge = discoverSystemBrowser(common);
    expect(discoveredEdge.kind).toBe('edge');
    expect(discoveredEdge.executablePath.replaceAll('\\', '/')).toBe(edge);
  });

  it('keeps Profile and screenshot paths below their configured roots', () => {
    expect(resolveBrowserProfileDirectory('D:/data/browser-profiles', 'work-account')).toBe(
      join('D:/data/browser-profiles', 'work-account'),
    );
    expect(() => resolveBrowserProfileDirectory('D:/data/browser-profiles', '../escape')).toThrow(
      BrowserHostError,
    );

    const screenshot = resolveBrowserScreenshotPath('D:/project', 'browser-proof.png');
    expect(screenshot.absolutePath).toBe(
      join('D:/project', '.sync-think', 'screenshots', 'browser-proof.png'),
    );
    expect(screenshot.relativePath).toBe('.sync-think/screenshots/browser-proof.png');
    expect(screenshot.embedUrl).toBe(
      `sync-think-image://screenshot/${encodeURIComponent(screenshot.absolutePath)}`,
    );
    expect(() => resolveBrowserScreenshotPath('D:/project', '../escape.png')).toThrow(
      BrowserHostError,
    );
  });

  it('groups hosts by registrable domain while keeping localhost and IP fixtures exact', () => {
    expect(resolveBrowserSiteKey('https://accounts.example.co.uk/login')).toBe('example.co.uk');
    expect(resolveBrowserSiteKey('.sub.example.com')).toBe('example.com');
    expect(resolveBrowserSiteKey('localhost')).toBe('localhost');
    expect(resolveBrowserSiteKey('127.0.0.1')).toBe('127.0.0.1');
    expect(resolveBrowserSiteKey('https://[::1]/')).toBe('::1');
  });
});

describe('BrowserHost Profile sessions and Page leases', () => {
  it('holds an exclusive Profile claim for a recording lease until release', async () => {
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory(),
    });

    const recordingLease = await host.acquireLease({
      profileId: 'work',
      ownerId: 'recording:1',
      mode: 'recording',
    });
    await expect(host.acquireLease({ profileId: 'work', ownerId: 'run:1' })).rejects.toMatchObject({
      code: 'browser.profile-in-use',
    });
    await expect(
      host.acquireLease({ profileId: 'work', ownerId: 'recording:2', mode: 'recording' }),
    ).rejects.toMatchObject({ code: 'browser.profile-in-use' });
    await expect(host.listProfileSiteData({ profileId: 'work' })).rejects.toMatchObject({
      code: 'browser.profile-in-use',
    });

    await host.releaseLease(recordingLease.leaseId);
    await expect(host.acquireLease({ profileId: 'work', ownerId: 'run:1' })).resolves.toMatchObject(
      { profileId: 'work', ownerId: 'run:1' },
    );
    await host.shutdown();
  });

  it('binds recording to the exact Page, streams bounded mutations, and stops intake', async () => {
    const pages: FakePage[] = [];
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory({ pages }),
    });
    const lease = await host.acquireLease({
      profileId: 'work',
      ownerId: 'recording:1',
      mode: 'recording',
    });
    const mutations: BrowserRecordingMutation[] = [];
    const terminated = vi.fn();

    await host.startRecording({
      leaseId: lease.leaseId,
      startUrl: 'https://example.test/start?token=secret#fragment',
      maxSteps: 200,
      onMutation: async (mutation) => mutations.push(mutation),
      onTerminated: terminated,
    });
    expect(pages[0]?.currentUrl).toBe('https://example.test/start');
    await pages[0]?.emitRecordingMutation({
      type: 'append',
      step: {
        kind: 'fill',
        locator: { strategy: 'label', value: 'Search' },
        value: { kind: 'literal', value: 'sync-think' },
      },
    });
    expect(mutations).toEqual([
      expect.objectContaining({ type: 'append', step: expect.objectContaining({ kind: 'fill' }) }),
    ]);

    await host.stopRecording(lease.leaseId);
    await pages[0]?.emitRecordingMutation({
      type: 'append',
      step: { kind: 'navigate', url: 'https://ignored.test/' },
    });
    expect(mutations).toHaveLength(1);
    expect(terminated).not.toHaveBeenCalled();
    await host.releaseLease(lease.leaseId);
    await host.shutdown();
  });

  it('cleans lease ownership and reports interruption when the user closes the recording Page', async () => {
    const pages: FakePage[] = [];
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory({ pages }),
    });
    const lease = await host.acquireLease({
      profileId: 'work',
      ownerId: 'recording:1',
      mode: 'recording',
    });
    const terminated = vi.fn();
    await host.startRecording({
      leaseId: lease.leaseId,
      maxSteps: 200,
      onMutation: vi.fn(),
      onTerminated: terminated,
    });

    await pages[0]!.close();
    await vi.waitFor(() => expect(terminated).toHaveBeenCalledWith('page_closed'));
    expect(host.hasActiveProfileLeases('work')).toBe(false);
    await expect(
      host.acquireLease({ profileId: 'work', ownerId: 'run:after-close' }),
    ).resolves.toMatchObject({ ownerId: 'run:after-close' });
    await host.shutdown();
  });

  it('sanitizes recorded navigation URLs before they leave the Host', () => {
    expect(sanitizeBrowserRecordingUrl('https://user:pass@example.test/path?q=token#secret')).toBe(
      'https://example.test/path',
    );
    expect(() => sanitizeBrowserRecordingUrl('file:///C:/secret.txt')).toThrowError(
      expect.objectContaining({ code: 'browser.recording-url-invalid' }),
    );
  });

  it('keeps recording intake open while Playwright stop flushes the final mutation', async () => {
    const mainFrame = {};
    let captureToken = '';
    let binding: ((source: { frame: object }, payload: unknown) => Promise<void>) | undefined;
    const cdpSession = {
      send: vi.fn(async (method: string) => {
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-1' } } };
        if (method === 'Target.getTargetInfo') {
          return { targetInfo: { targetId: 'page-final-flush' } };
        }
        return {};
      }),
      on: vi.fn(),
      detach: vi.fn(async () => undefined),
    };
    const page = {
      context: () => ({ newCDPSession: vi.fn(async () => cdpSession) }),
      once: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      mainFrame: () => mainFrame,
      isClosed: () => false,
      exposeBinding: vi.fn(
        async (
          _name: string,
          handler: (source: { frame: object }, payload: unknown) => Promise<void>,
        ) => {
          binding = handler;
        },
      ),
      addInitScript: vi.fn(async ({ content }: { content: string }) => {
        const match = content.match(/const recordingToken =\s*("[^"]+")/u);
        captureToken = match ? (JSON.parse(match[1]!) as string) : '';
      }),
      evaluate: vi.fn(async (script: string) => {
        if (!script.startsWith('globalThis.__syncThinkRecorder')) return undefined;
        await binding?.(
          { frame: mainFrame },
          {
            captureToken,
            kind: 'fill',
            locator: { strategy: 'label', value: '备注' },
            value: '停止前最后输入',
          },
        );
        return true;
      }),
    };
    const driver = await PlaywrightDriverPage.create(page as never, vi.fn(), vi.fn(), vi.fn());
    const onMutation = vi.fn(async () => undefined);
    await driver.startRecording({ maxSteps: 200, onMutation, onTerminated: vi.fn() });

    await driver.stopRecording();

    expect(onMutation).toHaveBeenCalledWith({
      type: 'append',
      step: {
        kind: 'fill',
        locator: { strategy: 'label', value: '备注' },
        value: { kind: 'literal', value: '停止前最后输入' },
      },
    });
  });

  it('flushes pending inputs, captures native controls, and authenticates DOM uninstall', async () => {
    type TrustedHandler = (event: {
      isTrusted: boolean;
      key?: string;
      target: FakeElement;
      composedPath(): FakeElement[];
    }) => void;
    class FakeElement {
      readonly labels: Array<{ innerText: string }> = [];
      readonly children: FakeElement[] = [];
      readonly parentElement = null;
      readonly id = '';
      innerText = '';
      textContent = '';
      isContentEditable = false;

      constructor(
        readonly tagName: string,
        readonly attributes: Record<string, string>,
      ) {}

      getAttribute(name: string): string | null {
        return this.attributes[name] ?? null;
      }

      hasAttribute(name: string): boolean {
        return Object.hasOwn(this.attributes, name);
      }

      matches(selector: string): boolean {
        return selector
          .split(',')
          .map((candidate) => candidate.trim())
          .some((candidate) => {
            if (candidate === 'input') return this.tagName === 'INPUT';
            if (candidate === 'textarea') return this.tagName === 'TEXTAREA';
            if (candidate === 'select') return this.tagName === 'SELECT';
            return false;
          });
      }

      closest(selector: string): FakeElement | null {
        if (
          this.tagName === 'INPUT' &&
          selector.includes(`input[type="${this.getAttribute('type')}"]`)
        ) {
          return this;
        }
        return null;
      }
    }
    class FakeInputElement extends FakeElement {
      value = '';
      checked = false;

      get type(): string {
        return this.getAttribute('type') ?? 'text';
      }
    }
    class FakeSelectElement extends FakeElement {
      value = '';
    }

    const textInput = new FakeInputElement('INPUT', {
      'data-testid': 'note-input',
      type: 'text',
    });
    textInput.value = '停止前最后输入';
    const contentEditable = new FakeElement('DIV', {
      'data-testid': 'rich-note',
      contenteditable: '',
    });
    contentEditable.isContentEditable = true;
    contentEditable.textContent = '敏感富文本';
    const submitInput = new FakeInputElement('INPUT', {
      'data-testid': 'native-submit',
      type: 'submit',
    });
    const select = new FakeSelectElement('SELECT', {
      'data-testid': 'plan-select',
    });
    select.value = 'pro';
    const elements = [textInput, contentEditable, submitInput, select];
    const listeners = new Map<string, TrustedHandler>();
    const captured: Array<Record<string, unknown>> = [];
    const document = {
      documentElement: new FakeElement('HTML', {}),
      addEventListener: (name: string, handler: TrustedHandler) => listeners.set(name, handler),
      removeEventListener: (name: string, handler: TrustedHandler) => {
        if (listeners.get(name) === handler) listeners.delete(name);
      },
      querySelectorAll: (selector: string) => {
        const testId = selector.match(/^\[data-testid="([^"]+)"\]$/u)?.[1];
        return testId
          ? elements.filter((element) => element.getAttribute('data-testid') === testId)
          : elements;
      },
    };
    const context = {
      document,
      Element: FakeElement,
      HTMLInputElement: FakeInputElement,
      HTMLSelectElement: FakeSelectElement,
      CSS: { escape: (value: string) => value },
      Map,
      Promise,
      String,
      setTimeout,
      clearTimeout,
      __record: async (payload: Record<string, unknown>) => {
        captured.push(payload);
      },
    } as Record<string, unknown>;
    runInNewContext(browserRecordingInstallScript('__record', 'private-capture-token'), context);
    const recorder = context.__syncThinkRecorder as {
      uninstall(token: string): Promise<boolean>;
    };
    const trustedEvent = (target: FakeElement, key?: string) => ({
      isTrusted: true,
      ...(key ? { key } : {}),
      target,
      composedPath: () => [target],
    });

    await expect(recorder.uninstall('forged')).resolves.toBe(false);
    expect(context.__syncThinkRecorder).toBe(recorder);
    expect(recorder.uninstall.toString()).not.toContain('private-capture-token');

    listeners.get('input')?.(trustedEvent(textInput));
    listeners.get('keydown')?.(trustedEvent(textInput, 'Enter'));
    listeners.get('change')?.(trustedEvent(textInput));
    listeners.get('change')?.(trustedEvent(select));
    listeners.get('click')?.(trustedEvent(submitInput));
    listeners.get('input')?.(trustedEvent(contentEditable));
    await Promise.resolve();

    await expect(recorder.uninstall('private-capture-token')).resolves.toBe(true);
    expect(context.__syncThinkRecorder).toBeUndefined();
    expect(captured.map((payload) => payload.kind)).toEqual([
      'fill',
      'press',
      'select',
      'click',
      'fill',
    ]);
    expect(captured[0]).toMatchObject({
      value: '停止前最后输入',
      sensitive: false,
    });
    expect(captured[2]).toMatchObject({ value: 'pro', sensitive: false });
    expect(captured[4]).toMatchObject({ sensitive: true });
  });

  it('mounts the recording overlay after DOMContentLoaded and stops from its control', async () => {
    type EventHandler = (event?: { preventDefault(): void; stopPropagation(): void }) => void;
    class FakeNode {
      readonly children: FakeNode[] = [];
      readonly style = { cssText: '' };
      readonly attributes = new Map<string, string>();
      readonly listeners = new Map<string, EventHandler>();
      parent?: FakeNode;
      id = '';
      textContent = '';
      type = '';
      disabled = false;
      removed = false;

      constructor(readonly tagName: string) {}

      setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
      }

      append(...nodes: FakeNode[]): void {
        for (const node of nodes) {
          node.parent = this;
          this.children.push(node);
        }
      }

      attachShadow(): FakeNode {
        return this;
      }

      addEventListener(name: string, handler: EventHandler): void {
        this.listeners.set(name, handler);
      }

      remove(): void {
        this.removed = true;
        if (this.parent) {
          this.parent.children.splice(this.parent.children.indexOf(this), 1);
          this.parent = undefined;
        }
      }
    }

    const documentListeners = new Map<string, Set<EventHandler>>();
    const root = new FakeNode('HTML');
    const document = {
      documentElement: null as FakeNode | null,
      createElement: (tagName: string) => new FakeNode(tagName.toUpperCase()),
      createTextNode: (text: string) => {
        const node = new FakeNode('#text');
        node.textContent = text;
        return node;
      },
      addEventListener: (name: string, handler: EventHandler) => {
        const handlers = documentListeners.get(name) ?? new Set<EventHandler>();
        handlers.add(handler);
        documentListeners.set(name, handlers);
      },
      removeEventListener: (name: string, handler: EventHandler) => {
        documentListeners.get(name)?.delete(handler);
      },
      querySelectorAll: () => [],
    };
    const captured: Array<Record<string, unknown>> = [];
    const context = {
      document,
      Element: FakeNode,
      HTMLInputElement: class extends FakeNode {},
      HTMLSelectElement: class extends FakeNode {},
      CSS: { escape: (value: string) => value },
      Map,
      Promise,
      String,
      setTimeout,
      clearTimeout,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      __record: async (payload: Record<string, unknown>) => {
        captured.push(payload);
        return { accepted: true, stepCount: 0 };
      },
    } as Record<string, unknown>;

    runInNewContext(browserRecordingInstallScript('__record', 'overlay-token'), context);
    expect(documentListeners.get('DOMContentLoaded')?.size).toBe(1);
    expect(root.children).toHaveLength(0);

    document.documentElement = root;
    documentListeners.get('DOMContentLoaded')?.forEach((handler) => handler());

    const overlay = root.children.find((node) => node.id === '__sync-think-recording-overlay');
    expect(overlay).toBeTruthy();
    const descendants = (node: FakeNode): FakeNode[] => [
      node,
      ...node.children.flatMap(descendants),
    ];
    const nodes = descendants(overlay!);
    expect(nodes.map((node) => node.textContent).join('')).toContain('SYNC-THINK 录制中');
    expect(nodes.map((node) => node.textContent).join('')).toContain('0 步');
    const stopButton = nodes.find((node) => node.textContent === '结束录制');
    expect(stopButton).toBeTruthy();
    stopButton?.listeners.get('click')?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(captured).toContainEqual({
      kind: 'control-stop',
      captureToken: 'overlay-token',
    });

    const recorder = context.__syncThinkRecorder as {
      uninstall(token: string): Promise<boolean>;
    };
    await expect(recorder.uninstall('overlay-token')).resolves.toBe(true);
    expect(overlay?.removed).toBe(true);
    expect(documentListeners.get('DOMContentLoaded')?.size ?? 0).toBe(0);
  });

  it('rejects forged recording binding payloads without the per-recording capture token', () => {
    const payload = {
      kind: 'fill',
      locator: { strategy: 'label', value: 'Password' },
      value: 'should-not-persist',
    };

    expect(
      projectBrowserRecordingDomEvent({ ...payload, captureToken: 'forged' }, 'expected'),
    ).toBeUndefined();
    expect(
      projectBrowserRecordingDomEvent(
        { ...payload, captureToken: 'expected', sensitive: true },
        'expected',
      ),
    ).toEqual({
      kind: 'fill',
      locator: { strategy: 'label', value: 'Password' },
      value: { kind: 'secret' },
    });
  });

  it('launches one session per Profile and reuses one lease per owner', async () => {
    const state = { launches: [] as string[], pages: [] as FakePage[] };
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory(state),
    });

    const [first, sameOwner, secondOwner] = await Promise.all([
      host.acquireLease({ profileId: 'work', ownerId: 'conversation:1' }),
      host.acquireLease({ profileId: 'work', ownerId: 'conversation:1' }),
      host.acquireLease({ profileId: 'work', ownerId: 'step:2' }),
    ]);

    expect(state.launches).toEqual(['work']);
    expect(state.pages).toHaveLength(2);
    expect(sameOwner.leaseId).toBe(first.leaseId);
    expect(secondOwner.leaseId).not.toBe(first.leaseId);
    expect(secondOwner.pageId).not.toBe(first.pageId);

    await host.shutdown();
  });

  it('queries and clears a Profile site through the driver without returning secret values', async () => {
    const listSiteData = vi.fn(async () => ({
      profileId: 'work',
      checkedAt: '2026-08-05T03:00:00.000Z',
      sites: [
        {
          siteKey: 'example.com',
          origins: ['https://app.example.com'],
          cookieCount: 2,
          storageBytes: 1024,
          storageTypes: ['cookies', 'local_storage'],
        },
      ],
    }));
    const clearSiteData = vi.fn(async () => ({
      profileId: 'work',
      siteKey: 'example.com',
      clearedOrigins: ['https://app.example.com'],
      deletedCookieCount: 2,
      checkedAt: '2026-08-05T03:01:00.000Z',
    }));
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: async (input) => ({
        browserKind: 'edge',
        executablePath: 'edge.exe',
        profileDirectory: input.profileDirectory,
        cdpEndpoint: 'http://127.0.0.1:43123',
        isConnected: () => true,
        newPage: async () => new FakePage(),
        listSiteData,
        clearSiteData,
        close: vi.fn(async () => undefined),
      }),
    });

    await expect(
      host.listProfileSiteData({
        profileId: 'work',
        knownOrigins: ['https://app.example.com'],
      }),
    ).resolves.toMatchObject({ sites: [{ siteKey: 'example.com', cookieCount: 2 }] });
    expect(listSiteData).toHaveBeenCalledWith(['https://app.example.com']);

    const lease = await host.acquireLease({ profileId: 'work', ownerId: 'run:1' });
    await expect(
      host.clearProfileSiteData({ profileId: 'work', siteKey: 'example.com' }),
    ).rejects.toMatchObject({ code: 'browser.profile-in-use' });
    await host.releaseLease(lease.leaseId);
    await expect(
      host.clearProfileSiteData({ profileId: 'work', siteKey: 'example.com' }),
    ).resolves.toMatchObject({ deletedCookieCount: 2 });
    expect(clearSiteData).toHaveBeenCalledWith('example.com', []);
    await host.shutdown();
  });

  it('matches IPv6 origins when clearing a local Profile site', async () => {
    const page = {
      isClosed: () => false,
      url: () => 'http://[::1]/dashboard',
      close: vi.fn(async () => undefined),
      goto: vi.fn(async () => undefined),
    };
    const send = vi.fn(async () => undefined);
    const clearCookies = vi.fn(async () => undefined);
    const context = {
      cookies: vi.fn(async () => [
        {
          name: 'session',
          value: 'secret-value',
          domain: '::1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax' as const,
        },
      ]),
      clearCookies,
      pages: () => [page],
      newPage: vi.fn(async () => page),
      newCDPSession: vi.fn(async () => ({
        send,
        detach: vi.fn(async () => undefined),
      })),
    };

    await expect(
      clearBrowserProfileSiteData(context as never, 'work', '::1', []),
    ).resolves.toMatchObject({
      siteKey: '::1',
      deletedCookieCount: 1,
      clearedOrigins: ['http://[::1]', 'https://[::1]'],
    });
    expect(clearCookies).toHaveBeenCalledWith({ name: 'session', domain: '::1', path: '/' });
    expect(send).toHaveBeenCalledWith('Storage.clearDataForOrigin', {
      origin: 'http://[::1]',
      storageTypes: 'all',
    });
  });

  it('deletes only a non-default idle Profile below the configured root', async () => {
    const profileRoot = createProfileRoot();
    const profileDirectory = resolveBrowserProfileDirectory(profileRoot, 'throwaway');
    mkdirSync(profileDirectory, { recursive: true });
    const host = new BrowserHost({ profileRoot, sessionFactory: fakeSessionFactory() });

    await expect(host.deleteProfileData('default')).rejects.toMatchObject({
      code: 'browser.default-profile-immutable',
    });
    await expect(host.deleteProfileData('throwaway')).resolves.toBeUndefined();
    expect(existsSync(profileDirectory)).toBe(false);
    await host.shutdown();
  });

  it('keeps Profile deletion behind an in-flight site-data inspection', async () => {
    const profileRoot = createProfileRoot();
    let markInspectionStarted!: () => void;
    const inspectionStarted = new Promise<void>((resolve) => {
      markInspectionStarted = resolve;
    });
    let finishInspection!: () => void;
    const inspectionGate = new Promise<void>((resolve) => {
      finishInspection = resolve;
    });
    const close = vi.fn(async () => undefined);
    const host = new BrowserHost({
      profileRoot,
      sessionFactory: async (input) => ({
        browserKind: 'edge',
        executablePath: 'edge.exe',
        profileDirectory: input.profileDirectory,
        cdpEndpoint: 'http://127.0.0.1:43123',
        isConnected: () => true,
        newPage: async () => new FakePage(),
        listSiteData: async () => {
          markInspectionStarted();
          await inspectionGate;
          return {
            profileId: 'work',
            checkedAt: '2026-08-05T03:00:00.000Z',
            sites: [],
          };
        },
        close,
      }),
    });

    const inspection = host.listProfileSiteData({ profileId: 'work' });
    await inspectionStarted;
    const deletion = host.deleteProfileData('work');
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      expect(close).not.toHaveBeenCalled();
    } finally {
      finishInspection();
    }
    await expect(inspection).resolves.toMatchObject({ profileId: 'work', sites: [] });
    await expect(deletion).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    await host.shutdown();
  });

  it('keeps Profile deletion behind lease recovery and rejects it after recovery wins', async () => {
    const profileRoot = createProfileRoot();
    const page = new FakePage('page-recovering');
    let markRecoveryStarted!: () => void;
    const recoveryStarted = new Promise<void>((resolve) => {
      markRecoveryStarted = resolve;
    });
    let finishRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => {
      finishRecovery = resolve;
    });
    const close = vi.fn(async () => undefined);
    const host = new BrowserHost({
      profileRoot,
      sessionFactory: async (input) => ({
        browserKind: 'edge',
        executablePath: 'edge.exe',
        profileDirectory: input.profileDirectory,
        cdpEndpoint: 'http://127.0.0.1:43123',
        isConnected: () => true,
        newPage: async () => new FakePage(),
        findPage: async () => {
          markRecoveryStarted();
          await recoveryGate;
          return page;
        },
        close,
      }),
    });
    const checkpoint = {
      leaseId: 'lease-recovering',
      pageId: page.pageId,
      profileId: 'work',
      ownerId: 'run:recovering',
    };

    const recovery = host.recoverLease(checkpoint);
    await recoveryStarted;
    const deletion = host.deleteProfileData('work');
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      expect(close).not.toHaveBeenCalled();
    } finally {
      finishRecovery();
    }
    await expect(recovery).resolves.toEqual(checkpoint);
    await expect(deletion).rejects.toMatchObject({ code: 'browser.profile-in-use' });
    expect(close).not.toHaveBeenCalled();
    await host.shutdown();
  });

  it('keeps a Profile busy while release drains an in-flight Page command', async () => {
    const pages: FakePage[] = [];
    const clearSiteData = vi.fn(async () => ({
      profileId: 'work',
      siteKey: 'example.com',
      clearedOrigins: ['https://app.example.com'],
      deletedCookieCount: 1,
      checkedAt: '2026-08-05T03:01:00.000Z',
    }));
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: async (input) => ({
        browserKind: 'edge',
        executablePath: 'edge.exe',
        profileDirectory: input.profileDirectory,
        cdpEndpoint: 'http://127.0.0.1:43123',
        isConnected: () => true,
        newPage: async () => {
          const page = new FakePage();
          pages.push(page);
          return page;
        },
        clearSiteData,
        close: vi.fn(async () => undefined),
      }),
    });
    const lease = await host.acquireLease({ profileId: 'work', ownerId: 'run:1' });
    let markCommandStarted!: () => void;
    const commandStarted = new Promise<void>((resolve) => {
      markCommandStarted = resolve;
    });
    let finishCommand!: () => void;
    const commandGate = new Promise<void>((resolve) => {
      finishCommand = resolve;
    });
    pages[0]!.executeImpl = async () => {
      markCommandStarted();
      await commandGate;
      return { url: 'https://app.example.com/', title: 'Fixture' };
    };

    const command = host.execute({
      leaseId: lease.leaseId,
      action: { kind: 'read' },
      allowedSites: ['https://app.example.com'],
      timeoutMs: 1_000,
    });
    await commandStarted;
    const release = host.releaseLease(lease.leaseId);
    await expect(
      host.clearProfileSiteData({ profileId: 'work', siteKey: 'example.com' }),
    ).rejects.toMatchObject({ code: 'browser.profile-in-use' });
    expect(clearSiteData).not.toHaveBeenCalled();
    finishCommand();
    await Promise.all([command, release]);
    await expect(
      host.clearProfileSiteData({ profileId: 'work', siteKey: 'example.com' }),
    ).resolves.toMatchObject({ deletedCookieCount: 1 });
    await host.shutdown();
  });

  it('serializes commands on one lease while different leases can run concurrently', async () => {
    const pages: FakePage[] = [];
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory({ pages }),
    });
    const first = await host.acquireLease({ profileId: 'work', ownerId: 'conversation:1' });
    const second = await host.acquireLease({ profileId: 'work', ownerId: 'step:2' });

    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const page of pages) {
      page.executeImpl = async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await gate;
        active -= 1;
        return { url: 'https://example.test/', title: 'Fixture' };
      };
    }

    const oneA = host.execute({
      leaseId: first.leaseId,
      action: { kind: 'read' },
      allowedSites: ['https://example.test'],
      timeoutMs: 1_000,
    });
    const oneB = host.execute({
      leaseId: first.leaseId,
      action: { kind: 'read' },
      allowedSites: ['https://example.test'],
      timeoutMs: 1_000,
    });
    const two = host.execute({
      leaseId: second.leaseId,
      action: { kind: 'read' },
      allowedSites: ['https://example.test'],
      timeoutMs: 1_000,
    });
    await vi.waitFor(() => expect(active).toBe(2));
    expect(maxActive).toBe(2);
    release?.();
    await Promise.all([oneA, oneB, two]);
    expect(maxActive).toBe(2);

    await host.shutdown();
  });

  it('rejects unapproved origins before navigation and after a redirect', async () => {
    const pages: FakePage[] = [];
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory({ pages }),
    });
    const lease = await host.acquireLease({ profileId: 'work', ownerId: 'conversation:1' });

    await expect(
      host.execute({
        leaseId: lease.leaseId,
        action: { kind: 'navigate', url: 'https://blocked.test/' },
        allowedSites: ['https://allowed.test'],
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'browser.origin-denied' });
    expect(pages[0]?.currentUrl).toBe('about:blank');

    pages[0]!.executeImpl = async () => ({
      url: 'https://redirected.test/login',
      title: 'Redirected',
    });
    await expect(
      host.execute({
        leaseId: lease.leaseId,
        action: { kind: 'navigate', url: 'https://allowed.test/' },
        allowedSites: ['https://allowed.test'],
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'browser.origin-denied' });

    await host.shutdown();
  });

  it('inspects an active lease for ownership revalidation and rejects a closed Page', async () => {
    const pages: FakePage[] = [];
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory({ pages }),
    });
    const lease = await host.acquireLease({ profileId: 'work', ownerId: 'step:2' });

    await expect(host.inspectLease(lease.leaseId)).resolves.toEqual(lease);

    pages[0]!.closed = true;
    await expect(host.inspectLease(lease.leaseId)).rejects.toMatchObject({
      code: 'browser.lease-not-found',
      failureClass: 'crashed',
    });
    await host.shutdown();
  });

  it('releases Pages explicitly and rejects commands for an old lease', async () => {
    const pages: FakePage[] = [];
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory({ pages }),
    });
    const lease = await host.acquireLease({ profileId: 'work', ownerId: 'conversation:1' });
    await host.releaseLease(lease.leaseId);
    expect(pages[0]?.closed).toBe(true);
    await expect(
      host.execute({
        leaseId: lease.leaseId,
        action: { kind: 'read' },
        allowedSites: ['https://example.test'],
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'browser.lease-not-found' });
    await host.shutdown();
  });

  it('reuses one replacement lease when release races same-owner acquisition', async () => {
    let newPageCalls = 0;
    let markReplacementStarted: (() => void) | undefined;
    const replacementStarted = new Promise<void>((resolve) => {
      markReplacementStarted = resolve;
    });
    let allowReplacement: (() => void) | undefined;
    const replacementGate = new Promise<void>((resolve) => {
      allowReplacement = resolve;
    });
    const pages: FakePage[] = [];
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: async (input) => ({
        browserKind: 'edge',
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        profileDirectory: input.profileDirectory,
        cdpEndpoint: 'http://127.0.0.1:43123',
        isConnected: () => true,
        newPage: async () => {
          newPageCalls += 1;
          if (newPageCalls === 2) {
            markReplacementStarted?.();
            await replacementGate;
          }
          const page = new FakePage();
          pages.push(page);
          return page;
        },
        close: vi.fn(async () => undefined),
      }),
    });
    const original = await host.acquireLease({
      profileId: 'work',
      ownerId: 'conversation:1',
    });

    const firstReplacement = host.acquireLease({
      profileId: 'work',
      ownerId: 'conversation:1',
    });
    const releaseOriginal = host.releaseLease(original.leaseId);
    await replacementStarted;
    const secondReplacement = host.acquireLease({
      profileId: 'work',
      ownerId: 'conversation:1',
    });
    allowReplacement?.();

    const [first, second] = await Promise.all([firstReplacement, secondReplacement]);
    await releaseOriginal;
    expect(newPageCalls).toBe(2);
    expect(pages).toHaveLength(2);
    expect(first.leaseId).toBe(second.leaseId);
    expect(first.leaseId).not.toBe(original.leaseId);
    await host.shutdown();
  });

  it('rejects a Profile directory that resolves through a junction outside its root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-profile-boundary-'));
    tempRoots.push(root);
    const profileRoot = join(root, 'profiles');
    const outside = join(root, 'outside');
    mkdirSync(profileRoot, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(
      outside,
      join(profileRoot, 'work'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const launches: string[] = [];
    const host = new BrowserHost({
      profileRoot,
      sessionFactory: fakeSessionFactory({ launches }),
    });

    await expect(
      host.acquireLease({ profileId: 'work', ownerId: 'conversation:1' }),
    ).rejects.toMatchObject({ code: 'browser.profile-path-invalid', failureClass: 'permission' });
    expect(launches).toEqual([]);
    await host.shutdown();
  });

  it('classifies a dangling Profile link as a stable Profile path rejection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-profile-dangling-'));
    tempRoots.push(root);
    const profileRoot = join(root, 'profiles');
    mkdirSync(profileRoot, { recursive: true });
    symlinkSync(
      join(root, 'missing-outside'),
      join(profileRoot, 'work'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const launches: string[] = [];
    const host = new BrowserHost({
      profileRoot,
      sessionFactory: fakeSessionFactory({ launches }),
    });

    await expect(
      host.acquireLease({ profileId: 'work', ownerId: 'conversation:1' }),
    ).rejects.toMatchObject({ code: 'browser.profile-path-invalid', failureClass: 'permission' });
    expect(launches).toEqual([]);
    await host.shutdown();
  });

  it('preserves a live Page on shutdown and recovers the exact durable lease in a new Host', async () => {
    const profileRoot = createProfileRoot();
    const pages: FakePage[] = [];
    const closes: Array<{ preserve?: boolean } | undefined> = [];
    const recoverOnlyCalls: Array<boolean | undefined> = [];
    const factory: BrowserSessionFactory = async (input) => ({
      browserKind: 'edge',
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      profileDirectory: input.profileDirectory,
      cdpEndpoint: 'http://127.0.0.1:43123',
      isConnected: () => true,
      newPage: async () => {
        const page = new FakePage('target-page-1');
        pages.push(page);
        return page;
      },
      findPage: async (pageId) => pages.find((page) => page.pageId === pageId && !page.closed),
      close: vi.fn(async (options) => {
        closes.push(options);
      }),
    });

    const firstHost = new BrowserHost({ profileRoot, sessionFactory: factory });
    const checkpoint = await firstHost.acquireLease({
      profileId: 'work',
      ownerId: 'conversation:1',
    });
    expect(checkpoint.pageId).toBe('target-page-1');
    await firstHost.shutdown({ preserveSessions: true });
    expect(pages[0]?.closed).toBe(false);
    expect(closes).toEqual([{ preserve: true }]);

    const secondHost = new BrowserHost({
      profileRoot,
      sessionFactory: async (input) => {
        recoverOnlyCalls.push(input.recoverOnly);
        return factory(input);
      },
    });
    const [firstRecovery, concurrentRecovery] = await Promise.all([
      secondHost.recoverLease(checkpoint),
      secondHost.recoverLease(checkpoint),
    ]);
    expect(firstRecovery).toEqual(checkpoint);
    expect(concurrentRecovery).toEqual(checkpoint);
    await expect(secondHost.inspectLease(checkpoint.leaseId)).resolves.toEqual(checkpoint);
    expect(recoverOnlyCalls).toEqual([true]);

    await secondHost.shutdown();
    expect(pages[0]?.closed).toBe(true);
    expect(closes).toEqual([{ preserve: true }, { preserve: false }]);
  });

  it('refuses recovery when the exact target Page is missing or identity conflicts', async () => {
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: async (input) => ({
        browserKind: 'edge',
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        profileDirectory: input.profileDirectory,
        cdpEndpoint: 'http://127.0.0.1:43123',
        isConnected: () => true,
        newPage: async () => new FakePage(),
        findPage: async () => undefined,
        close: vi.fn(async () => undefined),
      }),
    });
    const missing = {
      leaseId: 'lease-persisted',
      pageId: 'target-missing',
      profileId: 'work',
      ownerId: 'conversation:1',
    };
    await expect(host.recoverLease(missing)).rejects.toMatchObject({
      code: 'browser.lease-not-found',
    });
    await host.shutdown();

    const page = new FakePage('target-existing');
    const conflictingHost = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: async (input) => ({
        browserKind: 'edge',
        executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        profileDirectory: input.profileDirectory,
        cdpEndpoint: 'http://127.0.0.1:43123',
        isConnected: () => true,
        newPage: async () => page,
        findPage: async () => page,
        close: vi.fn(async () => undefined),
      }),
    });
    await conflictingHost.recoverLease({ ...missing, pageId: page.pageId });
    await expect(
      conflictingHost.recoverLease({ ...missing, pageId: page.pageId, ownerId: 'conversation:2' }),
    ).rejects.toMatchObject({ code: 'browser.lease-identity-mismatch' });
    await expect(
      conflictingHost.recoverLease({ ...missing, leaseId: 'lease-other', pageId: page.pageId }),
    ).rejects.toMatchObject({ code: 'browser.lease-identity-mismatch' });
    await conflictingHost.shutdown();
  });

  it('bounds action inputs and classifies timeout and Page crash errors', async () => {
    const pages: FakePage[] = [];
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory({ pages }),
    });
    const lease = await host.acquireLease({ profileId: 'work', ownerId: 'conversation:1' });

    await expect(
      host.execute({
        leaseId: lease.leaseId,
        action: { kind: 'fill', selector: '#field', text: 'x'.repeat(70_000) },
        allowedSites: ['https://example.test'],
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'browser.action-invalid', failureClass: 'acceptance' });

    pages[0]!.executeImpl = async () => {
      throw new Error('Timeout 1000ms exceeded');
    };
    await expect(
      host.execute({
        leaseId: lease.leaseId,
        action: { kind: 'read' },
        allowedSites: ['https://example.test'],
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'browser.timeout', failureClass: 'timeout' });

    pages[0]!.executeImpl = async () => {
      throw new Error('Target page, context or browser has been closed');
    };
    await expect(
      host.execute({
        leaseId: lease.leaseId,
        action: { kind: 'read' },
        allowedSites: ['https://example.test'],
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'browser.page-crashed', failureClass: 'crashed' });

    await host.shutdown();
  });

  it('enforces a Host-level deadline even when the Page driver never settles', async () => {
    const pages: FakePage[] = [];
    const host = new BrowserHost({
      profileRoot: createProfileRoot(),
      sessionFactory: fakeSessionFactory({ pages }),
    });
    const lease = await host.acquireLease({ profileId: 'work', ownerId: 'conversation:1' });
    pages[0]!.executeImpl = async () => new Promise<BrowserPageExecutionResult>(() => {});

    const startedAt = Date.now();
    await expect(
      host.execute({
        leaseId: lease.leaseId,
        action: { kind: 'read' },
        allowedSites: ['https://example.test'],
        timeoutMs: 20,
      }),
    ).rejects.toMatchObject({ code: 'browser.timeout', failureClass: 'timeout' });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(pages[0]?.closed).toBe(true);

    const replacement = await host.acquireLease({
      profileId: 'work',
      ownerId: 'conversation:1',
    });
    expect(replacement.leaseId).not.toBe(lease.leaseId);
    await host.shutdown();
  });
});
