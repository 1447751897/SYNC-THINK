import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  DesktopUpdateRecoveryEvidence,
  DesktopUpdaterDriverDiagnostics,
} from './desktop-updater.js';

export const DESKTOP_UPDATE_RECOVERY_EVIDENCE_LIMIT = 20;

interface PersistedRecoveryEvidence {
  schemaVersion: 1;
  updatedAt: string;
  evidence: DesktopUpdateRecoveryEvidence[];
}

function projectDriverDiagnostics(
  value: DesktopUpdaterDriverDiagnostics | null,
): DesktopUpdaterDriverDiagnostics | null {
  if (!value) return null;
  return {
    differentialDownloadEnabled: value.differentialDownloadEnabled === true,
    automaticInstallOnQuit: value.automaticInstallOnQuit === true,
    allowDowngrade: value.allowDowngrade === true,
    currentVersionPreservedUntilInstall: value.currentVersionPreservedUntilInstall === true,
    persistentRecoveryEvidenceEnabled: value.persistentRecoveryEvidenceEnabled === true,
    recoveryEvidenceLimit: Number.isInteger(value.recoveryEvidenceLimit)
      ? value.recoveryEvidenceLimit
      : DESKTOP_UPDATE_RECOVERY_EVIDENCE_LIMIT,
  };
}

export function projectDesktopUpdateRecoveryEvidence(
  value: DesktopUpdateRecoveryEvidence,
): DesktopUpdateRecoveryEvidence {
  return {
    schemaVersion: 1,
    recordedAt: value.recordedAt,
    action: value.action,
    failedPhase: value.failedPhase,
    currentVersion: value.currentVersion,
    availableVersion: value.availableVersion,
    channel: value.channel,
    errorCode: value.errorCode,
    currentVersionPreserved: true,
    automaticRollbackAttempted: false,
    retryable: value.retryable === true,
    driver: projectDriverDiagnostics(value.driver),
  };
}

export class DesktopUpdateRecoveryStore {
  private writeQueue: Promise<void> = Promise.resolve();
  private temporarySequence = 0;

  constructor(private readonly path: string) {}

  record(evidence: DesktopUpdateRecoveryEvidence): Promise<void> {
    const projection = projectDesktopUpdateRecoveryEvidence(evidence);
    const operation = this.writeQueue.then(() => this.persist(projection));
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private async persist(projection: DesktopUpdateRecoveryEvidence): Promise<void> {
    let previous: DesktopUpdateRecoveryEvidence[] = [];
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PersistedRecoveryEvidence>;
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.evidence)) {
        previous = parsed.evidence
          .slice(-DESKTOP_UPDATE_RECOVERY_EVIDENCE_LIMIT + 1)
          .map((item) => projectDesktopUpdateRecoveryEvidence(item));
      }
    } catch {
      // Missing or corrupt diagnostics are replaced by a fresh bounded evidence file.
    }

    const payload: PersistedRecoveryEvidence = {
      schemaVersion: 1,
      updatedAt: projection.recordedAt,
      evidence: [...previous, projection].slice(-DESKTOP_UPDATE_RECOVERY_EVIDENCE_LIMIT),
    };
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp-${process.pid}-${this.temporarySequence++}`;
    await writeFile(temporary, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    await rename(temporary, this.path);
  }
}
