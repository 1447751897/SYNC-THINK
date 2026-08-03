import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import {
  DesktopUpdateRollbackStore,
  type DesktopUpdateHealthyRelease,
  type DesktopUpdateInstallerSignature,
  type DesktopUpdateRollbackIntent,
  type DesktopUpdateRollbackOutcome,
} from './desktop-update-rollback-store.js';
import { DESKTOP_UPDATE_ROLLBACK_WATCHDOG_SCRIPT } from './desktop-update-rollback-watchdog.js';

const execFileAsync = promisify(execFile);
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const DEFAULT_HEALTH_DEADLINE_MS = 3 * 60_000;
const MAX_HEALTH_DEADLINE_MS = 15 * 60_000;
const HEALTHY_RELEASE_LIMIT = 2;

export interface DesktopUpdateInstallerVerification {
  bytes: number;
  sha512: string;
  signature: DesktopUpdateInstallerSignature;
}

export type DesktopUpdateRollbackPreparation =
  | { status: 'armed'; intentId: string }
  | { status: 'unavailable'; intentId: string; reason: 'prior-installer-missing' };

interface DesktopUpdateRollbackCoordinatorOptions {
  recoveryRoot: string;
  currentVersion: string;
  now?: () => Date;
  createIntentId?: () => string;
  healthDeadlineMs?: number;
  allowUnsignedFixture?: boolean;
  expectedSignerThumbprint?: string | null;
  verifyInstaller?: (
    path: string,
    allowUnsignedFixture: boolean,
  ) => Promise<DesktopUpdateInstallerVerification>;
  launchWatchdog?: (intent: DesktopUpdateRollbackIntent) => Promise<void>;
}

function assertVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) throw new Error('desktop.update.rollback-version-invalid');
  return version;
}

function normalizedPath(path: string): string {
  const value = normalize(resolve(path));
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(normalizedPath(root), normalizedPath(candidate));
  return pathFromRoot === '' || (!pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot));
}

function normalizeThumbprint(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, '').toUpperCase() ?? '';
  return normalized.length > 0 ? normalized : null;
}

async function sha512(path: string): Promise<string> {
  const hash = createHash('sha512');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return hash.digest('hex');
}

function powershellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows';
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

async function verifyAuthenticode(path: string): Promise<DesktopUpdateInstallerSignature> {
  if (process.platform !== 'win32') throw new Error('desktop.update.rollback-signature-platform');
  const command = [
    '$s=Get-AuthenticodeSignature -LiteralPath $args[0];',
    '[ordered]@{status=[string]$s.Status;thumbprint=if($s.SignerCertificate){[string]$s.SignerCertificate.Thumbprint}else{$null};timestamp=if($s.TimeStamperCertificate){$true}else{$false}}',
    '| ConvertTo-Json -Compress',
  ].join(' ');
  const { stdout } = await execFileAsync(
    powershellExecutable(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command, path],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  const result = JSON.parse(stdout.trim()) as {
    status?: unknown;
    thumbprint?: unknown;
    timestamp?: unknown;
  };
  if (result.status !== 'Valid') throw new Error('desktop.update.rollback-signature-invalid');
  const signerThumbprint = normalizeThumbprint(
    typeof result.thumbprint === 'string' ? result.thumbprint : null,
  );
  if (!signerThumbprint) throw new Error('desktop.update.rollback-signer-missing');
  if (result.timestamp !== true) throw new Error('desktop.update.rollback-timestamp-missing');
  return { status: 'valid', signerThumbprint, timestampStatus: 'valid' };
}

export async function verifyDesktopUpdateRecoveryInstaller(
  path: string,
  allowUnsignedFixture: boolean,
): Promise<DesktopUpdateInstallerVerification> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1) throw new Error('desktop.update.rollback-installer-invalid');
  const signature: DesktopUpdateInstallerSignature = allowUnsignedFixture
    ? { status: 'unsigned-fixture', signerThumbprint: null, timestampStatus: 'not-required' }
    : await verifyAuthenticode(path);
  return { bytes: info.size, sha512: await sha512(path), signature };
}

export function recoveryInstallerPath(recoveryRoot: string, version: string): string {
  const safeVersion = assertVersion(version);
  return join(recoveryRoot, 'installers', safeVersion, 'installer.exe');
}

