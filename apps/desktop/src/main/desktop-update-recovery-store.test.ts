import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DesktopUpdateRecoveryEvidence } from './desktop-updater.js';
import {
  DESKTOP_UPDATE_RECOVERY_EVIDENCE_LIMIT,
  DesktopUpdateRecoveryStore,
} from './desktop-update-recovery-store.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixturePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-updater-evidence-'));
  temporaryDirectories.push(root);
  return join(root, 'diagnostics', 'desktop-updater-recovery.json');
}

function evidence(index: number): DesktopUpdateRecoveryEvidence {
  return {
    schemaVersion: 1,
    recordedAt: new Date(Date.UTC(2026, 7, 2, 8, 0, index)).toISOString(),
    action: 'download',
    failedPhase: 'downloading',
    currentVersion: '0.0.1',
    availableVersion: `0.0.${index + 2}`,
    channel: 'latest',
    errorCode: 'desktop.update.download-failed',
    currentVersionPreserved: true,
    automaticRollbackAttempted: false,
    retryable: true,
    driver: null,
  };
}

describe('DesktopUpdateRecoveryStore', () => {
  it('creates the first evidence file and flushes the pending atomic write', async () => {
    const path = await fixturePath();
    const store = new DesktopUpdateRecoveryStore(path);

    void store.record(evidence(0));
    await store.flush();

    const persisted = JSON.parse(await readFile(path, 'utf8'));
    expect(persisted).toMatchObject({
      schemaVersion: 1,
      updatedAt: evidence(0).recordedAt,
      evidence: [evidence(0)],
    });
  });

  it('replaces corrupt JSON and projects only bounded secret-free evidence fields', async () => {
    const path = await fixturePath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{corrupt-json', 'utf8');
    const store = new DesktopUpdateRecoveryStore(path);
    const unsafe = {
      ...evidence(1),
      authorization: 'Bearer secret-token',
      rawError: 'provider private details',
    } as DesktopUpdateRecoveryEvidence;

    await store.record(unsafe);
    await store.flush();

    const text = await readFile(path, 'utf8');
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('private details');
    expect(JSON.parse(text).evidence).toEqual([evidence(1)]);
  });

  it('serializes concurrent records and keeps only the newest bounded entries', async () => {
    const path = await fixturePath();
    const store = new DesktopUpdateRecoveryStore(path);
    const total = DESKTOP_UPDATE_RECOVERY_EVIDENCE_LIMIT + 5;

    await Promise.all(Array.from({ length: total }, (_, index) => store.record(evidence(index))));
    await store.flush();

    const persisted = JSON.parse(await readFile(path, 'utf8'));
    expect(persisted.evidence).toHaveLength(DESKTOP_UPDATE_RECOVERY_EVIDENCE_LIMIT);
    expect(persisted.evidence[0].availableVersion).toBe('0.0.7');
    expect(persisted.evidence.at(-1).availableVersion).toBe(`0.0.${total + 1}`);
  });
});
