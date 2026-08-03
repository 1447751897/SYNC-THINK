import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const INTENT_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/;

export interface DesktopUpdateInstallerSignature {
  status: 'valid' | 'unsigned-fixture';
  signerThumbprint: string | null;
  timestampStatus: 'valid' | 'not-required';
}

export interface DesktopUpdateInstallerProjection {
  path: string;
  bytes: number;
  sha512: string;
  signature: DesktopUpdateInstallerSignature;
}

export interface DesktopUpdateHealthyRelease {
  schemaVersion: 1;
  version: string;
  registeredAt: string;
  installer: DesktopUpdateInstallerProjection;
}

export interface DesktopUpdateRollbackIntent {
  schemaVersion: 1;
  intentId: string;
  createdAt: string;
  deadlineAt: string;
  previousVersion: string;
  targetVersion: string;
  targetDownloadedFile: string | null;
  previousRelease: DesktopUpdateHealthyRelease;
  healthMarkerPath: string;
  attemptFencePath: string;
  outcomePath: string;
  allowUnsignedFixture: boolean;
}

export interface DesktopUpdateRollbackHealthMarker {
  schemaVersion: 1;
  intentId: string;
  targetVersion: string;
  healthyAt: string;
}

export interface DesktopUpdateRollbackAttemptFence {
  schemaVersion: 1;
  intentId: string;
  attemptedAt: string;
}

export interface DesktopUpdateRollbackOutcome {
  schemaVersion: 1;
  intentId: string;
  previousVersion: string;
  targetVersion: string;
  recordedAt: string;
  status: 'healthy' | 'unavailable' | 'rolled-back' | 'rollback-failed' | 'rejected';
  automaticRollbackAttempted: boolean;
  reason: string | null;
  installerExitCode: number | null;
}

function assertSegment(value: string, pattern: RegExp, code: string): string {
  if (!pattern.test(value)) throw new Error(code);
  return value;
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class DesktopUpdateRollbackStore {
  private temporarySequence = 0;

  constructor(readonly root: string) {}

  healthyReleasePath(version: string): string {
    return join(
      this.root,
      'healthy-releases',
      `${assertSegment(version, VERSION_PATTERN, 'desktop.update.rollback-version-invalid')}.json`,
    );
  }

  intentPath(intentId: string): string {
    return join(
      this.root,
      'intents',
      `${assertSegment(intentId, INTENT_ID_PATTERN, 'desktop.update.rollback-intent-invalid')}.json`,
    );
  }

  healthMarkerPath(intentId: string): string {
    return join(
      this.root,
      'health',
      `${assertSegment(intentId, INTENT_ID_PATTERN, 'desktop.update.rollback-intent-invalid')}.json`,
    );
  }

  attemptFencePath(intentId: string): string {
    return join(
      this.root,
      'attempts',
      `${assertSegment(intentId, INTENT_ID_PATTERN, 'desktop.update.rollback-intent-invalid')}.json`,
    );
  }

  outcomePath(intentId: string): string {
    return join(
      this.root,
      'outcomes',
      `${assertSegment(intentId, INTENT_ID_PATTERN, 'desktop.update.rollback-intent-invalid')}.json`,
    );
  }

  watchdogPath(): string {
    return join(this.root, 'watchdog', 'update-rollback-watchdog.ps1');
  }

  activeIntentPath(): string {
    return join(this.root, 'active-intent.json');
  }

  async writeHealthyRelease(record: DesktopUpdateHealthyRelease): Promise<void> {
    await this.atomicWrite(this.healthyReleasePath(record.version), record);
  }

  async readHealthyRelease(version: string): Promise<DesktopUpdateHealthyRelease | null> {
    return this.readRecord(this.healthyReleasePath(version));
  }

  async writeIntent(intent: DesktopUpdateRollbackIntent): Promise<void> {
    await this.atomicWrite(this.intentPath(intent.intentId), intent);
    await this.atomicWrite(this.activeIntentPath(), intent);
  }

  async readIntent(intentId: string): Promise<DesktopUpdateRollbackIntent | null> {
    return this.readRecord(this.intentPath(intentId));
  }

  async readActiveIntent(): Promise<DesktopUpdateRollbackIntent | null> {
    return this.readRecord(this.activeIntentPath());
  }

  async clearActiveIntent(intentId: string): Promise<void> {
    const active = await this.readActiveIntent();
    if (active?.intentId === intentId) await rm(this.activeIntentPath(), { force: true });
  }

  async writeHealthMarker(marker: DesktopUpdateRollbackHealthMarker): Promise<void> {
    await this.atomicWrite(this.healthMarkerPath(marker.intentId), marker);
  }

  async readHealthMarker(intentId: string): Promise<DesktopUpdateRollbackHealthMarker | null> {
    return this.readRecord(this.healthMarkerPath(intentId));
  }

  async createAttemptFence(fence: DesktopUpdateRollbackAttemptFence): Promise<boolean> {
    const path = this.attemptFencePath(fence.intentId);
    await mkdir(dirname(path), { recursive: true });
    try {
      const file = await open(path, 'wx');
      try {
        await file.writeFile(JSON.stringify(fence, null, 2) + '\n', 'utf8');
      } finally {
        await file.close();
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }

  async writeOutcome(outcome: DesktopUpdateRollbackOutcome): Promise<void> {
    await this.atomicWrite(this.outcomePath(outcome.intentId), outcome);
  }

  async readOutcome(intentId: string): Promise<DesktopUpdateRollbackOutcome | null> {
    return this.readRecord(this.outcomePath(intentId));
  }

  async pruneHealthyReleases(limit: number): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('desktop.update.rollback-retention-invalid');
    }
    const directory = join(this.root, 'healthy-releases');
    let entries: string[];
    try {
      entries = (await readdir(directory)).filter((entry) => entry.endsWith('.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const records = (
      await Promise.all(
        entries.map(async (entry) => {
          const version = entry.slice(0, -'.json'.length);
          const record = await this.readHealthyRelease(version);
          return record ? { entry, record } : null;
        }),
      )
    )
      .filter((value): value is { entry: string; record: DesktopUpdateHealthyRelease } => !!value)
      .sort((left, right) => {
        const time = Date.parse(right.record.registeredAt) - Date.parse(left.record.registeredAt);
        return time || right.record.version.localeCompare(left.record.version);
      });
    const removed = records.slice(limit).map(({ record }) => record.version).sort();
    await Promise.all(
      removed.flatMap((version) => [
        rm(this.healthyReleasePath(version), { force: true }),
        rm(join(this.root, 'installers', version), { recursive: true, force: true }),
      ]),
    );
    return removed;
  }

  private async readRecord<T>(path: string): Promise<T | null> {
    try {
      return parseJson<T>(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async atomicWrite(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}-${this.temporarySequence++}`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await rename(temporary, path);
  }
}