export function resolveDesktopUpdateRecoveryRoot(
  environment: Readonly<Record<string, string | undefined>>,
): string | null {
  if (process.platform !== 'win32') return null;
  const localAppData = environment.LOCALAPPDATA?.trim();
  if (!localAppData) return null;
  return join(localAppData, 'sync-think-updater', 'recovery');
}

export class DesktopUpdateRollbackCoordinator {
  readonly store: DesktopUpdateRollbackStore;
  private readonly now: () => Date;
  private readonly createIntentId: () => string;
  private readonly healthDeadlineMs: number;
  private readonly allowUnsignedFixture: boolean;
  private readonly expectedSignerThumbprint: string | null;
  private readonly verifyInstaller: (
    path: string,
    allowUnsignedFixture: boolean,
  ) => Promise<DesktopUpdateInstallerVerification>;
  private readonly launchWatchdog: (intent: DesktopUpdateRollbackIntent) => Promise<void>;

  constructor(private readonly options: DesktopUpdateRollbackCoordinatorOptions) {
    this.store = new DesktopUpdateRollbackStore(options.recoveryRoot);
    this.now = options.now ?? (() => new Date());
    this.createIntentId = options.createIntentId ?? randomUUID;
    this.healthDeadlineMs = options.healthDeadlineMs ?? DEFAULT_HEALTH_DEADLINE_MS;
    if (
      !Number.isInteger(this.healthDeadlineMs) ||
      this.healthDeadlineMs < 1_000 ||
      this.healthDeadlineMs > MAX_HEALTH_DEADLINE_MS
    ) {
      throw new Error('desktop.update.rollback-deadline-invalid');
    }
    this.allowUnsignedFixture = options.allowUnsignedFixture === true;
    this.expectedSignerThumbprint = normalizeThumbprint(options.expectedSignerThumbprint);
    this.verifyInstaller = options.verifyInstaller ?? verifyDesktopUpdateRecoveryInstaller;
    this.launchWatchdog = options.launchWatchdog ?? ((intent) => this.launchDefaultWatchdog(intent));
    assertVersion(options.currentVersion);
  }

