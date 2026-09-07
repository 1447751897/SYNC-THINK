import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function findCompiler(root) {
  if (!root || !existsSync(root)) return null;
  const direct = join(root, 'makensis.exe');
  if (existsSync(direct)) return direct;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const found = await findCompiler(join(root, entry.name));
    if (found) return found;
  }
  return null;
}

function escapeNsis(value) {
  return value.replaceAll('$', '$$').replaceAll('"', '$\\"');
}

async function exerciseHook(context, failure = null) {
  if (process.platform !== 'win32') return context.skip('Windows NSIS execution required');
  const compiler =
    process.env.SYNC_THINK_TEST_MAKENSIS ??
    (await findCompiler(join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache')));
  assert.ok(compiler, 'Build a Windows installer first to populate the NSIS compiler cache');
  const root = await mkdtemp(join(tmpdir(), 'sync-think-nsis-hook-'));
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const executable = join(root, 'hook.exe');
  const script = join(root, 'hook.nsi');
  const source = [
    'Unicode true',
    'RequestExecutionLevel user',
    'SilentInstall silent',
    'Name "Installer hook regression"',
    'OutFile "' + escapeNsis(executable) + '"',
    '!include "LogicLib.nsh"',
    '!define VERSION "fixture-version"',
    '!define APP_INSTALLER_STORE_FILE "fixture\\installer.exe"',
    '!macro FixtureParent output input',
    '  StrCpy $' + '{output} "' + escapeNsis(root) + '"',
    '!macroend',
    '!define StdUtils.GetParentPath "!insertmacro FixtureParent"',
    '!include "' + escapeNsis(join(workspaceRoot, 'apps/desktop/build/installer.nsh')) + '"',
    'Section',
    '  StrCpy $R4 ' + (failure ? '1' : '0'),
    '  !insertmacro customInstall',
    '  FileOpen $0 "' + escapeNsis(join(root, 'completed.txt')) + '" w',
    '  FileWrite $0 "completed"',
    '  FileClose $0',
    'SectionEnd',
  ].join('\n');
  await writeFile(script, source);
  const compiled = spawnSync(compiler, ['/V2', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const archiveDirectory = join(root, 'recovery/installers/fixture-version');
  const archive = join(archiveDirectory, 'installer.exe');
  if (failure === 'publish') {
    await mkdir(archive, { recursive: true });
    await writeFile(join(archive, 'existing.txt'), 'preserve');
  } else if (failure === 'copy') {
    await mkdir(dirname(archiveDirectory), { recursive: true });
    await writeFile(archiveDirectory, 'blocked directory');
  }
  for (let attempt = 0; attempt < (failure ? 1 : 2); attempt += 1) {
    const installed = spawnSync(executable, ['/S'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    });
    assert.equal(installed.error, undefined);
    if (failure) {
      assert.equal(
        installed.status,
        2,
        'A real archive failure must abort, even with a stale success register',
      );
      await assert.rejects(access(join(root, 'completed.txt')), { code: 'ENOENT' });
      if (failure === 'publish') {
        assert.equal(await readFile(join(archive, 'existing.txt'), 'utf8'), 'preserve');
        await assert.rejects(access(join(archiveDirectory, 'installer.exe.pending')), {
          code: 'ENOENT',
        });
      }
    } else {
      assert.deepEqual(
        await readFile(archive),
        await readFile(executable),
        'Archive must be byte-identical',
      );
      assert.equal(
        installed.status,
        0,
        'Successful archive publication must not abort installation',
      );
      assert.equal(await readFile(join(root, 'completed.txt'), 'utf8'), 'completed');
    }
  }
}

test('actual NSIS hook succeeds on initial and repeated archive publication', (context) =>
  exerciseHook(context));
test('actual NSIS hook aborts on copy failure', (context) => exerciseHook(context, 'copy'));
test('actual NSIS hook aborts on atomic publish failure and preserves existing data', (context) =>
  exerciseHook(context, 'publish'));
