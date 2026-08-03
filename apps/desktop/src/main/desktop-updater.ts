import type {
  DesktopUpdateActionResult,
  DesktopUpdatePhase,
  DesktopUpdateSnapshot,
} from '../desktop-update-contract.js';

const UPDATE_CHANNEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const MAX_UPDATE_TOKEN_LENGTH = 4096;
const CHECKABLE_UPDATE_PHASES = new Set<DesktopUpdatePhase>([
  'idle',
  'available',
  'up-to-date',
  'error',
]);
const SAFE_PROVIDER_ERROR_CODES = new Map<string, string>([
  ['ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', 'desktop.update.channel-unavailable'],
  ['ERR_UPDATER_INVALID_UPDATE_INFO', 'desktop.update.metadata-invalid'],
  ['ERR_UPDATER_INVALID_VERSION', 'desktop.update.metadata-invalid'],
  ['ERR_UPDATER_NO_CHECKSUM', 'desktop.update.metadata-invalid'],
  ['ERR_UPDATER_NO_FILES_PROVIDED', 'desktop.update.metadata-invalid'],
  ['ERR_CHECKSUM_MISMATCH', 'desktop.update.checksum-mismatch'],
]);

export type DesktopUpdateEnvironment = Readonly<Record<string, string | undefined>>;

export type DesktopUpdateConfiguration =
  | {
      enabled: true;
      feedUrl: string;
      channel: string;
      requestHeaders: Readonly<Record<string, string>> | null;
      forceDevUpdateConfig: boolean;
    }
  | {
      enabled: false;
      channel: string;
      errorCode: string | null;
    };

export interface DesktopUpdaterDriverListeners {
  checking?(): void;
  available?(info: { version: string }): void;
  notAvailable?(info: { version: string }): void;
  progress?(info: { percent: number }): void;
  downloaded?(info: { version: string; downloadedFile?: string | null }): void;
  error?(error: unknown): void;
}

export interface DesktopUpdaterDriverDiagnostics {
  differentialDownloadEnabled: boolean;
  automaticInstallOnQuit: boolean;
  allowDowngrade: boolean;
  currentVersionPreservedUntilInstall: boolean;
  persistentRecoveryEvidenceEnabled: boolean;
  recoveryEvidenceLimit: number;
}

export interface DesktopUpdateRecoveryEvidence {
  schemaVersion: 1;
  recordedAt: string;
  action: 'check' | 'download' | 'install' | 'provider';
  failedPhase: DesktopUpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  channel: string;
  errorCode: string;
  currentVersionPreserved: true;
  automaticRollbackAttempted: false;
  retryable: boolean;
  driver: DesktopUpdaterDriverDiagnostics | null;
}

export interface DesktopUpdaterDriver {
  subscribe(listeners: DesktopUpdaterDriverListeners): () => void;
  checkForUpdates(): Promise<void>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void;
  getDiagnostics?(): DesktopUpdaterDriverDiagnostics;
  recordRecoveryEvidence?(evidence: DesktopUpdateRecoveryEvidence): void;
  flushRecoveryEvidence?(): Promise<void>;
}

export interface DesktopUpdateInstallContext {
  currentVersion: string;
  targetVersion: string;
  downloadedFile: string | null;
}

interface DesktopUpdateControllerOptions {
  currentVersion: string;
  configuration: DesktopUpdateConfiguration;
  driver: DesktopUpdaterDriver | null;
  now?: () => Date;
  beforeInstall?: (context: DesktopUpdateInstallContext) => Promise<void>;
  installSilently?: boolean;
  recordRecoveryEvidence?: (evidence: DesktopUpdateRecoveryEvidence) => void;
}

function disabledConfiguration(
  channel: string,
  errorCode: string | null,
): DesktopUpdateConfiguration {
  return { enabled: false, channel, errorCode };
}

function validLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function resolveDesktopUpdateConfiguration(
  environment: DesktopUpdateEnvironment,
  options: { isPackaged: boolean },
): DesktopUpdateConfiguration {
  const channel = (environment.SYNC_THINK_UPDATE_CHANNEL ?? 'latest').trim();
  if (!UPDATE_CHANNEL_PATTERN.test(channel)) {
    return disabledConfiguration('latest', 'desktop.update.channel-invalid');
  }

  const rawFeedUrl = environment.SYNC_THINK_UPDATE_FEED_URL?.trim();
  if (!rawFeedUrl) return disabledConfiguration(channel, null);
  if (!options.isPackaged && environment.SYNC_THINK_UPDATE_ALLOW_DEV !== '1') {
    return disabledConfiguration(channel, 'desktop.update.dev-disabled');
  }

  let feedUrl: URL;
  try {
    feedUrl = new URL(rawFeedUrl);
  } catch {
    return disabledConfiguration(channel, 'desktop.update.feed-invalid');
  }
  const isSecure = feedUrl.protocol === 'https:';
  const isLoopbackHttp = feedUrl.protocol === 'http:' && validLoopbackHostname(feedUrl.hostname);
  if (
    (!isSecure && !isLoopbackHttp) ||
    feedUrl.username.length > 0 ||
    feedUrl.password.length > 0 ||
    feedUrl.search.length > 0 ||
    feedUrl.hash.length > 0
  ) {
    return disabledConfiguration(channel, 'desktop.update.feed-invalid');
  }

  const token = environment.SYNC_THINK_UPDATE_TOKEN;
  if (
    token !== undefined &&
    (token.trim().length === 0 ||
      token.length > MAX_UPDATE_TOKEN_LENGTH ||
      token.includes('\r') ||
      token.includes('\n'))
  ) {
    return disabledConfiguration(channel, 'desktop.update.token-invalid');
  }

  return {
    enabled: true,
    feedUrl: feedUrl.toString().replace(/\/$/, feedUrl.pathname === '/' ? '' : '/'),
    channel,
    requestHeaders: token ? { Authorization: `Bearer ${token}` } : null,
    forceDevUpdateConfig: !options.isPackaged,
  };
}

