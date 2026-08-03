import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { DESKTOP_UPDATE_ROLLBACK_WATCHDOG_SCRIPT } from './desktop-update-rollback-watchdog.js';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function fixture(intentId: string, deadlineAt: string) {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-watchdog-'));
  temporaryDirectories.push(root);
  const installer = join(root, 'installers', '0.0.1', 'installer.exe');
  const intentPath = join(root, 'intents', `${intentId}.json`);
  const healthMarkerPath = join(root, 'health', `${intentId}.json`);
  const attemptFencePath = join(root, 'attempts', `${intentId}.json`);
  const outcomePath = join(root, 'outcomes', `${intentId}.json`);
  const scriptPath = join(root, 'watchdog', 'watchdog.ps1');
  await mkdir(join(root, 'installers', '0.0.1'), { recursive: true });
  await mkdir(join(root, 'intents'), { recursive: true });
  await mkdir(join(root, 'watchdog'), { recursive: true });
  const installerBytes = Buffer.from('fixture-installer');
  await writeFile(installer, installerBytes);
  await writeFile(scriptPath, DESKTOP_UPDATE_ROLLBACK_WATCHDOG_SCRIPT, 'utf8');
  const intent = {
    schemaVersion: 1,
    intentId,
    createdAt: new Date().toISOString(),
    deadlineAt,
    previousVersion: '0.0.1',
    targetVersion: '0.0.2',
    targetDownloadedFile: null,
    previousRelease: {
      schemaVersion: 1,
      version: '0.0.1',
      registeredAt: new Date().toISOString(),
      installer: {
        path: installer,
        bytes: installerBytes.byteLength,
        sha512: createHash('sha512').update(installerBytes).digest('hex'),
        signature: {
          status: 'unsigned-fixture',
          signerThumbprint: null,
          timestampStatus: 'not-required',
        },
      },
    },
    healthMarkerPath,
    attemptFencePath,
    outcomePath,
    allowUnsignedFixture: true,
  };
  await writeFile(intentPath, JSON.stringify(intent), 'utf8');
  return { root, intentId, intentPath, healthMarkerPath, attemptFencePath, outcomePath, scriptPath };
}

async function runWatchdog(input: Awaited<ReturnType<typeof fixture>>) {
  return execFileAsync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      input.scriptPath,
      '-IntentPath',
      input.intentPath,
      '-RecoveryRoot',
      input.root,
    ],
    { windowsHide: true },
  );
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe.skipIf(process.platform !== 'win32')('desktop update rollback watchdog', () => {
  it('accepts a matching runtime health marker and records a healthy outcome', async () => {
    const input = await fixture('healthy', new Date(Date.now() + 10_000).toISOString());
    await mkdir(join(input.root, 'health'), { recursive: true });
    await writeFile(
      input.healthMarkerPath,
      JSON.stringify({
        schemaVersion: 1,
        intentId: input.intentId,
        targetVersion: '0.0.2',
        healthyAt: new Date().toISOString(),
      }),
      'utf8',
    );

    await expect(runWatchdog(input)).resolves.toMatchObject({ stdout: '', stderr: '' });
    await expect(readFile(input.outcomePath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      status: 'healthy',
      automaticRollbackAttempted: false,
    });
  });

  it('rejects a second rollback attempt through the durable attempt fence', async () => {
    const input = await fixture('fenced', new Date(Date.now() - 1_000).toISOString());
    await mkdir(join(input.root, 'attempts'), { recursive: true });
    await writeFile(
      input.attemptFencePath,
      JSON.stringify({ schemaVersion: 1, intentId: input.intentId, attemptedAt: new Date().toISOString() }),
      'utf8',
    );

    await expect(runWatchdog(input)).rejects.toMatchObject({ code: 12 });
    await expect(readFile(input.outcomePath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      status: 'rejected',
      automaticRollbackAttempted: false,
      reason: 'attempt-already-recorded',
    });
  });
});