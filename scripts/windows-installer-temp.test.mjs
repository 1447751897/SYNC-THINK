import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launcher = join(workspace, 'apps/desktop/build/run-installer.cmd');
const quote = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"');

async function compilerIn(root) {
  if (!root || !existsSync(root)) return null;
  if (existsSync(join(root, 'makensis.exe'))) return join(root, 'makensis.exe');
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.isDirectory() && !item.isSymbolicLink()) {
      const found = await compilerIn(join(root, item.name));
      if (found) return found;
    }
  }
  return null;
}

async function fixture(context) {
  const base = resolve(tmpdir());
  const directory = await mkdtemp(join(base, 'sync-think-temp-launch-'));
  const packageDir = join(directory, "package with spaces O'Brien");
  await mkdir(packageDir);
  await copyFile(launcher, join(packageDir, 'Run-Installer.cmd'));
  context.after(async () => {
    const rel = relative(base, resolve(directory));
    assert.ok(rel && !rel.startsWith('..' + sep) && !isAbsolute(rel));
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  const launch = () =>
    spawnSync(
      join(process.env.SystemRoot ?? 'C:/Windows', 'System32/cmd.exe'),
      ['/d', '/c', 'Run-Installer.cmd'],
      {
        cwd: packageDir,
        env: {
          ...process.env,
          TEMP: join(directory, 'missing-original-temp'),
          TMP: join(directory, 'missing-original-temp'),
        },
        input: '\r\n',
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
      },
    );
  return { directory, packageDir, launch };
}

test('temp launcher changes only local environment and never requests silent installation or process stops', async () => {
  const source = await readFile(launcher, 'utf8');
  assert.match(source, /setlocal EnableExtensions DisableDelayedExpansion/);
  assert.match(source, /set "TEMP=%~dp0\.installer-temp"/);
  assert.match(source, /set "TMP=%TEMP%"/);
  assert.match(source, /start "" \/wait "%INSTALLER%"/);
  assert.match(source, /exit \/b %INSTALLER_EXIT%/);
  assert.doesNotMatch(source, /\b(setx|taskkill|reg|del|rmdir)\b/i);
  assert.doesNotMatch(source, /start[^\r\n]*\/S(?:\s|$)/i);
});

for (const exitCode of [0, 17]) {
  test(
    `real NSIS startup gets an isolated writable TEMP; installer exit ${exitCode} is propagated`,
    { skip: process.platform !== 'win32', timeout: 30000 },
    async (context) => {
      const { directory, packageDir, launch } = await fixture(context);
      const compiler =
        process.env.SYNC_THINK_TEST_MAKENSIS ??
        (await compilerIn(join(process.env.LOCALAPPDATA, 'electron-builder/Cache')));
      assert.ok(compiler, 'cached NSIS compiler is required');
      const exe = join(packageDir, 'SYNC-THINK-Setup-fixture-x64.exe');
      const trace = join(directory, 'trace.txt');
      const script = join(directory, 'probe.nsi');
      await writeFile(
        script,
        [
          'Unicode true',
          'RequestExecutionLevel user',
          'SilentInstall silent',
          'Name "NSIS temp regression fixture (no install)"',
          'OutFile "' + quote(exe) + '"',
          'Function .onInit',
          'InitPluginsDir',
          'FileOpen $0 "' + quote(trace) + '" w',
          'FileWrite $0 "$TEMP$\\r$\\n$PLUGINSDIR$\\r$\\n"',
          'FileClose $0',
          'SetErrorLevel ' + exitCode,
          'Quit',
          'FunctionEnd',
          'Section',
          'SectionEnd',
        ].join('\n'),
      );
      const compiled = spawnSync(compiler, ['/V2', script], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 15000,
      });
      assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
      const originalTemp = process.env.TEMP;
      const originalTmp = process.env.TMP;
      const result = launch();
      assert.equal(result.error, undefined);
      assert.equal(result.status, exitCode, result.stdout + result.stderr);
      const [temp, plugins] = (await readFile(trace, 'utf8')).trim().split('\r\n');
      assert.equal(temp.toLowerCase(), join(packageDir, '.installer-temp').toLowerCase());
      assert.ok(plugins.toLowerCase().startsWith(temp.toLowerCase() + sep));
      assert.equal(process.env.TEMP, originalTemp);
      assert.equal(process.env.TMP, originalTmp);
    },
  );
}

for (const count of [0, 2]) {
  test(
    `launcher refuses an ambiguous or missing installer (${count} candidates)`,
    { skip: process.platform !== 'win32' },
    async (context) => {
      const { packageDir, launch } = await fixture(context);
      for (let n = 0; n < count; n++) {
        await writeFile(join(packageDir, `SYNC-THINK-Setup-${n}-x64.exe`), 'not executed');
      }
      const result = launch();
      assert.equal(result.error, undefined);
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(result.stdout, /exactly one/);
      assert.equal(existsSync(join(packageDir, '.installer-temp')), false);
    },
  );
}
test('installer builds stage the opt-in temp launcher beside the installer', async () => {
  const source = await readFile(join(workspace, 'scripts/windows-installer-release.mjs'), 'utf8');
  assert.match(
    source,
    /await copyFile\(\s*join\(workspaceRoot, 'apps\/desktop\/build\/run-installer\.cmd'\),\s*join\(paths\.installerDir, 'Run-Installer\.cmd'\)/,
  );
});
