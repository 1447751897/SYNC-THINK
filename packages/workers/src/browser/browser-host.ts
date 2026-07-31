import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Route,
} from 'playwright-core';
import { DEFAULT_MAX_OUTPUT_BYTES } from '../process-runner.js';
import { isPathInside, type WorkerJobOutput } from '../types.js';

export type SystemBrowserKind = 'edge' | 'chrome';

export interface SystemBrowserInstallation {
  kind: SystemBrowserKind;
  executablePath: string;
}

export interface BrowserDiscoveryOptions {
  executablePath?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  exists?: (candidate: string) => boolean;
}

export type BrowserAction =
  | {
      kind: 'navigate';
      url: string;
      waitUntil?: 'commit' | 'domcontentloaded' | 'load' | 'networkidle';
    }
  | { kind: 'click'; selector?: string; x?: number; y?: number; button?: 'left' | 'right' | 'middle' }
  | { kind: 'fill'; selector: string; text: string }
  | { kind: 'read' | 'extract'; selector?: string; maxChars?: number }
  | { kind: 'wait'; selector?: string; durationMs?: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' }
  | { kind: 'screenshot'; fileName?: string; fullPage?: boolean };

export interface BrowserReadLink {
  text: string;
  href: string;
}

export interface BrowserReadInput {
  name: string;
  type: string;
  placeholder: string;
  value: string;
}

export interface BrowserPageExecutionResult {
  url: string;
  title: string;
  text?: string;
  links?: BrowserReadLink[];
  buttons?: string[];
  inputs?: BrowserReadInput[];
  matched?: boolean;
  absolutePath?: string;
  relativePath?: string;
  embedUrl?: string;
}

export interface BrowserPageExecutionOptions {
  allowedOrigins: ReadonlySet<string>;
  timeoutMs: number;
  maxOutputBytes: number;
  projectRoot?: string;
  signal?: AbortSignal;
}

export interface BrowserDriverPage {
  isClosed(): boolean;
  execute(
    action: BrowserAction,
    options: BrowserPageExecutionOptions,
  ): Promise<BrowserPageExecutionResult>;
  close(): Promise<void>;
}

export interface BrowserDriverSession {
  browserKind: SystemBrowserKind;
  executablePath: string;
  profileDirectory: string;
  cdpEndpoint: string;
  isConnected(): boolean;
  newPage(): Promise<BrowserDriverPage>;
  close(): Promise<void>;
}

export interface BrowserSessionFactoryInput {
  profileId: string;
  profileRoot: string;
  profileDirectory: string;
  executablePath?: string;
  connectTimeoutMs: number;
}

export type BrowserSessionFactory = (
  input: BrowserSessionFactoryInput,
) => Promise<BrowserDriverSession>;

export interface BrowserLeaseInfo {
  leaseId: string;
  pageId: string;
  profileId: string;
  ownerId: string;
}

export interface BrowserCommandResult
  extends WorkerJobOutput,
    BrowserPageExecutionResult,
    BrowserLeaseInfo {
  ok: true;
  message: string;
}

export interface BrowserHostExecuteInput {
  leaseId: string;
  action: BrowserAction;
  allowedSites: readonly string[];
  timeoutMs: number;
  maxOutputBytes?: number;
  projectRoot?: string;
  signal?: AbortSignal;
}

export interface BrowserHostLike {
  acquireLease(input: { profileId: string; ownerId: string }): Promise<BrowserLeaseInfo>;
  execute(input: BrowserHostExecuteInput): Promise<BrowserCommandResult>;
  releaseLease(leaseId: string, options?: { closePage?: boolean }): Promise<void>;
  shutdown(): Promise<void>;
}

export class BrowserHostError extends Error {
  readonly code: string;
  readonly failureClass: 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown';

  constructor(
    code: string,
    message: string,
    failureClass: 'timeout' | 'crashed' | 'permission' | 'acceptance' | 'unknown' = 'unknown',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BrowserHostError';
    this.code = code;
    this.failureClass = failureClass;
  }
}

export interface BrowserHostOptions {
  profileRoot: string;
  executablePath?: string;
  connectTimeoutMs?: number;
  sessionFactory?: BrowserSessionFactory;
}

interface ManagedSession {
  driver: BrowserDriverSession;
  leases: Set<string>;
}

interface ManagedLease extends BrowserLeaseInfo {
  page: BrowserDriverPage;
  tail: Promise<void>;
}

export class BrowserHost implements BrowserHostLike {
  private readonly profileRoot: string;
  private readonly connectTimeoutMs: number;
  private readonly sessionFactory: BrowserSessionFactory;
  private readonly sessions = new Map<string, Promise<ManagedSession>>();
  private readonly leases = new Map<string, ManagedLease>();
  private readonly ownerLeases = new Map<string, Promise<ManagedLease>>();
  private shuttingDown = false;

  constructor(options: BrowserHostOptions) {
    this.profileRoot = resolve(options.profileRoot);
    this.connectTimeoutMs = clamp(options.connectTimeoutMs ?? 15_000, 1_000, 60_000);
    this.sessionFactory =
      options.sessionFactory ??
      ((input) =>
        launchPlaywrightCdpSession({
          ...input,
          executablePath: input.executablePath ?? options.executablePath,
        }));
  }

  async acquireLease(input: { profileId: string; ownerId: string }): Promise<BrowserLeaseInfo> {
    const profileId = normalizeIdentifier(input.profileId, 'profileId');
    const ownerId = normalizeOwnerId(input.ownerId);
    const ownerKey = `${profileId}\0${ownerId}`;

    while (true) {
      if (this.shuttingDown) {
        throw new BrowserHostError('browser.host-shutting-down', 'Browser Host is shutting down');
      }
      const existingPromise = this.ownerLeases.get(ownerKey);
      if (existingPromise) {
        let existing: ManagedLease;
        try {
          existing = await existingPromise;
        } catch (error) {
          if (this.ownerLeases.get(ownerKey) === existingPromise) {
            this.ownerLeases.delete(ownerKey);
          }
          throw error;
        }
        if (this.ownerLeases.get(ownerKey) !== existingPromise) continue;
        if (!existing.page.isClosed() && this.leases.has(existing.leaseId)) {
          return leaseInfo(existing);
        }
        this.ownerLeases.delete(ownerKey);
        this.leases.delete(existing.leaseId);
        continue;
      }

      const pending = this.createLease(profileId, ownerId);
      this.ownerLeases.set(ownerKey, pending);
      try {
        return leaseInfo(await pending);
      } catch (error) {
        if (this.ownerLeases.get(ownerKey) === pending) this.ownerLeases.delete(ownerKey);
        throw error;
      }
    }
  }

  async execute(input: BrowserHostExecuteInput): Promise<BrowserCommandResult> {
    const lease = this.leases.get(input.leaseId);
    if (!lease || lease.page.isClosed()) {
      throw new BrowserHostError(
        'browser.lease-not-found',
        'Browser Page lease is missing or closed',
        'crashed',
      );
    }
    const allowedOrigins = normalizeAllowedOrigins(input.allowedSites);
    if (input.signal?.aborted) {
      throw new BrowserHostError('browser.aborted', 'Browser action was cancelled', 'acceptance');
    }
    validateBrowserAction(input.action);
    if (input.action.kind === 'navigate') assertAllowedUrl(input.action.url, allowedOrigins);
    if (input.action.kind === 'screenshot' && !input.projectRoot) {
      throw new BrowserHostError(
        'browser.screenshot-root-required',
        'A bound project root is required for screenshots',
        'permission',
      );
    }

    const command = lease.tail.then(async () => {
      if (lease.page.isClosed()) {
        throw new BrowserHostError('browser.page-closed', 'Browser Page is closed', 'crashed');
      }
      if (input.signal?.aborted) {
        throw new BrowserHostError('browser.aborted', 'Browser action was cancelled', 'acceptance');
      }
      try {
        const result = await executePageWithDeadline(lease.page, input.action, {
          allowedOrigins,
          timeoutMs: clamp(input.timeoutMs, 1, 10 * 60_000),
          maxOutputBytes: clamp(
            input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
            1,
            1024 * 1024,
          ),
          projectRoot: input.projectRoot,
          signal: input.signal,
        });
        assertAllowedUrl(result.url, allowedOrigins, true);
        return {
          ok: true as const,
          message: browserActionMessage(input.action.kind),
          ...leaseInfo(lease),
          ...result,
        };
      } catch (error) {
        throw normalizeBrowserError(error, input.signal);
      }
    });
    lease.tail = command.then(
      () => undefined,
      () => undefined,
    );
    return command;
  }

  async releaseLease(leaseId: string, options?: { closePage?: boolean }): Promise<void> {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    this.leases.delete(leaseId);
    const ownerKey = `${lease.profileId}\0${lease.ownerId}`;
    const ownerPromise = this.ownerLeases.get(ownerKey);
    if (
      ownerPromise &&
      (await ownerPromise.catch(() => undefined))?.leaseId === leaseId &&
      this.ownerLeases.get(ownerKey) === ownerPromise
    ) {
      this.ownerLeases.delete(ownerKey);
    }
    const session = await this.sessions.get(lease.profileId)?.catch(() => undefined);
    session?.leases.delete(leaseId);
    await lease.tail;
    if (options?.closePage !== false && !lease.page.isClosed()) await lease.page.close();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    await Promise.allSettled([...this.ownerLeases.values()]);
    const leaseIds = [...this.leases.keys()];
    await Promise.allSettled(leaseIds.map((leaseId) => this.releaseLease(leaseId)));
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.ownerLeases.clear();
    await Promise.allSettled(
      sessions.map(async (sessionPromise) => (await sessionPromise).driver.close()),
    );
  }

  private async createLease(profileId: string, ownerId: string): Promise<ManagedLease> {
    const session = await this.getSession(profileId);
    const page = await session.driver.newPage();
    if (this.shuttingDown) {
      await page.close().catch(() => undefined);
      throw new BrowserHostError('browser.host-shutting-down', 'Browser Host is shutting down');
    }
    const lease: ManagedLease = {
      leaseId: randomUUID(),
      pageId: randomUUID(),
      profileId,
      ownerId,
      page,
      tail: Promise.resolve(),
    };
    session.leases.add(lease.leaseId);
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  private async getSession(profileId: string): Promise<ManagedSession> {
    const existingPromise = this.sessions.get(profileId);
    if (existingPromise) {
      const session = await existingPromise;
      if (session.driver.isConnected()) return session;
      if (this.sessions.get(profileId) === existingPromise) {
        this.sessions.delete(profileId);
        await session.driver.close().catch(() => undefined);
      }
      const replacement = this.sessions.get(profileId);
      if (replacement) return replacement;
    }

    const profileDirectory = resolveBrowserProfileDirectory(this.profileRoot, profileId);
    const pending = (async () => {
      await ensureSafeBrowserProfileDirectory(this.profileRoot, profileId);
      const driver = await this.sessionFactory({
        profileId,
        profileRoot: this.profileRoot,
        profileDirectory,
        connectTimeoutMs: this.connectTimeoutMs,
      });
      return { driver, leases: new Set<string>() };
    })();
    this.sessions.set(profileId, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.sessions.get(profileId) === pending) this.sessions.delete(profileId);
      throw normalizeBrowserError(error);
    }
  }
}

export function discoverSystemBrowser(
  options: BrowserDiscoveryOptions = {},
): SystemBrowserInstallation {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  if (options.executablePath) {
    if (!exists(options.executablePath)) {
      throw new BrowserHostError(
        'browser.executable-not-found',
        `Configured browser executable does not exist: ${options.executablePath}`,
      );
    }
    return {
      kind: inferBrowserKind(options.executablePath),
      executablePath: options.executablePath,
    };
  }

  for (const installation of browserCandidates(platform, env)) {
    if (exists(installation.executablePath)) return installation;
  }
  throw new BrowserHostError(
    'browser.executable-not-found',
    'No supported system Edge or Chrome executable was found',
  );
}

export function resolveBrowserProfileDirectory(profileRoot: string, profileId: string): string {
  const normalized = normalizeIdentifier(profileId, 'profileId');
  const root = resolve(profileRoot);
  const target = resolve(root, normalized);
  if (!isPathInside(target, root)) {
    throw new BrowserHostError(
      'browser.profile-path-invalid',
      'Browser Profile path escapes the configured root',
      'permission',
    );
  }
  return target;
}

async function ensureSafeBrowserProfileDirectory(
  profileRoot: string,
  profileId: string,
): Promise<string> {
  try {
    const root = resolve(profileRoot);
    const target = resolveBrowserProfileDirectory(root, profileId);
    await mkdir(root, { recursive: true });
    let targetStat = await lstat(target).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (!targetStat) {
      try {
        await mkdir(target, { recursive: false });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      targetStat = await lstat(target);
    }
    if (
      !targetStat.isDirectory() ||
      targetStat.isSymbolicLink() ||
      !(await isRealProfilePathInside(target, root))
    ) {
      throw new BrowserHostError(
        'browser.profile-path-invalid',
        'Browser Profile directory resolves outside the configured root',
        'permission',
      );
    }
    return target;
  } catch (error) {
    if (error instanceof BrowserHostError) throw error;
    throw new BrowserHostError(
      'browser.profile-path-invalid',
      'Browser Profile directory resolves outside the configured root',
      'permission',
      { cause: error },
    );
  }
}

async function isRealProfilePathInside(target: string, root: string): Promise<boolean> {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  return isPathInside(realTarget, realRoot);
}

export function resolveBrowserScreenshotPath(
  projectRoot: string,
  fileName = `browser-${Date.now()}-${randomUUID()}.png`,
): { absolutePath: string; relativePath: string; embedUrl: string } {
  if (
    !fileName ||
    fileName !== basename(fileName) ||
    extname(fileName).toLowerCase() !== '.png' ||
    fileName.includes('\0')
  ) {
    throw new BrowserHostError(
      'browser.screenshot-path-invalid',
      'Screenshot file name must be a plain PNG file name',
      'permission',
    );
  }
  const root = resolve(projectRoot);
  const directory = resolve(root, '.sync-think', 'screenshots');
  const absolutePath = resolve(directory, fileName);
  if (!isPathInside(directory, root) || !isPathInside(absolutePath, directory)) {
    throw new BrowserHostError(
      'browser.screenshot-path-invalid',
      'Screenshot path escapes the bound project root',
      'permission',
    );
  }
  const relativePath = `.sync-think/screenshots/${fileName}`;
  return {
    absolutePath,
    relativePath,
    embedUrl: `sync-think-image://screenshot/${encodeURIComponent(absolutePath)}`,
  };
}

export function normalizeAllowedOrigins(allowedSites: readonly string[]): ReadonlySet<string> {
  if (allowedSites.length > 256) {
    throw new BrowserHostError(
      'browser.origin-grant-invalid',
      'Browser origin grant list exceeds 256 entries',
      'permission',
    );
  }
  const origins = new Set<string>();
  for (const site of allowedSites) {
    if (typeof site !== 'string' || site.length > 8_192 || site.includes('\0')) continue;
    try {
      const parsed = new URL(site);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      origins.add(parsed.origin.toLowerCase());
    } catch {
      // Invalid grants do not widen the capability.
    }
  }
  if (origins.size === 0) {
    throw new BrowserHostError(
      'browser.origin-grant-required',
      'At least one valid HTTP(S) origin grant is required',
      'permission',
    );
  }
  return origins;
}

function leaseInfo(lease: ManagedLease): BrowserLeaseInfo {
  return {
    leaseId: lease.leaseId,
    pageId: lease.pageId,
    profileId: lease.profileId,
    ownerId: lease.ownerId,
  };
}

function normalizeIdentifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(normalized) || normalized === '..') {
    throw new BrowserHostError(
      `browser.${field}-invalid`,
      `${field} must be a short alphanumeric identifier`,
      'permission',
    );
  }
  return normalized;
}

