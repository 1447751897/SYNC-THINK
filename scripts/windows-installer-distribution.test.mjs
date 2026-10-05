import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  assertNormalWindowsIntegrity,
  exportWindowsInstallerDistribution,
  inspectWindowsFileIntegrity,
  parseWindowsIntegrityLabel,
  prepareWindowsInstallerDistribution,
} from './windows-installer-distribution.mjs';
import { verifyWindowsInstallerLayout } from './windows-installer-release.mjs';

const low = { rid: 4096, normal: false, sddl: 'S:(ML;;NW;;;LW)' };

test('mandatory labels: implicit Medium, inherited Low, numeric SID and malformed descriptor', () => {
  for (const sddl of ['', 'S:', 'S:(ML;;NW;;;ME)', 'S:(ML;;NW;;;HI)'])
    assert.equal(parseWindowsIntegrityLabel(sddl).normal, true);
  assert.equal(parseWindowsIntegrityLabel('S:AI(ML;ID;NW;;;LW)').rid, 4096);
  assert.equal(parseWindowsIntegrityLabel('S:(ML;;NW;;;S-1-16-4096)').normal, false);
  assert.equal(parseWindowsIntegrityLabel('S:(ML;;NW;;;UN)').normal, false);
  assert.throws(() => parseWindowsIntegrityLabel(null), /descriptor_invalid/);
  assert.throws(() => parseWindowsIntegrityLabel('D:'), /descriptor_invalid/);
  assert.throws(() => parseWindowsIntegrityLabel('S:(ML;;NW;;;bogus)'), /sid_invalid/);
});

test('verification rejects Low independently of layout validation', async () => {
  const root = await mkdtemp(join(process.env.TEMP ?? '/tmp', 'sync-think-label-unit-'));
  try {
    await writeFile(join(root, 'SYNC-THINK-Setup-test-x64.exe'), 'fixture');
    await assert.rejects(
      assertNormalWindowsIntegrity(root, async () => low),
      /low_integrity_artifact/,
    );
    const result = await verifyWindowsInstallerLayout(root, {
      requireManifest: false,
      requireNormalIntegrity: true,
      inspectIntegrity: async () => low,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.startsWith('installer.low_integrity_artifact:')));
    await assert.rejects(
      assertNormalWindowsIntegrity(root, async () => {
        throw Error('inspection denied');
      }),
      /inspection denied/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function findCompiler(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === 'makensis.exe') return path;
    if (entry.isDirectory()) {
      const found = await findCompiler(path);
      if (found) return found;
    }
  }
  return null;
}
const nsis = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"');

test(
  'real NSIS: Low artifact rejected; byte-identical normal export starts and writes normal AppData',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async () => {
    const local = process.env.LOCALAPPDATA;
    assert.ok(local);
    const container = await mkdtemp(join(local, 'SYNC-THINK-installer-integrity-test-'));
    const source = join(container, 'low-build');
    await mkdir(source);
    const labelled = spawnSync('icacls.exe', [source, '/setintegritylevel', '(OI)(CI)L'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(labelled.status, 0, labelled.stderr);
    const executable = join(source, 'SYNC-THINK-Setup-test-x64.exe');
    const proof = join(container, 'proof.txt');
    const script = join(source, 'probe.nsi');
    let fallback;
    try {
      const compiler = await findCompiler(join(local, 'electron-builder/Cache'));
      assert.ok(compiler, 'Build installer to populate compiler cache');
      await writeFile(
        script,
        [
          'Unicode true',
          'RequestExecutionLevel user',
          'SilentInstall silent',
          'Name "Integrity regression"',
          `OutFile "${nsis(executable)}"`,
          'Section',
          'InitPluginsDir',
          `FileOpen $0 "${nsis(proof)}" w`,
          'IfErrors failed',
          'FileWrite $0 "default-temp-write-ok"',
          'FileClose $0',
          'SetErrorLevel 0',
          'Goto done',
          'failed:',
          'SetErrorLevel 23',
          'done:',
          'SectionEnd',
        ].join('\n'),
      );
      const compile = spawnSync(compiler, ['/V2', script], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
      });
      assert.equal(compile.status, 0, compile.stdout + compile.stderr);
      assert.equal((await inspectWindowsFileIntegrity(executable)).rid, 4096);
      await assert.rejects(assertNormalWindowsIntegrity(executable), /low_integrity_artifact/);
      const destination = join(container, 'distribution');
      const exported = await exportWindowsInstallerDistribution(source, destination);
      assert.equal(exported.integrity.normal, true);
      const artifact = join(destination, 'SYNC-THINK-Setup-test-x64.exe');
      const digest = async (path) =>
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex');
      assert.equal(await digest(artifact), await digest(executable));
      fallback = await prepareWindowsInstallerDistribution(source);
      assert.equal(fallback.integrity.normal, true);
      assert.equal(
        await digest(join(fallback.installerDir, 'SYNC-THINK-Setup-test-x64.exe')),
        await digest(executable),
      );
      // The build/test TEMP may itself be Low. Simulate a user's default normal TEMP.
      const run = spawnSync(artifact, ['/S'], {
        env: { ...process.env, TEMP: join(local, 'Temp'), TMP: join(local, 'Temp') },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30000,
      });
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.equal(await readFile(proof, 'utf8'), 'default-temp-write-ok');
      await assert.rejects(exportWindowsInstallerDistribution(source, destination), /EEXIST/);
      await assert.rejects(
        exportWindowsInstallerDistribution(source, join(source, 'bad-export')),
        /low_integrity_artifact/,
      );
      assert.equal(
        (await inspectWindowsFileIntegrity(source)).normal,
        false,
        'workspace labels stay unchanged',
      );
    } finally {
      const full = resolve(container);
      assert.ok(full.toLowerCase().startsWith(resolve(local).toLowerCase() + '\\'));
      await rm(full, { recursive: true, force: true, maxRetries: 3 });
      if (fallback) {
        const fallbackContainer = resolve(fallback.installerDir, '..');
        assert.ok(
          fallbackContainer
            .toLowerCase()
            .startsWith(resolve(local, 'SYNC-THINK-Releases').toLowerCase() + '\\'),
        );
        await rm(fallbackContainer, { recursive: true, force: true, maxRetries: 3 });
      }
    }
  },
);