  async registerCurrentVersionInstaller(): Promise<DesktopUpdateHealthyRelease | null> {
    const installerPath = recoveryInstallerPath(
      this.options.recoveryRoot,
      this.options.currentVersion,
    );
    let verification: DesktopUpdateInstallerVerification;
    try {
      verification = await this.verifyInstaller(installerPath, this.allowUnsignedFixture);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    this.assertVerification(verification);
    const record: DesktopUpdateHealthyRelease = {
      schemaVersion: 1,
      version: this.options.currentVersion,
      registeredAt: this.now().toISOString(),
      installer: { path: installerPath, ...verification },
    };
    await this.store.writeHealthyRelease(record);
    await this.store.pruneHealthyReleases(HEALTHY_RELEASE_LIMIT);
    return record;
  }

  async prepareInstall(input: {
    targetVersion: string;
    downloadedFile?: string | null;
  }): Promise<DesktopUpdateRollbackPreparation> {
    const targetVersion = assertVersion(input.targetVersion);
    const intentId = this.createIntentId();
    const previousRelease = await this.store.readHealthyRelease(this.options.currentVersion);
    if (!previousRelease) {
      await this.store.writeOutcome(
        this.outcome(intentId, targetVersion, 'unavailable', false, 'prior-installer-missing'),
      );
      return { status: 'unavailable', intentId, reason: 'prior-installer-missing' };
    }
    this.assertReleasePath(previousRelease);
    const currentVerification = await this.verifyInstaller(
      previousRelease.installer.path,
      this.allowUnsignedFixture,
    );
    this.assertVerification(currentVerification);
    if (
      currentVerification.bytes !== previousRelease.installer.bytes ||
      currentVerification.sha512.toLowerCase() !== previousRelease.installer.sha512.toLowerCase() ||
      currentVerification.signature.status !== previousRelease.installer.signature.status ||
      normalizeThumbprint(currentVerification.signature.signerThumbprint) !==
        normalizeThumbprint(previousRelease.installer.signature.signerThumbprint) ||
      currentVerification.signature.timestampStatus !==
        previousRelease.installer.signature.timestampStatus
    ) {
      throw new Error('desktop.update.rollback-prior-installer-changed');
    }

    const createdAt = this.now();
    const intent: DesktopUpdateRollbackIntent = {
      schemaVersion: 1,
      intentId,
      createdAt: createdAt.toISOString(),
      deadlineAt: new Date(createdAt.getTime() + this.healthDeadlineMs).toISOString(),
      previousVersion: this.options.currentVersion,
      targetVersion,
      targetDownloadedFile: input.downloadedFile ? resolve(input.downloadedFile) : null,
      previousRelease,
      healthMarkerPath: this.store.healthMarkerPath(intentId),
      attemptFencePath: this.store.attemptFencePath(intentId),
      outcomePath: this.store.outcomePath(intentId),
      allowUnsignedFixture: this.allowUnsignedFixture,
    };
    await this.store.writeIntent(intent);
    await this.launchWatchdog(intent);
    return { status: 'armed', intentId };
  }

  async markRuntimeHealthy(options: { registerInstaller?: boolean } = {}): Promise<
    'marked' | 'no-intent' | 'version-mismatch'
  > {
    if (options.registerInstaller !== false) await this.registerCurrentVersionInstaller();
    const intent = await this.store.readActiveIntent();
    if (!intent) return 'no-intent';
    if (intent.targetVersion !== this.options.currentVersion) return 'version-mismatch';
    await this.store.writeHealthMarker({
      schemaVersion: 1,
      intentId: intent.intentId,
      targetVersion: intent.targetVersion,
      healthyAt: this.now().toISOString(),
    });
    return 'marked';
  }

  private assertReleasePath(release: DesktopUpdateHealthyRelease): void {
    const expected = recoveryInstallerPath(this.options.recoveryRoot, release.version);
    if (
      release.version !== this.options.currentVersion ||
      normalizedPath(release.installer.path) !== normalizedPath(expected) ||
      !isWithin(join(this.options.recoveryRoot, 'installers'), release.installer.path)
    ) {
      throw new Error('desktop.update.rollback-prior-installer-path-invalid');
    }
  }

  private assertVerification(verification: DesktopUpdateInstallerVerification): void {
    if (
      !Number.isSafeInteger(verification.bytes) ||
      verification.bytes < 1 ||
      !/^[a-f0-9]{128}$/i.test(verification.sha512)
    ) {
      throw new Error('desktop.update.rollback-installer-projection-invalid');
    }
    if (this.allowUnsignedFixture) {
      if (
        verification.signature.status !== 'unsigned-fixture' ||
        verification.signature.timestampStatus !== 'not-required'
      ) {
        throw new Error('desktop.update.rollback-fixture-signature-invalid');
      }
      return;
    }
    if (
      verification.signature.status !== 'valid' ||
      verification.signature.timestampStatus !== 'valid' ||
      !normalizeThumbprint(verification.signature.signerThumbprint)
    ) {
      throw new Error('desktop.update.rollback-signature-invalid');
    }
    if (
      this.expectedSignerThumbprint &&
      normalizeThumbprint(verification.signature.signerThumbprint) !== this.expectedSignerThumbprint
    ) {
      throw new Error('desktop.update.rollback-signer-mismatch');
    }
  }

  private outcome(
    intentId: string,
    targetVersion: string,
    status: DesktopUpdateRollbackOutcome['status'],
    automaticRollbackAttempted: boolean,
    reason: string | null,
  ): DesktopUpdateRollbackOutcome {
    return {
      schemaVersion: 1,
      intentId,
      previousVersion: this.options.currentVersion,
      targetVersion,
      recordedAt: this.now().toISOString(),
      status,
      automaticRollbackAttempted,
      reason,
      installerExitCode: null,
    };
  }

  private async launchDefaultWatchdog(intent: DesktopUpdateRollbackIntent): Promise<void> {
    if (process.platform !== 'win32') throw new Error('desktop.update.rollback-watchdog-platform');
    const watchdogPath = this.store.watchdogPath();
    await mkdir(dirname(watchdogPath), { recursive: true });
    await writeFile(watchdogPath, DESKTOP_UPDATE_ROLLBACK_WATCHDOG_SCRIPT, 'utf8');
    const child = spawn(
      powershellExecutable(),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        watchdogPath,
        '-IntentPath',
        this.store.intentPath(intent.intentId),
        '-RecoveryRoot',
        this.options.recoveryRoot,
      ],
      { detached: true, stdio: 'ignore', windowsHide: true, shell: false },
    );
    child.unref();
  }
}
