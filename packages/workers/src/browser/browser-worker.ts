import type { Worker, WorkerEvent, WorkerJobInput, WorkerJobOutput, WorkerToken } from '../types.js';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

// BrowserWorker interface. Real Playwright worker ships in M3; Phase 0 ships a
// FakeBrowserWorker that emits failure if the action targets an out-of-allowlist
// site. Site allowlist is the §13.1 minimum.

export interface BrowserAction {
  kind: 'navigate' | 'click' | 'extract' | 'fill' | 'wait';
  url?: string;
  selector?: string;
  text?: string;
}

export interface BrowserWorkerInput extends WorkerJobInput {
  action: BrowserAction;
  allowedSites?: string[];
  profilePath?: string;
}

export interface BrowserWorkerOutput extends WorkerJobOutput {}

export interface BrowserWorker extends Worker<BrowserWorkerInput> {
  readonly kind: 'browser';
}

export class FakeBrowserWorker implements BrowserWorker {
  readonly kind = 'browser' as const;
  async *exec(input: BrowserWorkerInput, _token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (input.allowedSites && input.action.url && !input.allowedSites.includes(input.action.url)) {
      yield { type: 'failed', failureClass: 'permission', error: { code: 'security.unauthorized_tool', message: 'site not in allowlist' } };
      return;
    }
    yield { type: 'stderr', text: '[fake-browser] deferred until Playwright ships in M3' };
    yield { type: 'completed', output: { ok: false, message: 'browser fake returning early' } };
  }
}

export class PlaywrightBrowserWorker implements BrowserWorker {
  readonly kind = 'browser' as const;
  static readonly profileTails = new Map<string, Promise<void>>();
  static readonly contexts = new Map<
    string,
    Awaited<ReturnType<typeof chromium.launchPersistentContext>>
  >();

  async *exec(input: BrowserWorkerInput, token: WorkerToken): AsyncIterable<WorkerEvent> {
    if (!input.profilePath) {
      yield { type: 'failed', failureClass: 'acceptance', error: { code: 'browser.profile_required', message: 'Browser identity profile is required' } };
      return;
    }
    if (input.action.url && !isAllowedUrl(input.action.url, input.allowedSites)) {
      yield { type: 'failed', failureClass: 'permission', error: { code: 'security.unauthorized_tool', message: 'site not in allowlist' } };
      return;
    }
    const profilePath = resolve(input.profilePath);
    const release = await acquireProfile(profilePath);
    let context = PlaywrightBrowserWorker.contexts.get(profilePath);
    try {
      if (token.signal?.aborted) throw new Error('Browser action was cancelled');
      await mkdir(profilePath, { recursive: true });
      if (!context) {
        context = await chromium.launchPersistentContext(profilePath, {
          channel: process.env.SYNC_THINK_BROWSER_CHANNEL ?? 'msedge',
          headless: process.env.SYNC_THINK_BROWSER_HEADLESS !== '0',
          args: ['--disable-breakpad', '--disable-crash-reporter'],
        });
        PlaywrightBrowserWorker.contexts.set(profilePath, context);
      }
      const pages = context.pages();
      const page = pages[0] ?? (await context.newPage());
      let extractedText: string | undefined;
      switch (input.action.kind) {
        case 'navigate':
          if (!input.action.url) throw new Error('Browser navigate requires a URL');
          await page.goto(input.action.url, { waitUntil: 'domcontentloaded', timeout: token.timeoutMs });
          break;
        case 'click': {
          const selector = requiredSelector(input.action.selector);
          const locator = page.locator(selector);
          if ((await locator.count()) !== 1) throw new Error('Browser selector must resolve to exactly one element');
          await locator.click({ timeout: token.timeoutMs });
          break;
        }
        case 'fill': {
          const selector = requiredSelector(input.action.selector);
          const locator = page.locator(selector);
          if ((await locator.count()) !== 1) throw new Error('Browser selector must resolve to exactly one element');
          await locator.fill(input.action.text ?? '', { timeout: token.timeoutMs });
          break;
        }
        case 'extract': {
          const locator = input.action.selector ? page.locator(input.action.selector) : page.locator('body');
          if ((await locator.count()) !== 1) throw new Error('Browser selector must resolve to exactly one element');
          extractedText = (await locator.innerText({ timeout: token.timeoutMs })).slice(
            0,
            token.maxOutputBytes ?? 24 * 1024,
          );
          break;
        }
        case 'wait': {
          const selector = requiredSelector(input.action.selector);
          await page.locator(selector).waitFor({ state: 'visible', timeout: token.timeoutMs });
          break;
        }
      }
      yield {
        type: 'completed',
        output: {
          ok: true,
          message: `browser ${input.action.kind} completed`,
          url: page.url(),
          title: await page.title(),
          ...(extractedText === undefined ? {} : { extractedText }),
        },
      };
    } catch (error) {
      if (context && !context.pages().length) {
        PlaywrightBrowserWorker.contexts.delete(profilePath);
        await context.close().catch(() => undefined);
      }
      yield {
        type: 'failed',
        failureClass: token.signal?.aborted ? 'timeout' : 'unknown',
        error: {
          code: token.signal?.aborted ? 'browser.cancelled' : 'browser.action_failed',
          message: error instanceof Error ? error.message : 'Browser action failed',
        },
      };
    } finally {
      release();
    }
  }
}

function requiredSelector(value: string | undefined): string {
  const selector = value?.trim();
  if (!selector || selector.length > 2_000) throw new Error('Browser action requires a bounded selector');
  return selector;
}

function isAllowedUrl(url: string, allowedSites: readonly string[] | undefined): boolean {
  if (!allowedSites || allowedSites.length === 0 || allowedSites.includes('*')) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return allowedSites.some((site) => {
    try {
      const allowed = new URL(site.includes('://') ? site : `https://${site}`);
      return parsed.hostname === allowed.hostname || parsed.hostname.endsWith(`.${allowed.hostname}`);
    } catch {
      return false;
    }
  });
}

async function acquireProfile(profilePath: string): Promise<() => void> {
  const previous = PlaywrightBrowserWorker.profileTails.get(profilePath) ?? Promise.resolve();
  let unlock!: () => void;
  const mine = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const tail = previous.then(() => mine);
  PlaywrightBrowserWorker.profileTails.set(profilePath, tail);
  await previous;
  return () => {
    unlock();
    if (PlaywrightBrowserWorker.profileTails.get(profilePath) === tail) {
      PlaywrightBrowserWorker.profileTails.delete(profilePath);
    }
  };
}

export async function closePlaywrightBrowserWorkers(timeoutMs = 4_000): Promise<void> {
  const contexts = [...PlaywrightBrowserWorker.contexts.values()];
  PlaywrightBrowserWorker.contexts.clear();
  await Promise.allSettled(contexts.map((context) => closeContextWithin(context, timeoutMs)));
}

async function closeContextWithin(
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
