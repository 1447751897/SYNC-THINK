import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabaseAsync, runMigrations, SqliteAppSettingStore } from '@sync-think/storage';
import { automationOutcomeFailure, parseAutomationOutcome } from './automation-outcome.js';
import {
  emptyAutomationEvidence,
  isAutomationEvidence,
  type AutomationRunEvidence,
} from './automation-run-evidence.js';

const report: NonNullable<AutomationRunEvidence['outcome']> = {
  status: 'success',
  reason: 'Business action verified',
  runId: 'run-1',
  reportedAt: '2026-10-02T01:00:00.000Z',
};
const read: NonNullable<AutomationRunEvidence['browserRead']> = {
  runId: 'run-1',
  toolCallId: 'read-1',
  commandId: 'browser-command-1',
  ownerId: 'thread-1',
  profileId: 'profile-1',
  url: 'https://fixture.test/confirmation',
  observedAt: '2026-10-02T01:00:00.000Z',
};

describe('Structured automation outcome contract', () => {
  it.each(['success', 'failed', 'blocked'] as const)(
    'accepts the explicit %s result, not prose classification',
    (status) => {
      expect(parseAutomationOutcome({ status, reason: '  Action verified  ' })).toEqual({
        status,
        reason: 'Action verified',
      });
    },
  );
  it.each([
    {},
    [],
    null,
    { status: 'done', reason: 'Done' },
    { status: 'success', reason: '' },
    { status: 'success', reason: 'x'.repeat(2001) },
    { status: 'success', reason: 'Claim', browserRead: read },
  ])('rejects missing/malformed or forged structured input %j', (value) => {
    expect(parseAutomationOutcome(value)).toBeUndefined();
  });
  it('does not reuse another run outcome/read when a frozen round is resumed', () => {
    expect(
      automationOutcomeFailure(
        { browser: {} },
        { outputs: [], outcome: report, browserRead: read },
        'run-2',
      ),
    ).toMatchObject({ status: 'blocked' });
    expect(
      automationOutcomeFailure(
        { browser: {} },
        { outputs: [], outcome: { ...report, runId: 'run-2' }, browserRead: read },
        'run-2',
      ),
    ).toMatchObject({ status: 'blocked' });
  });
  it('restores structured results and live-read evidence through the existing SQLite settings extension', async () => {
    const prefix = 'sync-think-outcome-evidence-';
    const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    const databasePath = join(directory, 'evidence.sqlite');
    let connection: Awaited<ReturnType<typeof openDatabaseAsync>> | undefined;
    try {
      await runMigrations(databasePath);
      connection = await openDatabaseAsync({ path: databasePath });
      const evidence: AutomationRunEvidence = {
        ...emptyAutomationEvidence(),
        outcome: report,
        browserRead: read,
      };
      const key = 'automation:receipt:fixture-task:2026-10-02T01:00:00.000Z';
      new SqliteAppSettingStore(connection.raw).set(key, evidence);
      connection.raw.close();
      connection = await openDatabaseAsync({ path: databasePath, fileMustExist: true });
      const restored = new SqliteAppSettingStore(connection.raw).get(key)!.value;
      expect(restored).toEqual(evidence);
      expect(isAutomationEvidence(restored)).toBe(true);
      expect(
        automationOutcomeFailure({ browser: {} }, restored as AutomationRunEvidence, 'run-1'),
      ).toBeUndefined();
      expect(
        automationOutcomeFailure({ browser: {} }, restored as AutomationRunEvidence, 'run-2'),
      ).toMatchObject({ status: 'blocked' });
      expect(isAutomationEvidence({ ...evidence, outcome: { ...report, status: 'done' } })).toBe(
        false,
      );
      expect(
        isAutomationEvidence({ ...evidence, browserRead: { ...read, observedAt: 'not-a-date' } }),
      ).toBe(false);
    } finally {
      if (connection?.raw.open) connection.raw.close();
      const target = realpathSync(directory);
      if (
        lstatSync(directory).isSymbolicLink() ||
        dirname(target) !== realpathSync(tmpdir()) ||
        !basename(target).startsWith(prefix)
      )
        throw new Error('Unexpected fixture directory');
      rmSync(target, { recursive: true, force: true });
    }
  });
});
