import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer, isIP } from 'node:net';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Cookie,
  type Frame,
  type Page,
  type Route,
} from 'playwright-core';
import { getDomain } from 'tldts';
import {
  BROWSER_RECORDING_MAX_LOCATOR_CHARS,
  BROWSER_RECORDING_MAX_STEP_BYTES,
  BROWSER_RECORDING_MAX_STEPS,
  BROWSER_RECORDING_MAX_TEXT_CHARS,
  BROWSER_RECORDING_MAX_URL_CHARS,
  type BrowserRecordingInputValue,
  type BrowserRecordingLocator,
  type BrowserRecordingStepInput,
} from '@sync-think/shared';
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
  | {
      kind: 'click';
      selector?: string;
      text?: string;
      x?: number;
      y?: number;
      button?: 'left' | 'right' | 'middle';
    }
  | { kind: 'fill'; selector: string; text: string }
  | { kind: 'read' | 'extract'; selector?: string; maxChars?: number }
  | {
      kind: 'wait';
      selector?: string;
      durationMs?: number;
      state?: 'attached' | 'detached' | 'visible' | 'hidden';
    }
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

export interface BrowserProfileSiteData {
  siteKey: string;
  origins: string[];
  cookieCount: number;
  storageBytes: number;
  storageTypes: string[];
}

export interface BrowserProfileSiteDataSnapshot {
  profileId: string;
  checkedAt: string;
  sites: BrowserProfileSiteData[];
}

export interface BrowserProfileSiteClearResult {
  profileId: string;
  siteKey: string;
  clearedOrigins: string[];
  deletedCookieCount: number;
  checkedAt: string;
}

export interface BrowserPageExecutionOptions {
  allowedOrigins: ReadonlySet<string>;
  timeoutMs: number;
  maxOutputBytes: number;
  projectRoot?: string;
  signal?: AbortSignal;
}

export type BrowserRecordingMutation = {
  type: 'append' | 'replace-last';
  step: BrowserRecordingStepInput;
};

export type BrowserRecordingTerminationReason =
  'page_closed' | 'browser_closed' | 'step_limit' | 'capture_failed';

export interface BrowserPageRecordingOptions {
  maxSteps: number;
  onMutation(mutation: BrowserRecordingMutation): void | Promise<void>;
  onStopRequested(): void | Promise<void>;
  onTerminated(reason: BrowserRecordingTerminationReason): void | Promise<void>;
}

export interface BrowserDriverPage {
  readonly pageId?: string;
  isClosed(): boolean;
  execute(
    action: BrowserAction,
    options: BrowserPageExecutionOptions,
  ): Promise<BrowserPageExecutionResult>;
  startRecording?(options: BrowserPageRecordingOptions): Promise<void>;
  stopRecording?(): Promise<void>;
  onClosed?(listener: () => void): () => void;
  close(): Promise<void>;
}

export interface BrowserDriverSession {
  browserKind: SystemBrowserKind;
  executablePath: string;
  profileDirectory: string;
  cdpEndpoint: string;
  isConnected(): boolean;
  newPage(): Promise<BrowserDriverPage>;
  findPage?(pageId: string): Promise<BrowserDriverPage | undefined>;
  listSiteData?(knownOrigins?: readonly string[]): Promise<BrowserProfileSiteDataSnapshot>;
  clearSiteData?(
    siteKey: string,
    knownOrigins?: readonly string[],
  ): Promise<BrowserProfileSiteClearResult>;
  close(options?: { preserve?: boolean }): Promise<void>;
}

export interface BrowserSessionFactoryInput {
  profileId: string;
  profileRoot: string;
  profileDirectory: string;
  executablePath?: string;
  connectTimeoutMs: number;
  recoverOnly?: boolean;
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
  extends WorkerJobOutput, BrowserPageExecutionResult, BrowserLeaseInfo {
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
  acquireLease(input: {
    profileId: string;
    ownerId: string;
    mode?: 'command' | 'recording';
  }): Promise<BrowserLeaseInfo>;
  inspectLease(leaseId: string): Promise<BrowserLeaseInfo>;
  recoverLease?(input: BrowserLeaseInfo): Promise<BrowserLeaseInfo>;
  execute(input: BrowserHostExecuteInput): Promise<BrowserCommandResult>;
  startRecording?(input: {
    leaseId: string;
    startUrl?: string;
    maxSteps: number;
    onMutation(mutation: BrowserRecordingMutation): void | Promise<void>;
    onStopRequested(): void | Promise<void>;
    onTerminated(reason: BrowserRecordingTerminationReason): void | Promise<void>;
  }): Promise<void>;
  stopRecording?(leaseId: string): Promise<void>;
  releaseLease(leaseId: string, options?: { closePage?: boolean }): Promise<void>;
  listProfileSiteData?(input: {
    profileId: string;
    knownOrigins?: readonly string[];
  }): Promise<BrowserProfileSiteDataSnapshot>;
  clearProfileSiteData?(input: {
    profileId: string;
    siteKey: string;
    knownOrigins?: readonly string[];
  }): Promise<BrowserProfileSiteClearResult>;
  deleteProfileData?(profileId: string): Promise<void>;
  closeProfileSession?(profileId: string): Promise<void>;
  hasActiveProfileLeases?(profileId: string): boolean;
  shutdown(options?: { preserveSessions?: boolean }): Promise<void>;
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
  mode: 'command' | 'recording';
  removeCloseListener?: () => void;
}

export class BrowserHost implements BrowserHostLike {
  private readonly profileRoot: string;
  private readonly connectTimeoutMs: number;
  private readonly sessionFactory: BrowserSessionFactory;
  private readonly sessions = new Map<string, Promise<ManagedSession>>();
  private readonly leases = new Map<string, ManagedLease>();
  private readonly ownerLeases = new Map<string, Promise<ManagedLease>>();
  private readonly recoveringLeases = new Map<string, Promise<ManagedLease>>();
  private readonly leaseReleases = new Map<string, { profileId: string; pending: Promise<void> }>();
  private readonly recordingClaims = new Map<string, string | symbol>();
  private readonly recordingTerminations = new Map<
    string,
    (reason: BrowserRecordingTerminationReason) => void | Promise<void>
  >();
  private shuttingDown = false;
  private readonly profileMaintenance = new Map<string, Promise<void>>();

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

