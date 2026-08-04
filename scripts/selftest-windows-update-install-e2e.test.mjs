import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  UPDATE_INSTALL_BASE_INSTALL_TIMEOUT_MS,
  UPDATE_INSTALL_UPGRADE_HEALTH_TIMEOUT_MS,
  UPDATE_INSTALL_NSIS_ASSISTED_SUCCESS_EXIT_CODES,
  cleanupProcessCommand,
  registryVersionCommand,
  reserveNativeUpdaterCache,
  restoreNativeUpdaterCache,
  run,
  updateInstallProbeHandoffPath,
} from './selftest-windows-update-install-e2e.mjs';

async function missing(path) {
  await assert.rejects(access(path), (error) => error?.code === 'ENOENT');
}

test('base installer has a bounded budget above the measured slow Windows install', () => {
  assert.equal(UPDATE_INSTALL_BASE_INSTALL_TIMEOUT_MS, 480_000);
  assert.equal(UPDATE_INSTALL_UPGRADE_HEALTH_TIMEOUT_MS, 900_000);
  assert.deepEqual(UPDATE_INSTALL_NSIS_ASSISTED_SUCCESS_EXIT_CODES, [0, 2]);
});

test('exit code 2 is accepted only when a caller opts into the assisted NSIS contract', async () => {
  const invocation = [process.execPath, ['-e', 'process.exit(2)']];
  await assert.rejects(run(...invocation, { timeoutMs: 5_000 }), /process\.failed:2:/);
  const result = await run(...invocation, {
    timeoutMs: 5_000,
    acceptedExitCodes: UPDATE_INSTALL_NSIS_ASSISTED_SUCCESS_EXIT_CODES,
  });
  assert.equal(result.exitCode, 2);
});

test('native updater cache is restored after an isolated fixture run', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-update-install-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, 'sync-think-updater');
  const backup = cache + '.update-install-e2e-backup-test';
  await mkdir(cache);
  await writeFile(join(cache, 'original.txt'), 'original');

  assert.equal(await reserveNativeUpdaterCache(cache, backup), true);
  await missing(cache);
  await mkdir(cache);
  await writeFile(join(cache, 'fixture.txt'), 'fixture');

  await restoreNativeUpdaterCache(cache, backup, true);
  assert.equal(await readFile(join(cache, 'original.txt'), 'utf8'), 'original');
  await missing(join(cache, 'fixture.txt'));
  await missing(backup);
});

test('fixture cache is removed when no native cache existed', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-update-install-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cache = join(root, 'sync-think-updater');
  const backup = cache + '.update-install-e2e-backup-test';

  assert.equal(await reserveNativeUpdaterCache(cache, backup), false);
  await mkdir(cache);
  await writeFile(join(cache, 'fixture.txt'), 'fixture');
  await restoreNativeUpdaterCache(cache, backup, false);
  await missing(cache);
});

test('native cache backup must remain beside the known cache path', async () => {
  await assert.rejects(
    reserveNativeUpdaterCache('D:\\fixture\\sync-think-updater', 'D:\\other\\backup'),
    /update-install\.native-cache-backup-unsafe/,
  );
});

test('probe handoff uses the packaged Desktop default user-data path', () => {
  assert.equal(
    updateInstallProbeHandoffPath('C:\\Users\\fixture\\AppData\\Roaming'),
    'C:\\Users\\fixture\\AppData\\Roaming\\@sync-think\\desktop\\update-install-e2e-handoff.json',
  );
  assert.throws(() => updateInstallProbeHandoffPath(''), /update-install\.app-data-missing/);
});

test('cleanup process command is idempotent when the recorded runtime already exited', () => {
  const command = cleanupProcessCommand('D:\\fixture\\install', '1234');
  assert.match(command, /Get-Process -Id 1234/);
  assert.match(command, /if \(\$runtime\) \{ Stop-Process/);
  assert.match(command, /; exit 0$/);
});

test('registry cleanup waits until the matching uninstall key is gone', () => {
  const command = registryVersionCommand('D:\\fixture\\install');
  assert.match(command, /__present_without_version__/);
  assert.match(command, /Write-Output \$version/);
});
