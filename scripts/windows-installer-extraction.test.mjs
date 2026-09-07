import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  createDirectExtractionScript,
  prepareDirectExtractionScript,
  resolveInstallerExtractionTools,
  escapeNsisPath,
} from './windows-installer-extraction.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('direct extraction replaces only the pinned installer extraction seam', () => {
  const options = {
    extractionTemplate:
      'before\n!macro extractUsing7za FILE\nCopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR\n!macroend\nafter',
    extractionInclude: 'D:\\build\\extract.nsh',
    sevenZip: 'D:\\tools\\7za.exe',
    license: 'D:\\tools\\LICENSE.txt',
    copying: 'D:\\tools\\COPYING',
  };
  const script = createDirectExtractionScript(options);
  assert.equal(script, 'before\n!include "D:\\build\\extract.nsh"\nafter');
  assert.throws(
    () => createDirectExtractionScript({ ...options, extractionTemplate: 'changed' }),
    /template_changed/,
  );
  assert.throws(
    () =>
      createDirectExtractionScript({
        ...options,
        extractionTemplate: options.extractionTemplate.repeat(2),
      }),
    /template_changed/,
  );
});

test('NSIS path escaping preserves literal dollar signs', () => {
  assert.equal(escapeNsisPath('D:\\$build\\file'), 'D:\\$$build\\file');
  assert.throws(() => escapeNsisPath('bad\npath'), /path_invalid/);
});

async function findCompiler(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isFile() && entry.name === 'makensis.exe') return path;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const found = await findCompiler(path);
      if (found) return found;
    }
  }
  return null;
}

async function exerciseExtraction(context, failure = null) {
  if (process.platform !== 'win32') return context.skip('Windows NSIS execution required');
  const tools = await resolveInstallerExtractionTools(workspaceRoot);
  const compiler =
    process.env.SYNC_THINK_TEST_MAKENSIS ??
    (await findCompiler(join(process.env.LOCALAPPDATA, 'electron-builder/Cache')));
  assert.ok(compiler, 'A cached NSIS compiler is required');
  const root = await mkdtemp(join(tmpdir(), 'sync-think-extraction-'));
  context.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const payload = join(root, 'payload');
  const destination = join(root, 'target with spaces');
  await mkdir(join(payload, 'nested'), { recursive: true });
  await writeFile(join(payload, 'nested/data.txt'), 'payload bytes');
  const archive = join(root, 'payload.7z');
  const packed = spawnSync(tools.sevenZip, ['a', '-t7z', archive, '.'], {
    cwd: payload,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  assert.equal(packed.status, 0, packed.stdout + packed.stderr);
  if (failure === 'corrupt') await writeFile(archive, 'not an archive');
  if (failure === 'destination') await writeFile(destination, 'preserve blocked destination');
  else {
    await mkdir(join(destination, 'nested'), { recursive: true });
    await writeFile(join(destination, 'keep.txt'), 'preserve unrelated data');
    await writeFile(join(destination, 'nested/data.txt'), 'old bytes');
  }
  const executable = join(root, 'extract.exe');
  const script = join(root, 'extract.nsi');
  const preparedInclude = await prepareDirectExtractionScript(
    workspaceRoot,
    root,
    join(workspaceRoot, 'apps/desktop/build/installer.nsh'),
  );
  const source = [
    'Unicode true',
    'RequestExecutionLevel user',
    'SilentInstall silent',
    'Name "Direct extraction regression"',
    'OutFile "' + escapeNsisPath(executable) + '"',
    '!include "LogicLib.nsh"',
    '!include "' + escapeNsisPath(preparedInclude) + '"',
    '!include "extractAppPackage.nsh"',
    'Section',
    'StrCpy $INSTDIR "' + escapeNsisPath(destination) + '"',
    'StrCpy $R0 "preserved-register"',
    ...(failure === 'locked'
      ? [
          'System::Call \'kernel32::CreateFileW(w "' +
            escapeNsisPath(join(destination, 'nested/data.txt')) +
            '", i 0x80000000, i 1, p 0, i 3, i 0, p 0) p .r5\'',
          'IntCmp $5 -1 0 +2 +2',
          'Abort "fixture lock failed"',
          'FileOpen $0 "' + escapeNsisPath(join(root, 'lock-acquired.txt')) + '" w',
          'FileWrite $0 "locked"',
          'FileClose $0',
        ]
      : []),
    '!insertmacro extractUsing7za "' + escapeNsisPath(archive) + '"',
    'FileOpen $0 "' + escapeNsisPath(join(root, 'completed.txt')) + '" w',
    'FileWrite $0 "$R0"',
    'FileClose $0',
    'SectionEnd',
  ].join('\n');
  await writeFile(script, source);
  const compiled = spawnSync(compiler, ['/V2', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const installed = spawnSync(executable, ['/S'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  assert.equal(installed.error, undefined);
  assert.equal(installed.status, failure ? 2 : 0, installed.stdout + installed.stderr);
  if (failure) await assert.rejects(readFile(join(root, 'completed.txt')), { code: 'ENOENT' });
  else {
    assert.equal(await readFile(join(destination, 'nested/data.txt'), 'utf8'), 'payload bytes');
    assert.equal(await readFile(join(root, 'completed.txt'), 'utf8'), 'preserved-register');
  }
  if (failure === 'locked') {
    assert.equal(await readFile(join(root, 'lock-acquired.txt'), 'utf8'), 'locked');
    assert.equal(await readFile(join(destination, 'nested/data.txt'), 'utf8'), 'old bytes');
  }
  if (failure === 'destination')
    assert.equal(await readFile(destination, 'utf8'), 'preserve blocked destination');
  else
    assert.equal(await readFile(join(destination, 'keep.txt'), 'utf8'), 'preserve unrelated data');
}

test('actual NSIS direct extraction overwrites payload and preserves unrelated files', (context) =>
  exerciseExtraction(context));
test('actual NSIS direct extraction rejects corrupt archives', (context) =>
  exerciseExtraction(context, 'corrupt'));
test('actual NSIS direct extraction rejects blocked destinations', (context) =>
  exerciseExtraction(context, 'destination'));
test('actual NSIS direct extraction rejects locked files without reporting success', (context) =>
  exerciseExtraction(context, 'locked'));