  async acquireLease(input: {
    profileId: string;
    ownerId: string;
    mode?: 'command' | 'recording';
  }): Promise<BrowserLeaseInfo> {
    const profileId = normalizeIdentifier(input.profileId, 'profileId');
    const ownerId = normalizeOwnerId(input.ownerId);
    const mode = input.mode ?? 'command';
    const ownerKey = `${profileId}\0${ownerId}`;
    let recordingReservation: symbol | undefined;

    while (true) {
      const maintenance = this.profileMaintenance.get(profileId);
      if (maintenance) {
        await maintenance.catch(() => undefined);
        continue;
      }
      if (this.shuttingDown) {
        throw new BrowserHostError('browser.host-shutting-down', 'Browser Host is shutting down');
      }
      if (mode === 'recording') {
        if (this.recordingClaims.has(profileId) || this.hasActiveProfileLeases(profileId)) {
          throw new BrowserHostError(
            'browser.profile-in-use',
            'Browser Profile is already in use',
            'acceptance',
          );
        }
        recordingReservation = Symbol(profileId);
        this.recordingClaims.set(profileId, recordingReservation);
      } else if (this.recordingClaims.has(profileId)) {
        throw new BrowserHostError(
          'browser.profile-in-use',
          'Browser Profile is reserved by an active recording',
          'acceptance',
        );
      }
      const existingPromise = this.ownerLeases.get(ownerKey);
      if (existingPromise) {
        if (mode === 'recording') {
          if (this.recordingClaims.get(profileId) === recordingReservation) {
            this.recordingClaims.delete(profileId);
          }
          throw new BrowserHostError(
            'browser.profile-in-use',
            'Browser recording requires an unused Profile',
            'acceptance',
          );
        }
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

      const pending = this.createLease(profileId, ownerId, mode);
      this.ownerLeases.set(ownerKey, pending);
      try {
        const lease = await pending;
        if (mode === 'recording') {
          if (this.recordingClaims.get(profileId) !== recordingReservation) {
            await lease.page.close().catch(() => undefined);
            throw new BrowserHostError(
              'browser.recording-claim-lost',
              'Browser recording Profile claim was lost',
              'crashed',
            );
          }
          this.recordingClaims.set(profileId, lease.leaseId);
        }
        return leaseInfo(lease);
      } catch (error) {
        if (this.ownerLeases.get(ownerKey) === pending) this.ownerLeases.delete(ownerKey);
        if (mode === 'recording' && this.recordingClaims.get(profileId) === recordingReservation) {
          this.recordingClaims.delete(profileId);
        }
        throw error;
      }
    }
  }

  async inspectLease(leaseId: string): Promise<BrowserLeaseInfo> {
    const lease = this.leases.get(leaseId);
    if (!lease || lease.page.isClosed()) {
      throw new BrowserHostError(
        'browser.lease-not-found',
        'Browser Page lease is missing or closed',
        'crashed',
      );
    }
    const session = await this.sessions.get(lease.profileId)?.catch(() => undefined);
    if (
      !session ||
      !session.driver.isConnected() ||
      this.leases.get(leaseId) !== lease ||
      lease.page.isClosed()
    ) {
      throw new BrowserHostError(
        'browser.lease-not-found',
        'Browser Page lease is missing or closed',
        'crashed',
      );
    }
    return leaseInfo(lease);
  }

  async recoverLease(input: BrowserLeaseInfo): Promise<BrowserLeaseInfo> {
    const expected = normalizeLeaseInfo(input);
    const existing = this.leases.get(expected.leaseId);
    if (existing) {
      assertLeaseIdentity(existing, expected);
      return this.inspectLease(expected.leaseId);
    }
    const pendingExisting = this.recoveringLeases.get(expected.leaseId);
    if (pendingExisting) return leaseInfo(await pendingExisting);
    if (this.shuttingDown) {
      throw new BrowserHostError('browser.host-shutting-down', 'Browser Host is shutting down');
    }

    const pending = this.withProfileMaintenance(expected.profileId, () =>
      this.recoverLeaseInternal(expected),
    );
    this.recoveringLeases.set(expected.leaseId, pending);
    try {
      return leaseInfo(await pending);
    } finally {
      if (this.recoveringLeases.get(expected.leaseId) === pending) {
        this.recoveringLeases.delete(expected.leaseId);
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
          maxOutputBytes: clamp(input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 1, 1024 * 1024),
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

  async startRecording(input: {
    leaseId: string;
    startUrl?: string;
    maxSteps: number;
    onMutation(mutation: BrowserRecordingMutation): void | Promise<void>;
    onStopRequested(): void | Promise<void>;
    onTerminated(reason: BrowserRecordingTerminationReason): void | Promise<void>;
  }): Promise<void> {
    const lease = this.leases.get(input.leaseId);
    if (!lease || lease.page.isClosed()) {
      throw new BrowserHostError(
        'browser.lease-not-found',
        'Browser recording Page lease is missing or closed',
        'crashed',
      );
    }
    if (lease.mode !== 'recording' || this.recordingClaims.get(lease.profileId) !== lease.leaseId) {
      throw new BrowserHostError(
        'browser.recording-lease-required',
        'Browser recording requires an exclusive recording lease',
        'acceptance',
      );
    }
    if (!lease.page.startRecording || !lease.page.stopRecording) {
      throw new BrowserHostError(
        'browser.recording-unsupported',
        'Browser driver does not support semantic recording',
        'acceptance',
      );
    }
    if (
      !Number.isSafeInteger(input.maxSteps) ||
      input.maxSteps < 1 ||
      input.maxSteps > BROWSER_RECORDING_MAX_STEPS
    ) {
      throw new BrowserHostError(
        'browser.recording-step-limit-invalid',
        'Browser recording step limit is invalid',
        'acceptance',
      );
    }
    if (this.recordingTerminations.has(lease.leaseId)) {
      throw new BrowserHostError(
        'browser.recording-already-started',
        'Browser recording is already active on this Page',
        'acceptance',
      );
    }
    const startUrl = input.startUrl ? sanitizeBrowserRecordingUrl(input.startUrl) : undefined;
    const terminate = async (reason: BrowserRecordingTerminationReason) => {
      if (this.recordingTerminations.get(lease.leaseId) !== terminate) return;
      this.recordingTerminations.delete(lease.leaseId);
      await input.onTerminated(reason);
    };
    this.recordingTerminations.set(lease.leaseId, terminate);
    const start = lease.tail.then(async () => {
      try {
        await lease.page.startRecording!({
          maxSteps: input.maxSteps,
          onMutation: async (mutation) => {
            if (this.recordingTerminations.get(lease.leaseId) !== terminate) return;
            await input.onMutation(normalizeBrowserRecordingMutation(mutation));
          },
          onStopRequested: () => {
            if (this.recordingTerminations.get(lease.leaseId) !== terminate) return;
            void Promise.resolve(input.onStopRequested()).catch(() => undefined);
          },
          onTerminated: terminate,
        });
        if (startUrl) {
          await executePageWithDeadline(
            lease.page,
            { kind: 'navigate', url: startUrl },
            {
              allowedOrigins: new Set([new URL(startUrl).origin.toLowerCase()]),
              timeoutMs: 30_000,
              maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
            },
          );
        }
      } catch (error) {
        this.recordingTerminations.delete(lease.leaseId);
        await lease.page.stopRecording?.().catch(() => undefined);
        throw normalizeBrowserError(error);
      }
    });
    lease.tail = start.then(
      () => undefined,
      () => undefined,
    );
    await start;
  }

  async stopRecording(leaseId: string): Promise<void> {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    if (lease.mode !== 'recording') {
      throw new BrowserHostError(
        'browser.recording-lease-required',
        'The Page lease is not owned by a recording',
        'acceptance',
      );
    }
    const stop = lease.tail.then(async () => {
      await lease.page.stopRecording?.();
      this.recordingTerminations.delete(leaseId);
    });
    lease.tail = stop.then(
      () => undefined,
      () => undefined,
    );
    await stop;
  }

  async releaseLease(leaseId: string, options?: { closePage?: boolean }): Promise<void> {
    const existingRelease = this.leaseReleases.get(leaseId);
    if (existingRelease) {
      await existingRelease.pending;
      return;
    }
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    const pending = (async () => {
      this.recordingTerminations.delete(leaseId);
      lease.removeCloseListener?.();
      lease.removeCloseListener = undefined;
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
      if (this.recordingClaims.get(lease.profileId) === leaseId) {
        this.recordingClaims.delete(lease.profileId);
      }
      await lease.tail;
      if (options?.closePage !== false && !lease.page.isClosed()) await lease.page.close();
    })();
    this.leaseReleases.set(leaseId, { profileId: lease.profileId, pending });
    try {
      await pending;
    } finally {
      if (this.leaseReleases.get(leaseId)?.pending === pending) {
        this.leaseReleases.delete(leaseId);
      }
    }
  }

  hasActiveProfileLeases(profileId: string): boolean {
    const normalized = normalizeIdentifier(profileId, 'profileId');
    for (const lease of this.leases.values()) {
      if (lease.profileId === normalized && !lease.page.isClosed()) return true;
    }
    for (const key of this.ownerLeases.keys()) {
      if (key.startsWith(`${normalized}\0`)) return true;
    }
    for (const release of this.leaseReleases.values()) {
      if (release.profileId === normalized) return true;
    }
    return false;
  }

  async listProfileSiteData(input: {
    profileId: string;
    knownOrigins?: readonly string[];
  }): Promise<BrowserProfileSiteDataSnapshot> {
    const profileId = normalizeIdentifier(input.profileId, 'profileId');
    const knownOrigins = normalizeKnownOrigins(input.knownOrigins);
    return this.withProfileMaintenance(profileId, async () => {
      if (this.hasActiveProfileLeases(profileId)) {
        throw new BrowserHostError(
          'browser.profile-in-use',
          'Browser Profile has an active Page lease',
          'acceptance',
        );
      }
      const session = await this.getSession(profileId);
      if (!session.driver.listSiteData) {
        throw new BrowserHostError(
          'browser.profile-site-data-unsupported',
          'Browser driver does not support Profile site-data inspection',
        );
      }
      const snapshot = await session.driver.listSiteData(knownOrigins);
      return { ...snapshot, profileId };
    });
  }

  async clearProfileSiteData(input: {
    profileId: string;
    siteKey: string;
    knownOrigins?: readonly string[];
  }): Promise<BrowserProfileSiteClearResult> {
    const profileId = normalizeIdentifier(input.profileId, 'profileId');
    const siteKey = resolveBrowserSiteKey(input.siteKey);
    const knownOrigins = normalizeKnownOrigins(input.knownOrigins);
    return this.withProfileMaintenance(profileId, async () => {
      if (this.hasActiveProfileLeases(profileId)) {
        throw new BrowserHostError(
          'browser.profile-in-use',
          'Browser Profile has an active Page lease',
          'acceptance',
        );
      }
      const session = await this.getSession(profileId);
      if (session.leases.size > 0 || this.hasActiveProfileLeases(profileId)) {
        throw new BrowserHostError(
          'browser.profile-in-use',
          'Browser Profile has an active Page lease',
          'acceptance',
        );
      }
      if (!session.driver.clearSiteData) {
        throw new BrowserHostError(
          'browser.profile-site-clear-unsupported',
          'Browser driver does not support Profile site-data clearing',
        );
      }
      return session.driver.clearSiteData(siteKey, knownOrigins);
    });
  }

  async deleteProfileData(profileIdInput: string): Promise<void> {
    const profileId = normalizeIdentifier(profileIdInput, 'profileId');
    if (profileId === 'default') {
      throw new BrowserHostError(
        'browser.default-profile-immutable',
        'The default Browser Profile cannot be deleted',
        'acceptance',
      );
    }
    await this.withProfileMaintenance(profileId, async () => {
      if (this.hasActiveProfileLeases(profileId)) {
        throw new BrowserHostError(
          'browser.profile-in-use',
          'Browser Profile has an active Page lease',
          'acceptance',
        );
      }
      let session = await this.sessions.get(profileId)?.catch(() => undefined);
      if (!session) {
        try {
          session = await this.getSession(profileId, { recoverOnly: true });
        } catch (error) {
          if (!(error instanceof BrowserHostError) || error.code !== 'browser.session-not-found') {
            throw error;
          }
        }
      }
      if (session?.leases.size) {
        throw new BrowserHostError(
          'browser.profile-in-use',
          'Browser Profile has an active Page lease',
          'acceptance',
        );
      }
      if (session) {
        await session.driver.close();
        this.sessions.delete(profileId);
      }
      const profileDirectory = resolveBrowserProfileDirectory(this.profileRoot, profileId);
      const existingProfile = await lstat(profileDirectory).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      });
      if (!existingProfile) return;
      await ensureSafeBrowserProfileDirectory(this.profileRoot, profileId);
      const [realRoot, realProfile] = await Promise.all([
        realpath(this.profileRoot),
        realpath(profileDirectory),
      ]);
      if (!isPathInside(realProfile, realRoot)) {
        throw new BrowserHostError(
          'browser.profile-path-invalid',
          'Browser Profile directory escaped its configured root',
          'permission',
        );
      }
      await rm(realProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
  }

  async closeProfileSession(profileIdInput: string): Promise<void> {
    const profileId = normalizeIdentifier(profileIdInput, 'profileId');
    await this.withProfileMaintenance(profileId, async () => {
      if (this.hasActiveProfileLeases(profileId)) {
        throw new BrowserHostError(
          'browser.profile-in-use',
          'Browser Profile has an active Page lease',
          'acceptance',
        );
      }
      let session = await this.sessions.get(profileId)?.catch(() => undefined);
      if (!session) {
        try {
          session = await this.getSession(profileId, { recoverOnly: true });
        } catch (error) {
          if (error instanceof BrowserHostError && error.code === 'browser.session-not-found') {
            return;
          }
          throw error;
        }
      }
      await session.driver.close();
      this.sessions.delete(profileId);
      this.recordingClaims.delete(profileId);
    });
  }

  async shutdown(options: { preserveSessions?: boolean } = {}): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    await Promise.allSettled([
      ...this.ownerLeases.values(),
      ...this.recoveringLeases.values(),
      ...[...this.leaseReleases.values()].map((release) => release.pending),
    ]);
    const preserveSessions = options.preserveSessions === true;
    if (preserveSessions) {
      await Promise.allSettled([...this.leases.values()].map((lease) => lease.tail));
      this.leases.clear();
    } else {
      const leaseIds = [...this.leases.keys()];
      await Promise.allSettled(leaseIds.map((leaseId) => this.releaseLease(leaseId)));
    }
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    this.ownerLeases.clear();
    this.recoveringLeases.clear();
    this.recordingClaims.clear();
    this.recordingTerminations.clear();
    await Promise.allSettled(
      sessions.map(async (sessionPromise) =>
        (await sessionPromise).driver.close({ preserve: preserveSessions }),
      ),
    );
  }

  private async recoverLeaseInternal(expected: BrowserLeaseInfo): Promise<ManagedLease> {
    const ownerKey = `${expected.profileId}\0${expected.ownerId}`;
    const ownerPromise = this.ownerLeases.get(ownerKey);
    if (ownerPromise) {
      const ownerLease = await ownerPromise;
      assertLeaseIdentity(ownerLease, expected);
      return ownerLease;
    }
    for (const lease of this.leases.values()) {
      if (lease.pageId === expected.pageId) {
        assertLeaseIdentity(lease, expected);
        return lease;
      }
    }

    const session = await this.getSession(expected.profileId, { recoverOnly: true });
    if (!session.driver.findPage) {
      throw new BrowserHostError(
        'browser.lease-recovery-unsupported',
        'Browser driver cannot recover an existing Page lease',
        'crashed',
      );
    }
    const page = await session.driver.findPage(expected.pageId);
    if (!page || page.isClosed()) {
      throw new BrowserHostError(
        'browser.lease-not-found',
        'Persisted Browser Page is missing or closed',
        'crashed',
      );
    }
    if (page.pageId !== undefined && page.pageId !== expected.pageId) {
      throw new BrowserHostError(
        'browser.lease-identity-mismatch',
        'Recovered Browser Page identity does not match the persisted lease',
        'crashed',
      );
    }
    if (this.shuttingDown) {
      throw new BrowserHostError('browser.host-shutting-down', 'Browser Host is shutting down');
    }
    const mode = expected.ownerId.startsWith('recording:') ? 'recording' : 'command';
    if (mode === 'recording') {
      const existingClaim = this.recordingClaims.get(expected.profileId);
      if (existingClaim && existingClaim !== expected.leaseId) {
        throw new BrowserHostError(
          'browser.profile-in-use',
          'Browser Profile is reserved by another recording',
          'acceptance',
        );
      }
      this.recordingClaims.set(expected.profileId, expected.leaseId);
    }
    const lease: ManagedLease = { ...expected, page, tail: Promise.resolve(), mode };
    lease.removeCloseListener = page.onClosed?.(() => {
      void this.handleLeasePageClosed(lease);
    });
    session.leases.add(lease.leaseId);
    this.leases.set(lease.leaseId, lease);
    this.ownerLeases.set(ownerKey, Promise.resolve(lease));
    return lease;
  }

  private async createLease(
    profileId: string,
    ownerId: string,
    mode: 'command' | 'recording',
  ): Promise<ManagedLease> {
    const session = await this.getSession(profileId);
    const page = await session.driver.newPage();
    if (this.shuttingDown) {
      await page.close().catch(() => undefined);
      throw new BrowserHostError('browser.host-shutting-down', 'Browser Host is shutting down');
    }
    const lease: ManagedLease = {
      leaseId: randomUUID(),
      pageId: page.pageId ?? randomUUID(),
      profileId,
      ownerId,
      page,
      tail: Promise.resolve(),
      mode,
    };
    lease.removeCloseListener = page.onClosed?.(() => {
      void this.handleLeasePageClosed(lease);
    });
    session.leases.add(lease.leaseId);
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  private async handleLeasePageClosed(lease: ManagedLease): Promise<void> {
    if (this.leases.get(lease.leaseId) !== lease) return;
    this.leases.delete(lease.leaseId);
    const session = await this.sessions.get(lease.profileId)?.catch(() => undefined);
    session?.leases.delete(lease.leaseId);
    const ownerKey = `${lease.profileId}\0${lease.ownerId}`;
    const ownerPromise = this.ownerLeases.get(ownerKey);
    if (ownerPromise && (await ownerPromise.catch(() => undefined)) === lease) {
      if (this.ownerLeases.get(ownerKey) === ownerPromise) this.ownerLeases.delete(ownerKey);
    }
    if (this.recordingClaims.get(lease.profileId) === lease.leaseId) {
      this.recordingClaims.delete(lease.profileId);
    }
    const onTerminated = this.recordingTerminations.get(lease.leaseId);
    lease.removeCloseListener?.();
    lease.removeCloseListener = undefined;
    if (onTerminated) await onTerminated('page_closed');
    else this.recordingTerminations.delete(lease.leaseId);
  }

  private async getSession(
    profileId: string,
    options: { recoverOnly?: boolean } = {},
  ): Promise<ManagedSession> {
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
        recoverOnly: options.recoverOnly,
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

  private async withProfileMaintenance<T>(
    profileId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.profileMaintenance.get(profileId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const marker = previous.catch(() => undefined).then(() => gate);
    this.profileMaintenance.set(profileId, marker);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.profileMaintenance.get(profileId) === marker)
        this.profileMaintenance.delete(profileId);
    }
  }
}

export function sanitizeBrowserRecordingUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(String(value ?? '').trim());
  } catch {
    throw new BrowserHostError(
      'browser.recording-url-invalid',
      'Browser recording URL is invalid',
      'acceptance',
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BrowserHostError(
      'browser.recording-url-invalid',
      'Browser recording URL must use HTTP or HTTPS',
      'acceptance',
    );
  }
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  const sanitized = parsed.toString();
  if (sanitized.length > BROWSER_RECORDING_MAX_URL_CHARS) {
    throw new BrowserHostError(
      'browser.recording-url-too-long',
      'Browser recording URL exceeds the configured limit',
      'acceptance',
    );
  }
  return sanitized;
}

function normalizeBrowserRecordingMutation(
  mutation: BrowserRecordingMutation,
): BrowserRecordingMutation {
  if (mutation.type !== 'append' && mutation.type !== 'replace-last') {
    throw new BrowserHostError(
      'browser.recording-event-invalid',
      'Browser recording event type is invalid',
      'acceptance',
    );
  }
  const step = normalizeBrowserRecordingStep(mutation.step);
  if (Buffer.byteLength(JSON.stringify(step), 'utf8') > BROWSER_RECORDING_MAX_STEP_BYTES) {
    throw new BrowserHostError(
      'browser.recording-event-too-large',
      'Browser recording event exceeds the configured limit',
      'acceptance',
    );
  }
  return { type: mutation.type, step };
}

function normalizeBrowserRecordingStep(step: BrowserRecordingStepInput): BrowserRecordingStepInput {
  switch (step.kind) {
    case 'navigate':
      return { kind: 'navigate', url: sanitizeBrowserRecordingUrl(step.url) };
    case 'click':
      return {
        kind: 'click',
        locator: normalizeBrowserRecordingLocator(step.locator),
        ...(step.resultUrl ? { resultUrl: sanitizeBrowserRecordingUrl(step.resultUrl) } : {}),
      };
    case 'fill':
    case 'select':
      return {
        kind: step.kind,
        locator: normalizeBrowserRecordingLocator(step.locator),
        value: normalizeBrowserRecordingInputValue(step.value),
      };
    case 'check':
      return {
        kind: 'check',
        locator: normalizeBrowserRecordingLocator(step.locator),
        checked: step.checked === true,
      };
    case 'press':
      if (step.key !== 'Enter') {
        throw new BrowserHostError(
          'browser.recording-event-invalid',
          'Browser recording key is unsupported',
          'acceptance',
        );
      }
      return {
        kind: 'press',
        locator: normalizeBrowserRecordingLocator(step.locator),
        key: 'Enter',
        ...(step.resultUrl ? { resultUrl: sanitizeBrowserRecordingUrl(step.resultUrl) } : {}),
      };
  }
}

function normalizeBrowserRecordingLocator(
  locator: BrowserRecordingLocator,
): BrowserRecordingLocator {
  if (locator.strategy === 'role') {
    const role = normalizeBrowserRecordingLocatorText(locator.role);
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(role)) {
      throw new BrowserHostError(
        'browser.recording-locator-invalid',
        'Browser recording role locator is invalid',
        'acceptance',
      );
    }
    return {
      strategy: 'role',
      role,
      ...(locator.name ? { name: normalizeBrowserRecordingLocatorText(locator.name) } : {}),
    };
  }
  if (!['test-id', 'label', 'placeholder', 'id', 'name', 'css'].includes(locator.strategy)) {
    throw new BrowserHostError(
      'browser.recording-locator-invalid',
      'Browser recording locator strategy is invalid',
      'acceptance',
    );
  }
  return {
    strategy: locator.strategy,
    value: normalizeBrowserRecordingLocatorText(locator.value),
  };
}

function normalizeBrowserRecordingLocatorText(value: string): string {
  const normalized = String(value ?? '').trim();
  if (
    !normalized ||
    normalized.length > BROWSER_RECORDING_MAX_LOCATOR_CHARS ||
    hasDisallowedAsciiControlCharacter(normalized)
  ) {
    throw new BrowserHostError(
      'browser.recording-locator-invalid',
      'Browser recording locator is invalid',
      'acceptance',
    );
  }
  return normalized;
}

function normalizeBrowserRecordingText(value: string): string {
  const text = String(value ?? '');
  if (
    text.length > BROWSER_RECORDING_MAX_TEXT_CHARS ||
    hasDisallowedAsciiControlCharacter(text, true)
  ) {
    throw new BrowserHostError(
      'browser.recording-value-invalid',
      'Browser recording input value is invalid',
      'acceptance',
    );
  }
  return text;
}

function normalizeBrowserRecordingInputValue(
  value: BrowserRecordingInputValue,
): BrowserRecordingInputValue {
  if (value.kind === 'secret') return { kind: 'secret' };
  if (value.kind === 'variable') {
    const name = String(value.name ?? '').trim();
    if (!name || name.length > BROWSER_RECORDING_MAX_LOCATOR_CHARS) {
      throw new BrowserHostError(
        'browser.recording-variable-invalid',
        'Browser recording variable name is invalid',
        'acceptance',
      );
    }
    return { kind: 'variable', name };
  }
  return { kind: 'literal', value: normalizeBrowserRecordingText(value.value) };
}

function hasDisallowedAsciiControlCharacter(value: string, allowTextWhitespace = false): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    if (code === 0x7f) return true;
    if (code > 0x1f) return false;
    return !allowTextWhitespace || (code !== 0x09 && code !== 0x0a && code !== 0x0d);
  });
}

export function resolveBrowserSiteKey(value: string): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/^\.+/, '');
  if (!raw) {
    throw new BrowserHostError(
      'browser.site-key-invalid',
      'Browser site key is empty',
      'acceptance',
    );
  }
  let hostname: string;
  try {
    const bareHost = raw.replace(/^\[|\]$/gu, '');
    if (isIP(bareHost) === 6) {
      hostname = bareHost.toLowerCase();
    } else {
      const parsed = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
      if (parsed.username || parsed.password) throw new Error('credentials are not allowed');
      hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    }
  } catch {
    throw new BrowserHostError(
      'browser.site-key-invalid',
      'Browser site key is invalid',
      'acceptance',
    );
  }
  if (hostname === 'localhost' || isIP(hostname) !== 0) return hostname;
  return getDomain(hostname, { allowPrivateDomains: true })?.toLowerCase() ?? hostname;
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

