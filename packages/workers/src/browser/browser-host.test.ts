import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserHost,
  BrowserHostError,
  discoverSystemBrowser,
  resolveBrowserProfileDirectory,
  resolveBrowserScreenshotPath,
  type BrowserAction,
  type BrowserDriverPage,
  type BrowserDriverSession,
  type BrowserPageExecutionOptions,
  type BrowserPageExecutionResult,
  type BrowserSessionFactory,
} from './browser-host.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function createProfileRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-browser-host-unit-'));
  tempRoots.push(root);
  return join(root, 'profiles');
}

class FakePage implements BrowserDriverPage {
  closed = false;
  currentUrl = 'about:blank';
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
  }
}

function fakeSessionFactory(state?: { launches?: string[]; pages?: FakePage[] }): BrowserSessionFactory {
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
  it('prefers an explicit executable, then Edge, then Chrome', () => {
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
    const discoveredEdge = discoverSystemBrowser(common);
    expect(discoveredEdge.kind).toBe('edge');
    expect(discoveredEdge.executablePath.replaceAll('\\', '/')).toBe(edge);
    existing.delete(edge);
    const discoveredChrome = discoverSystemBrowser(common);
    expect(discoveredChrome.kind).toBe('chrome');
    expect(discoveredChrome.executablePath.replaceAll('\\', '/')).toBe(chrome);
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
});

describe('BrowserHost Profile sessions and Page leases', () => {
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
    symlinkSync(outside, join(profileRoot, 'work'), process.platform === 'win32' ? 'junction' : 'dir');
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