function normalizeOwnerId(value: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 256 || normalized.includes('\0')) {
    throw new BrowserHostError(
      'browser.owner-invalid',
      'Browser lease owner is missing or invalid',
      'permission',
    );
  }
  return normalized;
}

function assertAllowedUrl(
  value: string,
  allowedOrigins: ReadonlySet<string>,
  allowInternal = false,
): void {
  if (allowInternal && (value === 'about:blank' || value.startsWith('chrome://'))) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BrowserHostError('browser.url-invalid', 'Browser URL is invalid', 'permission');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !allowedOrigins.has(parsed.origin.toLowerCase())
  ) {
    throw new BrowserHostError(
      'browser.origin-denied',
      `Origin is outside the browser capability grant: ${parsed.origin}`,
      'permission',
    );
  }
}

function browserActionMessage(kind: BrowserAction['kind']): string {
  switch (kind) {
    case 'navigate':
      return 'Browser navigation completed';
    case 'click':
      return 'Browser click completed';
    case 'fill':
      return 'Browser fill completed';
    case 'read':
    case 'extract':
      return 'Browser read completed';
    case 'wait':
      return 'Browser wait completed';
    case 'screenshot':
      return 'Browser screenshot completed';
  }
}

function validateBrowserAction(action: BrowserAction): void {
  const selectorIsValid = (selector: string | undefined) =>
    selector === undefined ||
    (selector.length > 0 && selector.length <= 8_192 && !selector.includes('\0'));
  let valid = true;
  switch (action.kind) {
    case 'navigate':
      valid =
        typeof action.url === 'string' &&
        action.url.length > 0 &&
        action.url.length <= 8_192 &&
        !action.url.includes('\0');
      break;
    case 'click': {
      const selectorProvided = action.selector !== undefined;
      const hasSelector = selectorIsValid(action.selector) && Boolean(action.selector);
      const hasCoordinates =
        Number.isFinite(action.x) &&
        Number.isFinite(action.y) &&
        action.x! >= 0 &&
        action.y! >= 0 &&
        action.x! <= 100_000 &&
        action.y! <= 100_000;
      valid = selectorProvided ? hasSelector : hasCoordinates;
      break;
    }
    case 'fill':
      valid =
        selectorIsValid(action.selector) &&
        Boolean(action.selector) &&
        typeof action.text === 'string' &&
        Buffer.byteLength(action.text, 'utf8') <= 64 * 1024 &&
        !action.text.includes('\0');
      break;
    case 'read':
    case 'extract':
      valid = selectorIsValid(action.selector);
      break;
    case 'wait':
      valid =
        selectorIsValid(action.selector) &&
        (action.durationMs === undefined ||
          (Number.isFinite(action.durationMs) && action.durationMs >= 0));
      break;
    case 'screenshot':
      valid =
        action.fileName === undefined ||
        (action.fileName === basename(action.fileName) &&
          extname(action.fileName).toLowerCase() === '.png' &&
          action.fileName.length <= 255 &&
          !action.fileName.includes('\0'));
      break;
  }
  if (!valid) {
    throw new BrowserHostError(
      'browser.action-invalid',
      `Browser ${action.kind} arguments are invalid or exceed limits`,
      'acceptance',
    );
  }
}