const MAX_PROFILE_ORIGINS = 512;

type ProfileSiteDataContext = Pick<
  BrowserContext,
  'cookies' | 'clearCookies' | 'pages' | 'newPage' | 'newCDPSession'
>;

/**
 * Builds the bounded set of origins that may contain Profile site data.
 *
 * Chromium does not expose an origin inventory through the Cookie API. Known
 * origins persisted by Runtime, currently open Page targets, and the exact
 * domains represented by cookies are the deliberately bounded inventory we
 * can query without exporting LocalStorage/IndexedDB values into memory.
 */
export function buildBrowserProfileOriginInventory(
  knownOrigins: readonly string[] | undefined,
  pageUrls: readonly string[],
  cookies: readonly Pick<Cookie, 'domain' | 'secure'>[],
): string[] {
  const origins = new Set(normalizeKnownOrigins(knownOrigins));
  for (const pageUrl of pageUrls) addBoundedProfileOrigin(origins, pageUrl);
  for (const cookie of cookies) {
    for (const origin of cookieDomainOrigins(cookie.domain, cookie.secure)) {
      addBoundedProfileOrigin(origins, origin);
    }
  }
  return [...origins].sort();
}

function addBoundedProfileOrigin(origins: Set<string>, value: string): void {
  const origin = httpOrigin(value);
  if (!origin || origins.has(origin)) return;
  if (origins.size >= MAX_PROFILE_ORIGINS) {
    throw new BrowserHostError(
      'browser.profile-origins-too-many',
      `Browser Profile origin inventory exceeds ${MAX_PROFILE_ORIGINS} entries`,
      'acceptance',
    );
  }
  origins.add(origin);
}