function roundedProgress(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

export class DesktopUpdateController {
  private readonly listeners = new Set<(snapshot: DesktopUpdateSnapshot) => void>();
  private readonly driver: DesktopUpdaterDriver | null;
  private readonly now: () => Date;
  private readonly beforeInstall: (context: DesktopUpdateInstallContext) => Promise<void>;
  private readonly installSilently: boolean;
  private readonly disposeDriver: () => void;
  private readonly recordRecoveryEvidence: (evidence: DesktopUpdateRecoveryEvidence) => void;
  private readonly recoveryEvidence: DesktopUpdateRecoveryEvidence[] = [];
  private snapshot: DesktopUpdateSnapshot;
  private downloadedVersion: string | null = null;
  private downloadedFile: string | null = null;
  private activeAction: 'check' | 'download' | 'install' | null = null;
  private activeFailure: DesktopUpdateActionResult | null = null;

  constructor(options: DesktopUpdateControllerOptions) {
    this.driver = options.driver;
    this.now = options.now ?? (() => new Date());
    this.beforeInstall = options.beforeInstall ?? (async () => undefined);
    this.installSilently = options.installSilently ?? false;
    this.recordRecoveryEvidence = options.recordRecoveryEvidence ?? (() => undefined);
    const configured = options.configuration.enabled && options.driver !== null;
    const configurationError = options.configuration.enabled
      ? null
      : options.configuration.errorCode;
    this.snapshot = {
      schemaVersion: 1,
      phase: configured ? 'idle' : configurationError ? 'error' : 'disabled',
      configured,
      currentVersion: options.currentVersion,
      channel: options.configuration.channel,
      availableVersion: null,
      progressPercent: null,
      checkedAt: null,
      downloadedAt: null,
      errorCode: configurationError,
    };
    this.disposeDriver = options.driver
      ? options.driver.subscribe({
          checking: () => {
            this.updateSnapshot({
              phase: 'checking',
              errorCode: null,
              progressPercent: null,
            });
          },
          available: (info) => {
            if (this.downloadedVersion !== info.version) {
              this.downloadedVersion = null;
              this.downloadedFile = null;
            }
            this.updateSnapshot({
              phase: 'available',
              availableVersion: info.version,
              progressPercent: null,
              checkedAt: this.timestamp(),
              downloadedAt:
                this.downloadedVersion === info.version ? this.snapshot.downloadedAt : null,
              errorCode: null,
            });
          },
          notAvailable: () => {
            this.downloadedVersion = null;
            this.downloadedFile = null;
            this.updateSnapshot({
              phase: 'up-to-date',
              availableVersion: null,
              progressPercent: null,
              checkedAt: this.timestamp(),
              downloadedAt: null,
              errorCode: null,
            });
          },
          progress: (info) => {
            this.updateSnapshot({
              phase: 'downloading',
              progressPercent: roundedProgress(info.percent),
              errorCode: null,
            });
          },
          downloaded: (info) => {
            this.downloadedVersion = info.version;
            this.downloadedFile = info.downloadedFile ?? null;
            this.updateSnapshot({
              phase: 'downloaded',
              availableVersion: info.version,
              progressPercent: 100,
              downloadedAt: this.timestamp(),
              errorCode: null,
            });
          },
          error: (error) => {
            const failure = this.fail(
              this.safeErrorCode(error, this.errorCodeForPhase(this.snapshot.phase)),
            );
            if (this.activeAction !== null) this.activeFailure = failure;
          },
        })
      : () => undefined;
  }

  getSnapshot(): DesktopUpdateSnapshot {
    return { ...this.snapshot };
  }

  getRecoveryEvidence(): readonly DesktopUpdateRecoveryEvidence[] {
    return this.recoveryEvidence.map((evidence) => ({
      ...evidence,
      driver: evidence.driver ? { ...evidence.driver } : null,
    }));
  }

  subscribe(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposeDriver();
    this.listeners.clear();
  }

  async flushRecoveryEvidence(): Promise<void> {
    await this.driver?.flushRecoveryEvidence?.();
  }

  async checkForUpdates(): Promise<DesktopUpdateActionResult> {
    if (!this.snapshot.configured || !this.driver) return this.rejected('desktop.update.disabled');
    if (this.isBusy()) return this.rejected('desktop.update.action-busy');
    if (!CHECKABLE_UPDATE_PHASES.has(this.snapshot.phase)) {
      return this.rejected('desktop.update.action-invalid');
    }
    this.activeAction = 'check';
    this.activeFailure = null;
    this.updateSnapshot({ phase: 'checking', progressPercent: null, errorCode: null });
    try {
      await this.driver.checkForUpdates();
      return this.accepted();
    } catch (error) {
      return (
        this.activeFailure ?? this.fail(this.safeErrorCode(error, 'desktop.update.check-failed'))
      );
    } finally {
      this.activeAction = null;
      this.activeFailure = null;
    }
  }

  async downloadUpdate(): Promise<DesktopUpdateActionResult> {
    if (!this.snapshot.configured || !this.driver) return this.rejected('desktop.update.disabled');
    if (this.isBusy()) return this.rejected('desktop.update.action-busy');
    if (this.snapshot.phase !== 'available') {
      return this.rejected('desktop.update.action-invalid');
    }
    this.activeAction = 'download';
    this.activeFailure = null;
    this.updateSnapshot({ phase: 'downloading', progressPercent: 0, errorCode: null });
    try {
      await this.driver.downloadUpdate();
      return this.accepted();
    } catch (error) {
      this.downloadedVersion = null;
      this.updateSnapshot({ downloadedAt: null });
      return (
        this.activeFailure ?? this.fail(this.safeErrorCode(error, 'desktop.update.download-failed'))
      );
    } finally {
      this.activeAction = null;
      this.activeFailure = null;
    }
  }

  async installUpdate(): Promise<DesktopUpdateActionResult> {
    if (!this.snapshot.configured || !this.driver) return this.rejected('desktop.update.disabled');
    if (this.isBusy()) return this.rejected('desktop.update.action-busy');
    const retryingPreparedInstall =
      this.snapshot.phase === 'error' &&
      this.snapshot.downloadedAt !== null &&
      this.snapshot.availableVersion !== null &&
      this.downloadedVersion === this.snapshot.availableVersion;
    const downloadedVersionMatches =
      this.snapshot.availableVersion !== null &&
      this.downloadedVersion === this.snapshot.availableVersion;
    if (
      (this.snapshot.phase !== 'downloaded' || !downloadedVersionMatches) &&
      !retryingPreparedInstall
    ) {
      return this.rejected('desktop.update.action-invalid');
    }
    this.activeAction = 'install';
    this.activeFailure = null;
    this.updateSnapshot({ phase: 'installing', errorCode: null });
    try {
      await this.beforeInstall({
        currentVersion: this.snapshot.currentVersion,
        targetVersion: this.downloadedVersion!,
        downloadedFile: this.downloadedFile,
      });
      this.driver.quitAndInstall(this.installSilently, true);
      return this.accepted();
    } catch {
      return this.fail('desktop.update.install-failed');
    } finally {
      this.activeAction = null;
      this.activeFailure = null;
    }
  }

  private isBusy(): boolean {
    return (
      this.activeAction !== null ||
      this.snapshot.phase === 'checking' ||
      this.snapshot.phase === 'downloading' ||
      this.snapshot.phase === 'installing'
    );
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private updateSnapshot(patch: Partial<DesktopUpdateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    const projection = this.getSnapshot();
    for (const listener of this.listeners) listener(projection);
  }

  private accepted(): DesktopUpdateActionResult {
    return { ok: true, state: this.getSnapshot(), errorCode: null };
  }

  private rejected(errorCode: string): DesktopUpdateActionResult {
    return { ok: false, state: this.getSnapshot(), errorCode };
  }

  private fail(errorCode: string): DesktopUpdateActionResult {
    const failedPhase = this.snapshot.phase;
    const evidence: DesktopUpdateRecoveryEvidence = {
      schemaVersion: 1,
      recordedAt: this.timestamp(),
      action: this.activeAction ?? 'provider',
      failedPhase,
      currentVersion: this.snapshot.currentVersion,
      availableVersion: this.snapshot.availableVersion,
      channel: this.snapshot.channel,
      errorCode,
      currentVersionPreserved: true,
      automaticRollbackAttempted: false,
      retryable:
        this.activeAction !== 'install' ||
        (this.snapshot.downloadedAt !== null && this.snapshot.availableVersion !== null),
      driver: this.driver?.getDiagnostics?.() ?? null,
    };
    this.recoveryEvidence.push(evidence);
    if (this.recoveryEvidence.length > 20) this.recoveryEvidence.shift();
    const projection = {
      ...evidence,
      driver: evidence.driver ? { ...evidence.driver } : null,
    };
    try {
      this.recordRecoveryEvidence(projection);
    } catch {
      // Diagnostic sinks must never mask the updater failure or make the old version unusable.
    }
    try {
      this.driver?.recordRecoveryEvidence?.(projection);
    } catch {
      // The driver persists asynchronously; synchronous setup failures remain non-fatal.
    }
    this.updateSnapshot({ phase: 'error', progressPercent: null, errorCode });
    return { ok: false, state: this.getSnapshot(), errorCode };
  }

  private errorCodeForPhase(phase: DesktopUpdatePhase): string {
    if (phase === 'checking') return 'desktop.update.check-failed';
    if (phase === 'downloading') return 'desktop.update.download-failed';
    if (phase === 'installing') return 'desktop.update.install-failed';
    return 'desktop.update.provider-failed';
  }

  private safeErrorCode(error: unknown, fallback: string): string {
    if (typeof error !== 'object' || error === null || !('code' in error)) return fallback;
    const providerCode = (error as { code?: unknown }).code;
    if (typeof providerCode !== 'string') return fallback;
    return SAFE_PROVIDER_ERROR_CODES.get(providerCode) ?? fallback;
  }
}