function normalizeBrowserError(error: unknown, signal?: AbortSignal): BrowserHostError {
  if (error instanceof BrowserHostError) return error;
  if (signal?.aborted) {
    return new BrowserHostError('browser.aborted', 'Browser action was cancelled', 'acceptance', {
      cause: error,
    });
  }
  const message = error instanceof Error ? error.message : 'Browser operation failed';
  if (/timeout/i.test(message)) {
    return new BrowserHostError('browser.timeout', message, 'timeout', { cause: error });
  }
  if (/closed|disconnected|crash/i.test(message)) {
    return new BrowserHostError('browser.page-crashed', message, 'crashed', { cause: error });
  }
  return new BrowserHostError('browser.operation-failed', message, 'unknown', { cause: error });
}

async function executePageWithDeadline(
  page: BrowserDriverPage,
  action: BrowserAction,
  options: BrowserPageExecutionOptions,
): Promise<BrowserPageExecutionResult> {
  const controller = new AbortController();
  let interrupted = false;
  let rejectCancellation: ((error: BrowserHostError) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const interrupt = (error: BrowserHostError) => {
    if (interrupted) return;
    interrupted = true;
    controller.abort();
    void page.close().catch(() => undefined);
    rejectCancellation?.(error);
  };
  const onAbort = () =>
    interrupt(new BrowserHostError('browser.aborted', 'Browser action was cancelled', 'acceptance'));
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(
    () =>
      interrupt(
        new BrowserHostError(
          'browser.timeout',
          `Browser action timed out after ${options.timeoutMs}ms`,
          'timeout',
        ),
      ),
    options.timeoutMs,
  );
  const operation = page.execute(action, { ...options, signal: controller.signal });
  try {
    if (options.signal?.aborted) onAbort();
    return await Promise.race([operation, cancellation]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    if (interrupted) {
      await page.close().catch(() => undefined);
      await Promise.race([operation.catch(() => undefined), delay(250)]);
    }
  }
}

function inferBrowserKind(executablePath: string): SystemBrowserKind {
  return /(?:ms)?edge/i.test(basename(executablePath)) || /edge/i.test(executablePath)
    ? 'edge'
    : 'chrome';
}

function browserCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): SystemBrowserInstallation[] {
  const candidates: SystemBrowserInstallation[] = [];
  const add = (kind: SystemBrowserKind, base: string | undefined, ...parts: string[]) => {
    if (base) candidates.push({ kind, executablePath: join(base, ...parts) });
  };
  if (platform === 'win32') {
    add('edge', env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    add('edge', env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    add('edge', env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    add('chrome', env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe');
    add('chrome', env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe');
    add('chrome', env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe');
  } else if (platform === 'darwin') {
    candidates.push(
      { kind: 'edge', executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { kind: 'chrome', executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    );
  } else {
    candidates.push(
      { kind: 'edge', executablePath: '/usr/bin/microsoft-edge' },
      { kind: 'edge', executablePath: '/usr/bin/microsoft-edge-stable' },
      { kind: 'chrome', executablePath: '/usr/bin/google-chrome' },
      { kind: 'chrome', executablePath: '/usr/bin/google-chrome-stable' },
      { kind: 'chrome', executablePath: '/usr/bin/chromium' },
      { kind: 'chrome', executablePath: '/usr/bin/chromium-browser' },
    );
  }
  return candidates;
}

async function launchPlaywrightCdpSession(
  input: BrowserSessionFactoryInput,
): Promise<BrowserDriverSession> {
  const installation = discoverSystemBrowser({ executablePath: input.executablePath });
  const safeProfileDirectory = await ensureSafeBrowserProfileDirectory(
    input.profileRoot,
    input.profileId,
  );
  if (resolve(safeProfileDirectory) !== resolve(input.profileDirectory)) {
    throw new BrowserHostError(
      'browser.profile-path-invalid',
      'Browser Profile directory does not match the configured root and Profile ID',
      'permission',
    );
  }
  const port = await reserveLoopbackPort();
  const endpoint = `http://127.0.0.1:${port}`;
  const child = spawn(
    installation.executablePath,
    [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${input.profileDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      'about:blank',
    ],
    {
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
    },
  );
  try {
    await waitForCdp(endpoint, child, input.connectTimeoutMs);
    const browser = await chromium.connectOverCDP(endpoint, { timeout: input.connectTimeoutMs });
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new BrowserHostError(
        'browser.context-missing',
        'System browser exposed no default CDP context',
        'crashed',
      );
    }
    const session = new PlaywrightCdpSession(
      installation,
      input.profileDirectory,
      endpoint,
      child,
      browser,
      context,
    );
    await session.initialize();
    return session;
  } catch (error) {
    terminateOwnedBrowser(child);
    throw error;
  }
}

class PlaywrightCdpSession implements BrowserDriverSession {
  readonly browserKind: SystemBrowserKind;
  readonly executablePath: string;
  readonly profileDirectory: string;
  readonly cdpEndpoint: string;
  private closed = false;
  private readonly pages = new Map<Page, PlaywrightDriverPage>();
  private readonly activePages = new Set<PlaywrightDriverPage>();
  private readonly routeHandler = (route: Route) =>
    this.routeNavigation(route).catch(async () => {
      await route.abort('blockedbyclient').catch(() => undefined);
    });

  constructor(
    installation: SystemBrowserInstallation,
    profileDirectory: string,
    cdpEndpoint: string,
    private readonly child: ChildProcess,
    private readonly browser: Browser,
    private readonly context: BrowserContext,
  ) {
    this.browserKind = installation.kind;
    this.executablePath = installation.executablePath;
    this.profileDirectory = profileDirectory;
    this.cdpEndpoint = cdpEndpoint;
    this.browser.on('disconnected', () => {
      this.closed = true;
    });
  }

  isConnected(): boolean {
    return !this.closed && this.browser.isConnected();
  }

  async initialize(): Promise<void> {
    await this.context.route('**/*', this.routeHandler);
  }

  async newPage(): Promise<BrowserDriverPage> {
    if (!this.isConnected()) {
      throw new BrowserHostError('browser.disconnected', 'System browser is disconnected', 'crashed');
    }
    const page = await this.context.newPage();
    const driver = await PlaywrightDriverPage.create(
      page,
      () => this.pages.delete(page),
      () => this.activePages.add(driver),
      () => this.activePages.delete(driver),
    );
    this.pages.set(page, driver);
    return driver;
  }

  async close(): Promise<void> {
    if (this.closed) {
      terminateOwnedBrowser(this.child);
      return;
    }
    this.closed = true;
    await this.context.unroute('**/*', this.routeHandler).catch(() => undefined);
    await this.browser.close().catch(() => undefined);
    terminateOwnedBrowser(this.child);
  }

  private async routeNavigation(route: Route): Promise<void> {
    const request = route.request();
    if (!request.isNavigationRequest()) {
      await route.continue();
      return;
    }
    let frame;
    try {
      frame = request.frame();
    } catch {
      for (const activePage of this.activePages) {
        activePage.recordPopupViolation(request.url());
      }
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    const page = frame.page();
    if (frame !== page.mainFrame()) {
      await route.continue();
      return;
    }

    const managed = this.pages.get(page);
    if (managed) {
      const decision = managed.applyNavigationRequestPolicy(route, false);
      managed.trackPolicyTask(decision);
      await decision;
      return;
    }

    const opener = await page.opener().catch(() => null);
    const owner = opener ? this.pages.get(opener) : undefined;
    if (owner) {
      const decision = owner.applyNavigationRequestPolicy(route, true);
      owner.trackPolicyTask(decision);
      await decision;
      await page.close().catch(() => undefined);
      return;
    }

    await route.abort('blockedbyclient').catch(() => undefined);
    await page.close().catch(() => undefined);
  }
}

class PlaywrightDriverPage implements BrowserDriverPage {
  private allowedOrigins: ReadonlySet<string> = new Set();
  private navigationViolation: BrowserHostError | undefined;
  private readonly policyTasks = new Set<Promise<void>>();

  private constructor(
    private readonly page: Page,
    private readonly cdpSession: CDPSession,
    private readonly mainFrameId: string,
    private readonly onCommandStart: () => void,
    private readonly onCommandEnd: () => void,
  ) {}

  static async create(
    page: Page,
    onClose: () => void,
    onCommandStart: () => void,
    onCommandEnd: () => void,
  ): Promise<PlaywrightDriverPage> {
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Page.enable');
    const frameTree = await cdpSession.send('Page.getFrameTree');
    const driver = new PlaywrightDriverPage(
      page,
      cdpSession,
      frameTree.frameTree.frame.id,
      onCommandStart,
      onCommandEnd,
    );
    cdpSession.on('Fetch.requestPaused', (event) => {
      driver.trackPolicyTask(driver.applyNavigationResponsePolicy(event));
    });
    await cdpSession.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', resourceType: 'Document', requestStage: 'Response' }],
    });
    page.once('close', onClose);
    return driver;
  }

  isClosed(): boolean {
    return this.page.isClosed();
  }

  async execute(
    action: BrowserAction,
    options: BrowserPageExecutionOptions,
  ): Promise<BrowserPageExecutionResult> {
    this.allowedOrigins = options.allowedOrigins;
    this.navigationViolation = undefined;
    this.onCommandStart();
    const onAbort = () => {
      void this.page.close().catch(() => undefined);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    try {
      let actionResult: Omit<BrowserPageExecutionResult, 'url' | 'title'>;
      try {
        actionResult = await this.executeAction(action, options);
      } catch (error) {
        await this.waitForPolicyTasks();
        throw this.takeNavigationViolation() ?? error;
      }
      await this.waitForPolicyTasks();
      const violation = this.takeNavigationViolation();
      if (violation) throw violation;
      const title = this.page.isClosed() ? '' : await this.page.title();
      return { url: this.page.url(), title, ...actionResult };
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      this.onCommandEnd();
    }
  }

  async close(): Promise<void> {
    if (!this.page.isClosed()) await this.page.close();
    await this.cdpSession.detach().catch(() => undefined);
  }

  trackPolicyTask(task: Promise<void>): void {
    this.policyTasks.add(task);
    void task.finally(() => this.policyTasks.delete(task)).catch(() => undefined);
  }

  async applyNavigationRequestPolicy(route: Route, popup: boolean): Promise<void> {
    const target = route.request().url();
    if (popup || !this.isAllowedNavigation(target)) {
      this.recordNavigationViolation(
        target,
        popup && this.isAllowedNavigation(target) ? 'browser.popup-denied' : 'browser.origin-denied',
      );
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    await route.continue();
  }

  recordPopupViolation(target: string): void {
    this.recordNavigationViolation(
      target,
      this.isAllowedNavigation(target) ? 'browser.popup-denied' : 'browser.origin-denied',
    );
  }

  private async applyNavigationResponsePolicy(event: {
    requestId: string;
    request: { url: string };
    frameId: string;
    responseStatusCode?: number;
    responseHeaders?: Array<{ name: string; value: string }>;
  }): Promise<void> {
    const status = event.responseStatusCode;
    const location = event.responseHeaders?.find(
      (header) => header.name.toLowerCase() === 'location',
    )?.value;
    if (
      event.frameId === this.mainFrameId &&
      status !== undefined &&
      status >= 300 &&
      status < 400 &&
      location
    ) {
      let target: string;
      try {
        target = new URL(location, event.request.url).toString();
      } catch {
        target = location;
      }
      if (!this.isAllowedNavigation(target)) {
        this.recordNavigationViolation(target, 'browser.origin-denied');
        await this.cdpSession
          .send('Fetch.fulfillRequest', {
            requestId: event.requestId,
            responseCode: 451,
            responsePhrase: 'Blocked by browser origin policy',
            responseHeaders: [
              { name: 'content-type', value: 'text/plain; charset=utf-8' },
              { name: 'cache-control', value: 'no-store' },
            ],
            body: Buffer.from('Navigation blocked by browser origin policy', 'utf8').toString(
              'base64',
            ),
          })
          .catch(() => undefined);
        return;
      }
    }
    try {
      await this.cdpSession.send('Fetch.continueResponse', { requestId: event.requestId });
    } catch {
      await this.cdpSession
        .send('Fetch.continueRequest', { requestId: event.requestId })
        .catch(() => undefined);
    }
  }

  private async waitForPolicyTasks(): Promise<void> {
    while (this.policyTasks.size > 0) {
      await Promise.allSettled([...this.policyTasks]);
    }
  }

  private recordNavigationViolation(target: string, code: string): void {
    if (this.navigationViolation) return;
    this.navigationViolation = new BrowserHostError(
      code,
      code === 'browser.popup-denied'
        ? 'Opening a new unmanaged browser Page is outside the current lease'
        : `Origin is outside the browser capability grant: ${originForError(target)}`,
      'permission',
    );
  }

  private takeNavigationViolation(): BrowserHostError | undefined {
    const violation = this.navigationViolation;
    this.navigationViolation = undefined;
    return violation;
  }

  private async executeAction(
    action: BrowserAction,
    options: BrowserPageExecutionOptions,
  ): Promise<Omit<BrowserPageExecutionResult, 'url' | 'title'>> {
    const timeout = options.timeoutMs;
    switch (action.kind) {
      case 'navigate':
        await this.page.goto(action.url, {
          waitUntil: action.waitUntil ?? 'domcontentloaded',
          timeout,
        });
        return {};
      case 'click': {
        if (action.selector) {
          await this.page.locator(action.selector).click({ button: action.button, timeout });
        } else if (
          Number.isFinite(action.x) &&
          Number.isFinite(action.y) &&
          action.x! >= 0 &&
          action.y! >= 0
        ) {
          await this.page.mouse.click(action.x!, action.y!, { button: action.button });
        } else {
          throw new BrowserHostError(
            'browser.click-target-required',
            'Click requires a selector or non-negative x/y coordinates',
            'acceptance',
          );
        }
        return { matched: true };
      }
      case 'fill':
        if (!action.selector.trim()) {
          throw new BrowserHostError(
            'browser.selector-required',
            'Fill requires a selector',
            'acceptance',
          );
        }
        await this.page.locator(action.selector).fill(action.text, { timeout });
        return { matched: true };
      case 'read':
      case 'extract':
        return this.readPage(action.selector, action.maxChars, options.maxOutputBytes);
      case 'wait':
        if (action.selector) {
          await this.page.locator(action.selector).waitFor({
            state: action.state ?? 'visible',
            timeout,
          });
        } else {
          await this.page.waitForTimeout(clamp(action.durationMs ?? 250, 0, timeout));
        }
        return { matched: true };
      case 'screenshot': {
        if (!options.projectRoot) {
          throw new BrowserHostError(
            'browser.screenshot-root-required',
            'A bound project root is required for screenshots',
            'permission',
          );
        }
        const target = resolveBrowserScreenshotPath(options.projectRoot, action.fileName);
        await mkdir(dirname(target.absolutePath), { recursive: true });
        const [realProjectRoot, realScreenshotDirectory] = await Promise.all([
          realpath(resolve(options.projectRoot)),
          realpath(dirname(target.absolutePath)),
        ]);
        if (!isPathInside(realScreenshotDirectory, realProjectRoot)) {
          throw new BrowserHostError(
            'browser.screenshot-path-invalid',
            'Screenshot directory resolves outside the bound project root',
            'permission',
          );
        }
        await this.page.screenshot({
          path: target.absolutePath,
          type: 'png',
          fullPage: action.fullPage ?? false,
          timeout,
        });
        return target;
      }
    }
  }

  private async readPage(
    selector: string | undefined,
    maxChars: number | undefined,
    maxOutputBytes: number,
  ): Promise<
    Pick<BrowserPageExecutionResult, 'text' | 'links' | 'buttons' | 'inputs' | 'matched'>
  > {
    const boundedChars = clamp(maxChars ?? 8_000, 1, 64_000);
    const selectorJson = JSON.stringify(selector ?? 'body');
    const expression = `(() => {
      const root = document.querySelector(${selectorJson});
      if (!root) return { matched: false, text: '', links: [], buttons: [], inputs: [] };
      const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const text = String(root.innerText || root.textContent || '').slice(0, ${boundedChars});
      const links = Array.from(root.querySelectorAll('a[href]')).slice(0, 50).map((node) => ({
        text: clean(node.innerText || node.textContent),
        href: String(node.href || '')
      }));
      const buttons = Array.from(root.querySelectorAll('button,[role="button"]')).slice(0, 50)
        .map((node) => clean(node.innerText || node.textContent || node.getAttribute('aria-label')))
        .filter(Boolean);
      const inputs = Array.from(root.querySelectorAll('input,textarea,select')).slice(0, 50).map((node) => ({
        name: String(node.getAttribute('name') || node.getAttribute('aria-label') || ''),
        type: String(node.getAttribute('type') || node.tagName || '').toLowerCase(),
        placeholder: String(node.getAttribute('placeholder') || ''),
        value: node.getAttribute('type') === 'password' ? '' : String(node.value || '')
      }));
      return { matched: true, text, links, buttons, inputs };
    })()`;
    const raw = (await this.page.evaluate(expression)) as {
      matched: boolean;
      text: string;
      links: BrowserReadLink[];
      buttons: string[];
      inputs: BrowserReadInput[];
    };
    const serialized = JSON.stringify(raw);
    if (Buffer.byteLength(serialized, 'utf8') <= maxOutputBytes) return raw;
    const structuralBytes = Buffer.byteLength(
      JSON.stringify({ ...raw, text: '', links: [], buttons: [], inputs: [] }),
      'utf8',
    );
    return {
      matched: raw.matched,
      text: clampUtf8(raw.text, Math.max(0, maxOutputBytes - structuralBytes)),
      links: [],
      buttons: [],
      inputs: [],
    };
  }

  private isAllowedNavigation(value: string): boolean {
    if (value === 'about:blank' || value.startsWith('chrome://')) return true;
    try {
      const parsed = new URL(value);
      return (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        this.allowedOrigins.has(parsed.origin.toLowerCase())
      );
    } catch {
      return false;
    }
  }
}

function originForError(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return '(invalid URL)';
  }
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (port > 0) resolvePort(port);
        else reject(new Error('Failed to reserve a loopback CDP port'));
      });
    });
  });
}

async function waitForCdp(endpoint: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new BrowserHostError(
        'browser.process-exited',
        `System browser exited before CDP became ready (code ${String(child.exitCode)})`,
        'crashed',
      );
    }
    if (await probeCdp(`${endpoint}/json/version`)) return;
    await delay(100);
  }
  throw new BrowserHostError(
    'browser.cdp-timeout',
    `System browser CDP endpoint did not become ready within ${timeoutMs}ms`,
    'timeout',
  );
}

async function probeCdp(url: string): Promise<boolean> {
  return new Promise<boolean>((resolveProbe) => {
    const req = request(url, { method: 'GET', timeout: 500 }, (response) => {
      response.resume();
      resolveProbe(response.statusCode === 200);
    });
    req.once('timeout', () => {
      req.destroy();
      resolveProbe(false);
    });
    req.once('error', () => resolveProbe(false));
    req.end();
  });
}

function terminateOwnedBrowser(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // The owned browser process already exited.
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

function clampUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maxBytes) return value;
  return encoded.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '');
}