function cookieDomainOrigins(domainInput: string, secure: boolean): string[] {
  const host = normalizeCookieDomain(domainInput);
  if (!host) return [];
  // A Secure cookie proves HTTPS. A non-Secure cookie may have been created
  // on either scheme, so probe both without enumerating arbitrary origins.
  const schemes = secure ? ['https:'] : ['http:', 'https:'];
  const urlHost = isIP(host) === 6 ? `[${host}]` : host;
  return schemes
    .map((scheme) => httpOrigin(`${scheme}//${urlHost}`))
    .filter((origin): origin is string => Boolean(origin));
}

function normalizeCookieDomain(value: unknown): string | undefined {
  const host = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/u, '')
    .replace(/\.+$/u, '');
  if (!host || host.length > 253 || host.includes('\0') || /\s/u.test(host)) return undefined;
  if (isIP(host) === 0 && host.includes(':')) return undefined;
  const urlHost = isIP(host) === 6 ? `[${host}]` : host;
  try {
    const parsed = new URL(`https://${urlHost}`);
    if (parsed.username || parsed.password || parsed.port || parsed.pathname !== '/') {
      return undefined;
    }
    const normalized = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    return normalized || undefined;
  } catch {
    return undefined;
  }
}

function normalizeKnownOrigins(origins: readonly string[] | undefined): string[] {
  if (!origins) return [];
  if (origins.length > MAX_PROFILE_ORIGINS) {
    throw new BrowserHostError(
      'browser.profile-origins-too-many',
      `Browser Profile origin inventory exceeds ${MAX_PROFILE_ORIGINS} entries`,
      'acceptance',
    );
  }
  const normalized = new Set<string>();
  for (const value of origins) {
    if (typeof value !== 'string' || value.length > 8_192 || value.includes('\0')) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        normalized.add(parsed.origin.toLowerCase());
      }
    } catch {
      // Historical malformed origins are ignored rather than widening the clear scope.
    }
  }
  return [...normalized].sort();
}

function leaseInfo(lease: ManagedLease): BrowserLeaseInfo {
  return {
    leaseId: lease.leaseId,
    pageId: lease.pageId,
    profileId: lease.profileId,
    ownerId: lease.ownerId,
  };
}

function normalizeLeaseInfo(input: BrowserLeaseInfo): BrowserLeaseInfo {
  return {
    leaseId: normalizeIdentifier(input.leaseId, 'leaseId'),
    pageId: normalizeIdentifier(input.pageId, 'pageId'),
    profileId: normalizeIdentifier(input.profileId, 'profileId'),
    ownerId: normalizeOwnerId(input.ownerId),
  };
}

function assertLeaseIdentity(actual: BrowserLeaseInfo, expected: BrowserLeaseInfo): void {
  if (
    actual.leaseId !== expected.leaseId ||
    actual.pageId !== expected.pageId ||
    actual.profileId !== expected.profileId ||
    actual.ownerId !== expected.ownerId
  ) {
    throw new BrowserHostError(
      'browser.lease-identity-mismatch',
      'Browser Page lease identity does not match the persisted checkpoint',
      'crashed',
    );
  }
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
      const hasText =
        typeof action.text === 'string' &&
        action.text.trim().length > 0 &&
        action.text.length <= 500 &&
        !action.text.includes('\0');
      const hasCoordinates =
        Number.isFinite(action.x) &&
        Number.isFinite(action.y) &&
        action.x! >= 0 &&
        action.y! >= 0 &&
        action.x! <= 100_000 &&
        action.y! <= 100_000;
      valid = (selectorProvided ? hasSelector : false) || hasCoordinates || hasText;
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
    interrupt(
      new BrowserHostError('browser.aborted', 'Browser action was cancelled', 'acceptance'),
    );
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
    add('chrome', env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe');
    add('chrome', env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe');
    add('chrome', env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe');
    add('edge', env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    add('edge', env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    add('edge', env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  } else if (platform === 'darwin') {
    candidates.push(
      {
        kind: 'chrome',
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      },
      {
        kind: 'edge',
        executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      },
    );
  } else {
    candidates.push(
      { kind: 'chrome', executablePath: '/usr/bin/google-chrome' },
      { kind: 'chrome', executablePath: '/usr/bin/google-chrome-stable' },
      { kind: 'chrome', executablePath: '/usr/bin/chromium' },
      { kind: 'chrome', executablePath: '/usr/bin/chromium-browser' },
      { kind: 'edge', executablePath: '/usr/bin/microsoft-edge' },
      { kind: 'edge', executablePath: '/usr/bin/microsoft-edge-stable' },
    );
  }
  return candidates;
}

const BROWSER_SESSION_METADATA_FILE = '.sync-think-cdp-session.json';

interface BrowserSessionMetadata {
  version: 1;
  profileId: string;
  browserKind: SystemBrowserKind;
  executablePath: string;
  cdpEndpoint: string;
}

async function launchPlaywrightCdpSession(
  input: BrowserSessionFactoryInput,
): Promise<BrowserDriverSession> {
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
  const metadataPath = join(input.profileDirectory, BROWSER_SESSION_METADATA_FILE);
  const metadata = await readBrowserSessionMetadata(metadataPath, input.profileId);
  if (metadata) {
    try {
      return await connectPlaywrightCdpSession(
        metadata,
        input.profileDirectory,
        metadataPath,
        input.connectTimeoutMs,
      );
    } catch {
      await unlink(metadataPath).catch(() => undefined);
    }
  }
  if (input.recoverOnly) {
    throw new BrowserHostError(
      'browser.session-not-found',
      'Persisted system browser session is unavailable',
      'crashed',
    );
  }

  const installation = discoverSystemBrowser({ executablePath: input.executablePath });
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
      // The system browser must survive a Runtime process restart while a durable
      // browser handoff is waiting. BrowserHost still closes it explicitly when
      // no session preservation is requested.
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    },
  );
  child.unref();
  try {
    await waitForCdp(endpoint, child, input.connectTimeoutMs);
    const browser = await chromium.connectOverCDP(endpoint, { timeout: input.connectTimeoutMs });
    const context = browser.contexts()[0];
    if (!context) {
      throw new BrowserHostError(
        'browser.context-missing',
        'System browser exposed no default CDP context',
        'crashed',
      );
    }
    const session = new PlaywrightCdpSession(
      installation,
      input.profileId,
      input.profileDirectory,
      endpoint,
      metadataPath,
      child,
      browser,
      context,
    );
    await session.initialize();
    await writeBrowserSessionMetadata(metadataPath, {
      version: 1,
      profileId: input.profileId,
      browserKind: installation.kind,
      executablePath: installation.executablePath,
      cdpEndpoint: endpoint,
    });
    return session;
  } catch (error) {
    await unlink(metadataPath).catch(() => undefined);
    terminateOwnedBrowser(child);
    throw error;
  }
}

async function connectPlaywrightCdpSession(
  metadata: BrowserSessionMetadata,
  profileDirectory: string,
  metadataPath: string,
  connectTimeoutMs: number,
): Promise<BrowserDriverSession> {
  const browser = await chromium.connectOverCDP(metadata.cdpEndpoint, {
    timeout: connectTimeoutMs,
  });
  const context = browser.contexts()[0];
  if (!context) {
    throw new BrowserHostError(
      'browser.context-missing',
      'Persisted system browser exposed no default CDP context',
      'crashed',
    );
  }
  const session = new PlaywrightCdpSession(
    { kind: metadata.browserKind, executablePath: metadata.executablePath },
    metadata.profileId,
    profileDirectory,
    metadata.cdpEndpoint,
    metadataPath,
    undefined,
    browser,
    context,
  );
  await session.initialize();
  return session;
}

async function readBrowserSessionMetadata(
  metadataPath: string,
  expectedProfileId: string,
): Promise<BrowserSessionMetadata | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(metadataPath, 'utf8'),
    ) as Partial<BrowserSessionMetadata>;
    if (
      parsed.version !== 1 ||
      parsed.profileId !== expectedProfileId ||
      (parsed.browserKind !== 'edge' && parsed.browserKind !== 'chrome') ||
      typeof parsed.executablePath !== 'string' ||
      !isLoopbackCdpEndpoint(parsed.cdpEndpoint)
    ) {
      await unlink(metadataPath).catch(() => undefined);
      return undefined;
    }
    return parsed as BrowserSessionMetadata;
  } catch {
    await unlink(metadataPath).catch(() => undefined);
    return undefined;
  }
}

async function writeBrowserSessionMetadata(
  metadataPath: string,
  metadata: BrowserSessionMetadata,
): Promise<void> {
  const temporaryPath = `${metadataPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(metadata), { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(temporaryPath, metadataPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function isLoopbackCdpEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const endpoint = new URL(value);
    return (
      endpoint.protocol === 'http:' &&
      endpoint.hostname === '127.0.0.1' &&
      endpoint.pathname === '/' &&
      endpoint.search === '' &&
      endpoint.hash === '' &&
      Number.isInteger(Number(endpoint.port)) &&
      Number(endpoint.port) >= 1 &&
      Number(endpoint.port) <= 65_535
    );
  } catch {
    return false;
  }
}

export async function withProfilePageCdpSession<T>(
  context: Pick<BrowserContext, 'pages' | 'newPage' | 'newCDPSession'>,
  operation: (session: CDPSession) => Promise<T>,
): Promise<T> {
  let page = context.pages().find((candidate) => !candidate.isClosed());
  const temporaryPage = !page;
  page ??= await context.newPage();
  let session: CDPSession | undefined;
  try {
    session = await context.newCDPSession(page);
    return await operation(session);
  } finally {
    await session?.detach().catch(() => undefined);
    if (temporaryPage) await page.close().catch(() => undefined);
  }
}

interface CdpStorageUsageBreakdown {
  storageType?: unknown;
  usage?: unknown;
}

interface CdpStorageUsage {
  usage?: unknown;
  usageBreakdown?: readonly CdpStorageUsageBreakdown[];
}

/**
 * Reads only aggregate storage usage from the Page target. Storage values are
 * intentionally never materialized through a BrowserContext state snapshot.
 */
export async function inspectBrowserProfileSiteData(
  context: ProfileSiteDataContext,
  profileId: string,
  knownOrigins: readonly string[] = [],
): Promise<BrowserProfileSiteDataSnapshot> {
  const checkedAt = new Date().toISOString();
  const cookies = await context.cookies();
  const groups = new Map<
    string,
    {
      origins: Set<string>;
      cookieCount: number;
      storageBytes: number;
      storageTypes: Set<string>;
    }
  >();
  const groupFor = (hostOrUrl: string) => {
    const siteKey = resolveBrowserSiteKey(hostOrUrl);
    let group = groups.get(siteKey);
    if (!group) {
      group = {
        origins: new Set<string>(),
        cookieCount: 0,
        storageBytes: 0,
        storageTypes: new Set<string>(),
      };
      groups.set(siteKey, group);
    }
    return { siteKey, group };
  };

  for (const cookie of cookies) {
    const domain = normalizeCookieDomain(cookie.domain);
    if (!domain) continue;
    const { group } = groupFor(domain);
    group.cookieCount += 1;
    group.storageTypes.add('cookies');
  }

  const origins = buildBrowserProfileOriginInventory(
    knownOrigins,
    context
      .pages()
      .filter((page) => !page.isClosed())
      .map((page) => page.url()),
    cookies,
  );

  await withProfilePageCdpSession(context, async (pageSession) => {
    for (const origin of origins) {
      const { group } = groupFor(origin);
      group.origins.add(origin);
      const usage = (await pageSession
        .send('Storage.getUsageAndQuota', { origin })
        .catch(() => undefined)) as CdpStorageUsage | undefined;
      if (!usage) continue;
      const bytes = Number(usage.usage);
      if (Number.isFinite(bytes) && bytes > 0) {
        group.storageBytes += Math.max(0, Math.round(bytes));
      }
      for (const item of usage.usageBreakdown ?? []) {
        const itemUsage = Number(item.usage);
        const storageType = normalizeCdpStorageType(item.storageType);
        if (storageType && Number.isFinite(itemUsage) && itemUsage > 0) {
          group.storageTypes.add(storageType);
        }
      }
    }
  });

  return {
    profileId,
    checkedAt,
    sites: [...groups.entries()]
      .filter(
        ([, group]) =>
          group.cookieCount > 0 || group.storageBytes > 0 || group.storageTypes.size > 0,
      )
      .map(([siteKey, group]) => ({
        siteKey,
        origins: [...group.origins].sort(),
        cookieCount: group.cookieCount,
        storageBytes: group.storageBytes,
        storageTypes: [...group.storageTypes].sort(),
      }))
      .sort((left, right) => left.siteKey.localeCompare(right.siteKey)),
  };
}

export async function clearBrowserProfileSiteData(
  context: ProfileSiteDataContext,
  profileId: string,
  siteKeyInput: string,
  knownOrigins: readonly string[] = [],
): Promise<BrowserProfileSiteClearResult> {
  const siteKey = resolveBrowserSiteKey(siteKeyInput);
  const cookies = await context.cookies();
  const matchingCookies = cookies.filter((cookie) => {
    const domain = normalizeCookieDomain(cookie.domain);
    return domain ? hostMatchesSite(domain, siteKey) : false;
  });
  const origins = buildBrowserProfileOriginInventory(
    knownOrigins,
    context
      .pages()
      .filter((page) => !page.isClosed())
      .map((page) => page.url()),
    cookies,
  );
  for (const page of context.pages()) {
    if (page.isClosed()) continue;
    const origin = httpOrigin(page.url());
    if (!origin || !hostMatchesSite(new URL(origin).hostname, siteKey)) continue;
    await page.goto('about:blank', { waitUntil: 'commit', timeout: 5_000 }).catch(() => undefined);
  }
  const clearedOrigins = origins
    .filter((origin) => hostMatchesSite(new URL(origin).hostname, siteKey))
    .sort();

  for (const cookie of matchingCookies) {
    await context.clearCookies({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
    });
  }
  await withProfilePageCdpSession(context, async (pageSession) => {
    for (const origin of clearedOrigins) {
      await pageSession.send('Storage.clearDataForOrigin', {
        origin,
        storageTypes: 'all',
      });
    }
  });
  return {
    profileId,
    siteKey,
    clearedOrigins,
    deletedCookieCount: matchingCookies.length,
    checkedAt: new Date().toISOString(),
  };
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
    private readonly profileId: string,
    profileDirectory: string,
    cdpEndpoint: string,
    private readonly metadataPath: string,
    private readonly child: ChildProcess | undefined,
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
      throw new BrowserHostError(
        'browser.disconnected',
        'System browser is disconnected',
        'crashed',
      );
    }
    const page = await this.context.newPage();
    return this.managePage(page);
  }

  async findPage(pageId: string): Promise<BrowserDriverPage | undefined> {
    if (!this.isConnected()) return undefined;
    for (const [page, managed] of this.pages) {
      if (!page.isClosed() && managed.pageId === pageId) return managed;
    }
    for (const page of this.context.pages()) {
      if (page.isClosed() || this.pages.has(page)) continue;
      if ((await playwrightPageId(page)) === pageId) return this.managePage(page);
    }
    return undefined;
  }

  async listSiteData(
    knownOrigins: readonly string[] = [],
  ): Promise<BrowserProfileSiteDataSnapshot> {
    if (!this.isConnected()) {
      throw new BrowserHostError(
        'browser.disconnected',
        'System browser is disconnected',
        'crashed',
      );
    }
    return inspectBrowserProfileSiteData(this.context, this.profileId, knownOrigins);
  }

  async clearSiteData(
    siteKeyInput: string,
    knownOrigins: readonly string[] = [],
  ): Promise<BrowserProfileSiteClearResult> {
    if (!this.isConnected()) {
      throw new BrowserHostError(
        'browser.disconnected',
        'System browser is disconnected',
        'crashed',
      );
    }
    return clearBrowserProfileSiteData(this.context, this.profileId, siteKeyInput, knownOrigins);
  }

  async close(options: { preserve?: boolean } = {}): Promise<void> {
    if (this.closed) {
      if (!options.preserve) {
        await unlink(this.metadataPath).catch(() => undefined);
        if (this.child) terminateOwnedBrowser(this.child);
      }
      return;
    }
    this.closed = true;
    await this.context.unroute('**/*', this.routeHandler).catch(() => undefined);
    if (options.preserve) {
      await Promise.allSettled([...this.pages.values()].map((page) => page.detach()));
      this.pages.clear();
      this.activePages.clear();
      return;
    }
    const browserSession = await this.browser.newBrowserCDPSession().catch(() => undefined);
    await browserSession?.send('Browser.close').catch(() => undefined);
    await browserSession?.detach().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
    if (this.child) terminateOwnedBrowser(this.child);
    await waitForCdpShutdown(this.cdpEndpoint, 5_000);
    await unlink(this.metadataPath).catch(() => undefined);
  }

  private async managePage(page: Page): Promise<PlaywrightDriverPage> {
    const existing = this.pages.get(page);
    if (existing) return existing;
    const driver = await PlaywrightDriverPage.create(
      page,
      () => this.pages.delete(page),
      () => this.activePages.add(driver),
      () => this.activePages.delete(driver),
    );
    this.pages.set(page, driver);
    return driver;
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

function httpOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.origin.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

function hostMatchesSite(hostInput: string, siteKey: string): boolean {
  const host = String(hostInput ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\.+/, '')
    .replace(/^\[|\]$/gu, '')
    .replace(/\.+$/u, '');
  return host === siteKey || host.endsWith(`.${siteKey}`);
}

function normalizeCdpStorageType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replaceAll('-', '_');
  if (!normalized) return undefined;
  const aliases: Record<string, string> = {
    indexeddb: 'indexed_db',
    localstorage: 'local_storage',
    cachestorage: 'cache_storage',
    serviceworkers: 'service_workers',
  };
  return aliases[normalized] ?? normalized;
}

async function playwrightPageId(page: Page): Promise<string | undefined> {
  const session = await page
    .context()
    .newCDPSession(page)
    .catch(() => undefined);
  if (!session) return undefined;
  try {
    const { targetInfo } = await session.send('Target.getTargetInfo');
    return targetInfo.targetId;
  } catch {
    return undefined;
  } finally {
    await session.detach().catch(() => undefined);
  }
}

interface PlaywrightPageRecordingState {
  bindingName: string;
  captureToken: string;
  options: BrowserPageRecordingOptions;
  accepting: boolean;
  terminated: boolean;
  mutationTail: Promise<void>;
  stepCount: number;
  lastStep?: BrowserRecordingStepInput;
  lastInteractionAt?: number;
  navigationHandler: (frame: Frame) => void;
}

export function projectBrowserRecordingDomEvent(
  payload: unknown,
  captureToken: string,
): BrowserRecordingStepInput | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const event = payload as Record<string, unknown>;
  if (event.captureToken !== captureToken) return undefined;
  const locator = projectBrowserRecordingLocator(event.locator);
  if (!locator) return undefined;
  switch (event.kind) {
    case 'click':
      return { kind: 'click', locator };
    case 'fill':
    case 'select': {
      if (event.sensitive === true) {
        return { kind: event.kind, locator, value: { kind: 'secret' } };
      }
      if (typeof event.value !== 'string') return undefined;
      return {
        kind: event.kind,
        locator,
        value: { kind: 'literal', value: event.value.slice(0, BROWSER_RECORDING_MAX_TEXT_CHARS) },
      };
    }
    case 'check':
      return typeof event.checked === 'boolean'
        ? { kind: 'check', locator, checked: event.checked }
        : undefined;
    case 'press':
      return event.key === 'Enter' ? { kind: 'press', locator, key: 'Enter' } : undefined;
    default:
      return undefined;
  }
}

function projectBrowserRecordingLocator(value: unknown): BrowserRecordingLocator | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const locator = value as Record<string, unknown>;
  if (locator.strategy === 'role') {
    if (typeof locator.role !== 'string') return undefined;
    return {
      strategy: 'role',
      role: locator.role,
      ...(typeof locator.name === 'string' ? { name: locator.name } : {}),
    };
  }
  if (
    ['test-id', 'label', 'placeholder', 'id', 'name', 'css'].includes(String(locator.strategy)) &&
    typeof locator.value === 'string'
  ) {
    return {
      strategy: locator.strategy as 'test-id' | 'label' | 'placeholder' | 'id' | 'name' | 'css',
      value: locator.value,
    };
  }
  return undefined;
}

export function browserRecordingInstallScript(bindingName: string, captureToken: string): string {
  const serializedBindingName = JSON.stringify(bindingName);
  const serializedCaptureToken = JSON.stringify(captureToken);
  return `(() => {
    const recordingToken = ${serializedCaptureToken};
    const existing = globalThis.__syncThinkRecorder;
    if (existing?.bindingName === ${serializedBindingName}) return;
    existing?.uninstall?.();
    const binding = globalThis[${serializedBindingName}];
    if (typeof binding !== 'function') return;
    const timers = new Map();
    let overlayHost = null;
    let overlayTimer = null;
    let overlayMountPending = false;
    let overlayStartedAt = Date.now();
    let overlayStepCount = 0;
    let overlayStepNode = null;
    let overlayDurationNode = null;
    let overlayStopButton = null;
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 512);
    const escapeCss = (value) => globalThis.CSS?.escape
      ? globalThis.CSS.escape(String(value))
      : String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => '\\\\' + char);
    const unique = (selector) => {
      try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
    };
    const roleOf = (element) => {
      const explicit = clean(element.getAttribute('role')).toLowerCase();
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        const type = clean(element.getAttribute('type') || 'text').toLowerCase();
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        return 'textbox';
      }
      return '';
    };
    const nameOf = (element) => clean(
      element.getAttribute('aria-label') ||
      element.labels?.[0]?.innerText ||
      element.getAttribute('alt') ||
      ((['BUTTON', 'A'].includes(element.tagName)) ? element.innerText : '') ||
      element.getAttribute('placeholder')
    );
    const locatorFor = (element) => {
      if (!(element instanceof Element)) return null;
      const testId = clean(element.getAttribute('data-testid'));
      if (testId && unique('[data-testid="' + escapeCss(testId) + '"]')) {
        return { strategy: 'test-id', value: testId };
      }
      const role = roleOf(element);
      const name = nameOf(element);
      if (role) {
        const matches = Array.from(document.querySelectorAll('[role],button,a[href],input,textarea,select'))
          .filter((candidate) => roleOf(candidate) === role && (!name || nameOf(candidate) === name));
        if (matches.length === 1) return { strategy: 'role', role, ...(name ? { name } : {}) };
      }
      const label = clean(element.labels?.[0]?.innerText);
      if (label) {
        const matches = Array.from(document.querySelectorAll('input,textarea,select'))
          .filter((candidate) => clean(candidate.labels?.[0]?.innerText) === label);
        if (matches.length === 1) return { strategy: 'label', value: label };
      }
      const id = clean(element.id);
      if (id && unique('#' + escapeCss(id))) return { strategy: 'id', value: id };
      const fieldName = clean(element.getAttribute('name'));
      if (fieldName && unique('[name="' + escapeCss(fieldName) + '"]')) {
        return { strategy: 'name', value: fieldName };
      }
      const placeholder = clean(element.getAttribute('placeholder'));
      if (placeholder && unique('[placeholder="' + escapeCss(placeholder) + '"]')) {
        return { strategy: 'placeholder', value: placeholder };
      }
      const segments = [];
      let current = element;
      for (let depth = 0; current && current !== document.documentElement && depth < 5; depth += 1) {
        let segment = current.tagName.toLowerCase();
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((candidate) => candidate.tagName === current.tagName)
          : [];
        if (siblings.length > 1) segment += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        segments.unshift(segment);
        const selector = segments.join(' > ');
        if (selector.length <= 512 && unique(selector)) return { strategy: 'css', value: selector };
        current = current.parentElement;
      }
      return null;
    };
    const sensitivePattern = /password|passcode|otp|one.?time|token|secret|api.?key|credit|card|cvv|cvc|iban|routing|account.?number/i;
    const isSensitive = (element) => {
      const type = clean(element.getAttribute('type')).toLowerCase();
      if (type === 'password' || type === 'file' || element.isContentEditable) return true;
      const autocomplete = clean(element.getAttribute('autocomplete')).toLowerCase();
      if (/current-password|new-password|one-time-code|cc-|transaction-/.test(autocomplete)) return true;
      return sensitivePattern.test([
        element.id,
        element.getAttribute('name'),
        element.getAttribute('placeholder'),
        element.getAttribute('aria-label'),
        element.labels?.[0]?.innerText
      ].map(clean).join(' '));
    };
    const renderDuration = () => {
      if (!overlayDurationNode) return;
      const elapsed = Math.max(0, Math.floor((Date.now() - overlayStartedAt) / 1000));
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');
      overlayDurationNode.textContent = minutes + ':' + seconds;
    };
    const renderStepCount = () => {
      if (overlayStepNode) overlayStepNode.textContent = String(overlayStepCount);
    };
    const emit = (payload) => Promise.resolve(binding({ ...payload, captureToken: recordingToken }))
      .then((result) => {
        if (payload.kind !== 'control-stop') {
          const nextCount = Number(result?.stepCount);
          overlayStepCount = Number.isFinite(nextCount)
            ? Math.max(overlayStepCount, nextCount)
            : overlayStepCount + 1;
          renderStepCount();
        }
        return result;
      })
      .catch(() => undefined);
    const mountOverlay = () => {
      if (overlayHost || typeof document.createElement !== 'function') return;
      if (!document.documentElement) {
        if (!overlayMountPending) {
          overlayMountPending = true;
          document.addEventListener('DOMContentLoaded', mountOverlay, { once: true });
        }
        return;
      }
      if (overlayMountPending) {
        document.removeEventListener('DOMContentLoaded', mountOverlay);
        overlayMountPending = false;
      }
      overlayHost = document.createElement('div');
      overlayHost.id = '__sync-think-recording-overlay';
      overlayHost.style.cssText = 'all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;';
      const root = overlayHost.attachShadow?.({ mode: 'closed' }) || overlayHost;
      const panel = document.createElement('div');
      panel.setAttribute('role', 'status');
      panel.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:12px',
        'min-width:260px',
        'box-sizing:border-box',
        'padding:12px 12px 12px 14px',
        'border:1px solid rgba(255,255,255,.14)',
        'border-radius:14px',
        'background:rgba(20,22,28,.94)',
        'box-shadow:0 18px 50px rgba(0,0,0,.34)',
        'backdrop-filter:blur(16px)',
        'color:#f8fafc',
        'font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
      ].join(';');
      const dot = document.createElement('span');
      dot.style.cssText = 'width:9px;height:9px;border-radius:999px;background:#ff4d5e;box-shadow:0 0 0 5px rgba(255,77,94,.14);flex:none;';
      const copy = document.createElement('div');
      copy.style.cssText = 'display:flex;min-width:0;flex:1;flex-direction:column;gap:2px;';
      const title = document.createElement('strong');
      title.textContent = 'SYNC-THINK 录制中';
      title.style.cssText = 'font-size:13px;font-weight:650;color:#fff;';
      const meta = document.createElement('span');
      meta.style.cssText = 'font-size:11px;color:#aeb6c4;';
      overlayDurationNode = document.createElement('span');
      overlayStepNode = document.createElement('span');
      overlayStepNode.textContent = '0';
      meta.append(overlayDurationNode, document.createTextNode(' · '), overlayStepNode, document.createTextNode(' 步'));
      copy.append(title, meta);
      overlayStopButton = document.createElement('button');
      overlayStopButton.type = 'button';
      overlayStopButton.textContent = '结束录制';
      overlayStopButton.style.cssText = [
        'appearance:none',
        'border:1px solid rgba(255,255,255,.16)',
        'border-radius:9px',
        'background:#f8fafc',
        'color:#17191f',
        'padding:7px 10px',
        'font:600 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'cursor:pointer'
      ].join(';');
      overlayStopButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (overlayStopButton.disabled) return;
        overlayStopButton.disabled = true;
        overlayStopButton.textContent = '正在结束…';
        overlayStopButton.style.cursor = 'wait';
        void emit({ kind: 'control-stop' }).then((result) => {
          if (result?.accepted !== false) return;
          overlayStopButton.disabled = false;
          overlayStopButton.textContent = '结束录制';
          overlayStopButton.style.cursor = 'pointer';
        });
      }, true);
      panel.append(dot, copy, overlayStopButton);
      root.append(panel);
      document.documentElement.append(overlayHost);
      renderDuration();
      renderStepCount();
      overlayTimer = setInterval(renderDuration, 1000);
    };
    const targetFrom = (event) => {
      const target = event.composedPath?.()[0] || event.target;
      return target instanceof Element ? target : null;
    };
    const emitValue = (element) => {
      const locator = locatorFor(element);
      if (!locator) return Promise.resolve();
      if (element instanceof HTMLSelectElement) {
        const sensitive = isSensitive(element);
        return emit({ kind: 'select', locator, sensitive, ...(sensitive ? {} : { value: String(element.value || '') }) });
      }
      if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) {
        return emit({ kind: 'check', locator, checked: element.checked });
      }
      const sensitive = isSensitive(element);
      const value = element.isContentEditable ? element.textContent : element.value;
      return emit({ kind: 'fill', locator, sensitive, ...(sensitive ? {} : { value: String(value || '').slice(0, 2000) }) });
    };
    const flush = (element) => {
      const timer = timers.get(element);
      if (timer) clearTimeout(timer);
      timers.delete(element);
      return emitValue(element);
    };
    const isTextEntry = (element) => element?.matches?.('input,textarea') || element?.isContentEditable;
    const onInput = (event) => {
      if (!event.isTrusted) return;
      const element = targetFrom(event);
      if (!isTextEntry(element)) return;
      const existingTimer = timers.get(element);
      if (existingTimer) clearTimeout(existingTimer);
      timers.set(element, setTimeout(() => void flush(element), 250));
    };
    const onChange = (event) => {
      if (!event.isTrusted) return;
      const element = targetFrom(event);
      if (isTextEntry(element)) {
        if (timers.has(element)) void flush(element);
        return;
      }
      if (element?.matches?.('select')) void flush(element);
    };
    const onClick = (event) => {
      if (!event.isTrusted) return;
      if (overlayStopButton && event.composedPath?.().includes(overlayStopButton)) return;
      const element = targetFrom(event)?.closest?.('button,a,input[type="button"],input[type="submit"],input[type="reset"],[role="button"],[role="link"]');
      const locator = element ? locatorFor(element) : null;
      if (locator) emit({ kind: 'click', locator });
    };
    const onKeyDown = (event) => {
      if (!event.isTrusted || event.key !== 'Enter') return;
      const element = targetFrom(event);
      if (isTextEntry(element) && timers.has(element)) void flush(element);
      const locator = element ? locatorFor(element) : null;
      if (locator) emit({ kind: 'press', locator, key: 'Enter' });
    };
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    mountOverlay();
    globalThis.__syncThinkRecorder = {
      bindingName: ${serializedBindingName},
      async uninstall(token) {
        if (token !== recordingToken) return false;
        document.removeEventListener('input', onInput, true);
        document.removeEventListener('change', onChange, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        if (overlayMountPending) {
          document.removeEventListener('DOMContentLoaded', mountOverlay);
          overlayMountPending = false;
        }
        if (overlayTimer) clearInterval(overlayTimer);
        overlayTimer = null;
        overlayHost?.remove?.();
        overlayHost = null;
        const pending = [];
        for (const [element, timer] of timers) {
          clearTimeout(timer);
          pending.push(emitValue(element));
        }
        timers.clear();
        await Promise.allSettled(pending);
        delete globalThis.__syncThinkRecorder;
        return true;
      }
    };
  })()`;
}

export class PlaywrightDriverPage implements BrowserDriverPage {
  private allowedOrigins: ReadonlySet<string> = new Set();
  private navigationViolation: BrowserHostError | undefined;
  private readonly policyTasks = new Set<Promise<void>>();
  private readonly closeListeners = new Set<() => void>();
  private recording: PlaywrightPageRecordingState | undefined;

  private constructor(
    private readonly page: Page,
    private readonly cdpSession: CDPSession,
    readonly pageId: string,
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
    const [frameTree, targetInfo] = await Promise.all([
      cdpSession.send('Page.getFrameTree'),
      cdpSession.send('Target.getTargetInfo'),
    ]);
    const driver = new PlaywrightDriverPage(
      page,
      cdpSession,
      targetInfo.targetInfo.targetId,
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
    page.once('close', () => {
      onClose();
      driver.notifyClosed();
    });
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

  async startRecording(options: BrowserPageRecordingOptions): Promise<void> {
    if (this.recording) {
      throw new BrowserHostError(
        'browser.recording-already-started',
        'Browser Page is already recording',
        'acceptance',
      );
    }
    if (
      !Number.isSafeInteger(options.maxSteps) ||
      options.maxSteps < 1 ||
      options.maxSteps > BROWSER_RECORDING_MAX_STEPS
    ) {
      throw new BrowserHostError(
        'browser.recording-step-limit-invalid',
        'Browser recording step limit is invalid',
        'acceptance',
      );
    }
    const bindingName = `__syncThinkRecord_${randomUUID().replaceAll('-', '')}`;
    const captureToken = randomUUID();
    const state: PlaywrightPageRecordingState = {
      bindingName,
      captureToken,
      options,
      accepting: true,
      terminated: false,
      mutationTail: Promise.resolve(),
      stepCount: 0,
      navigationHandler: () => undefined,
    };
    state.navigationHandler = (frame: Frame) => {
      if (frame !== this.page.mainFrame() || !state.accepting) return;
      const url = frame.url();
      if (!httpOrigin(url)) return;
      this.queueRecordingStep(state, { kind: 'navigate', url });
    };
    this.recording = state;
    try {
      await this.page.exposeBinding(bindingName, async (source, payload: unknown) => {
        if (source.frame !== this.page.mainFrame() || !state.accepting) return;
        if (
          payload &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          (payload as Record<string, unknown>).captureToken === captureToken &&
          (payload as Record<string, unknown>).kind === 'control-stop'
        ) {
          void Promise.resolve(state.options.onStopRequested()).catch(() => undefined);
          return { accepted: true, stepCount: state.stepCount };
        }
        const step = projectBrowserRecordingDomEvent(payload, captureToken);
        if (step) this.queueRecordingStep(state, step);
        await state.mutationTail;
        return { accepted: Boolean(step), stepCount: state.stepCount };
      });
      this.page.on('framenavigated', state.navigationHandler);
      const installScript = browserRecordingInstallScript(bindingName, captureToken);
      await this.page.addInitScript({ content: installScript });
      if (!this.page.isClosed()) await this.page.evaluate(installScript);
    } catch (error) {
      this.page.off('framenavigated', state.navigationHandler);
      this.recording = undefined;
      throw error;
    }
  }

  async stopRecording(): Promise<void> {
    const state = this.recording;
    if (!state) return;
    let uninstallError: unknown;
    try {
      if (!this.page.isClosed()) {
        const uninstalled = await this.page.evaluate(
          `globalThis.__syncThinkRecorder?.uninstall?.(${JSON.stringify(state.captureToken)})`,
        );
        if (uninstalled !== true) {
          throw new BrowserHostError(
            'browser.recording-uninstall-failed',
            'Browser recording capture could not be stopped cleanly',
            'crashed',
          );
        }
      }
    } catch (error) {
      uninstallError = error;
    } finally {
      state.accepting = false;
      this.page.off('framenavigated', state.navigationHandler);
    }
    await state.mutationTail;
    if (this.recording === state) this.recording = undefined;
    if (uninstallError) throw uninstallError;
  }

  onClosed(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async close(): Promise<void> {
    if (!this.page.isClosed()) await this.page.close();
    await this.detach();
  }

  async detach(): Promise<void> {
    await this.stopRecording().catch(() => undefined);
    await this.cdpSession.send('Fetch.disable').catch(() => undefined);
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
        popup && this.isAllowedNavigation(target)
          ? 'browser.popup-denied'
          : 'browser.origin-denied',
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
        if (action.text) {
          const locator = action.selector
            ? this.page.locator(action.selector).filter({ hasText: action.text })
            : this.page.getByText(action.text, { exact: false });
          await locator.first().click({ button: action.button, timeout });
        } else if (action.selector) {
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
            'Click requires a selector, visible text, or non-negative x/y coordinates',
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
        (this.recording?.accepting === true || this.allowedOrigins.has(parsed.origin.toLowerCase()))
      );
    } catch {
      return false;
    }
  }

  private queueRecordingStep(
    state: PlaywrightPageRecordingState,
    rawStep: BrowserRecordingStepInput,
  ): void {
    const capturedAt = Date.now();
    state.mutationTail = state.mutationTail
      .then(async () => {
        if (this.recording !== state) return;
        let step = normalizeBrowserRecordingStep(rawStep);
        let type: BrowserRecordingMutation['type'] = 'append';
        const previous = state.lastStep;
        if (
          step.kind === 'navigate' &&
          previous &&
          (previous.kind === 'click' || previous.kind === 'press') &&
          state.lastInteractionAt !== undefined &&
          capturedAt - state.lastInteractionAt <= 2_500
        ) {
          step = { ...previous, resultUrl: step.url };
          type = 'replace-last';
        } else if (
          previous &&
          (step.kind === 'fill' || step.kind === 'select') &&
          previous.kind === step.kind &&
          JSON.stringify(previous.locator) === JSON.stringify(step.locator)
        ) {
          type = 'replace-last';
        } else if (
          step.kind === 'navigate' &&
          previous?.kind === 'navigate' &&
          previous.url === step.url
        ) {
          return;
        }
        if (type === 'append') {
          if (state.stepCount >= state.options.maxSteps) {
            await this.terminateRecording(state, 'step_limit');
            return;
          }
          state.stepCount += 1;
        }
        await state.options.onMutation({ type, step });
        state.lastStep = step;
        if (step.kind === 'click' || step.kind === 'press') {
          state.lastInteractionAt = capturedAt;
        } else if (type === 'append') {
          state.lastInteractionAt = undefined;
        }
        if (state.stepCount >= state.options.maxSteps) {
          await this.terminateRecording(state, 'step_limit');
        }
      })
      .catch(async () => {
        await this.terminateRecording(state, 'capture_failed');
      });
  }

  private async terminateRecording(
    state: PlaywrightPageRecordingState,
    reason: BrowserRecordingTerminationReason,
  ): Promise<void> {
    if (state.terminated) return;
    state.terminated = true;
    state.accepting = false;
    this.page.off('framenavigated', state.navigationHandler);
    void Promise.resolve(state.options.onTerminated(reason)).catch(() => undefined);
  }

  private notifyClosed(): void {
    const state = this.recording;
    if (state && !state.terminated) {
      void this.terminateRecording(state, 'page_closed');
    }
    for (const listener of [...this.closeListeners]) listener();
    this.closeListeners.clear();
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

async function waitForCdpShutdown(endpoint: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await probeCdp(`${endpoint}/json/version`))) {
      await delay(200);
      return;
    }
    await delay(100);
  }
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
  return encoded
    .subarray(0, maxBytes)
    .toString('utf8')
    .replace(/\uFFFD$/u, '');
}
