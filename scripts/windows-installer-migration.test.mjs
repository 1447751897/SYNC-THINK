import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createLegacyUninstallerMigrationScript } from './windows-installer-migration.mjs';
import {
  escapeNsisPath,
  resolveInstallerExtractionTools,
} from './windows-installer-extraction.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quote = escapeNsisPath;
const psQuote = (s) => "'" + s.replaceAll("'", "''") + "'";
const powershell = join(
  process.env.SystemRoot ?? 'C:/Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
const nsisHeader = [
  'Unicode true',
  'RequestExecutionLevel user',
  'SilentInstall silent',
  '!include "LogicLib.nsh"',
  '!include "FileFunc.nsh"',
];
function ps(source) {
  return spawnSync(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from("$ErrorActionPreference='Stop';\n" + source, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 20000 },
  );
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function compilerIn(root) {
  if (!root || !existsSync(root)) return null;
  if (existsSync(join(root, 'makensis.exe'))) return join(root, 'makensis.exe');
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.isDirectory() && !item.isSymbolicLink()) {
      const result = await compilerIn(join(root, item.name));
      if (result) return result;
    }
  }
  return null;
}
function run(exe, args = ['/S']) {
  const result = spawnSync(exe, args, { windowsHide: true, encoding: 'utf8', timeout: 35000 });
  assert.equal(result.error, undefined);
  return result;
}

async function migration(context, version, modernFailure = false) {
  const base = resolve(tmpdir());
  const directory = await mkdtemp(join(base, 'sync-think-migration-'));
  const install = join(directory, "old install O'Brien space");
  await mkdir(install);
  const unique = randomUUID();
  const key = 'Software\\SYNC-THINK-Test-Migration\\' + unique;
  const installKey = key + '\\Install';
  const legacy = join(install, 'Uninstall SYNC-THINK.exe');
  const legacyTrace = join(directory, 'legacy-executed.txt');
  const modernTrace = join(directory, 'modern-executed.txt');
  const replacement = join(directory, 'replacement-reached.txt');
  const marker = join(install, 'legacy-payload.txt');
  const logs = join(directory, 'logs');
  let runtime;
  context.after(async () => {
    if (runtime && alive(runtime.pid)) runtime.kill();
    const cleanup = ps(
      `$k=${psQuote('HKCU:\\' + key)}; if(Test-Path -LiteralPath $k){Remove-Item -LiteralPath $k -Recurse -Force}`,
    );
    assert.equal(cleanup.status, 0, cleanup.stdout + cleanup.stderr);
    const rel = relative(base, resolve(directory));
    assert.ok(rel && !rel.startsWith('..' + sep) && !isAbsolute(rel));
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  const tools = await resolveInstallerExtractionTools(workspace);
  const compiler =
    process.env.SYNC_THINK_TEST_MAKENSIS ??
    (await compilerIn(join(process.env.LOCALAPPDATA, 'electron-builder/Cache')));
  assert.ok(compiler);
  const compile = async (name, lines) => {
    const file = join(directory, name + '.nsi');
    await writeFile(file, [...nsisHeader, ...lines].join('\n'));
    const result = spawnSync(compiler, ['/V2', file], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  await writeFile(marker, 'preserve until migration succeeds');
  await compile('legacy', [
    'Name "Legacy uninstaller failure fixture"',
    'OutFile "' + quote(legacy) + '"',
    'Function .onInit',
    'FileOpen $0 "' + quote(legacyTrace) + '" a',
    'FileWrite $0 "legacy-executed$\\r$\\n"',
    'FileClose $0',
    'SetErrorLevel 37',
    'Quit',
    'FunctionEnd',
    'Section',
    'SectionEnd',
  ]);
  const registered = ps(
    [
      `$k=${psQuote('HKCU:\\' + key)}; New-Item -Path $k -Force | Out-Null`,
      `New-ItemProperty -LiteralPath $k -Name UninstallString -Value ${psQuote('"' + legacy + '" /currentuser')} -PropertyType String -Force | Out-Null`,
      `New-ItemProperty -LiteralPath $k -Name DisplayVersion -Value ${psQuote(version)} -PropertyType String -Force | Out-Null`,
      `New-Item -Path ${psQuote('HKCU:\\' + installKey)} -Force | Out-Null`,
      `New-ItemProperty -LiteralPath ${psQuote('HKCU:\\' + installKey)} -Name InstallLocation -Value ${psQuote(install)} -PropertyType String -Force | Out-Null`,
    ].join('\n'),
  );
  assert.equal(registered.status, 0, registered.stdout + registered.stderr);
  const uninstallerSource = await readFile(join(tools.templateRoot, 'uninstaller.nsh'), 'utf8');
  const atomicFunctions = uninstallerSource.slice(
    uninstallerSource.indexOf('Function un.atomicRMDir'),
    uninstallerSource.indexOf('!ifndef UNINSTALL_SECTION_NAME'),
  );
  assert.ok(atomicFunctions.includes('Function un.restoreFiles'));
  const emitter = join(directory, 'emit-modern.exe');
  const modern = join(directory, 'modern-uninstaller.exe');
  await compile('modern', [
    'Name "Current uninstaller migration fixture"',
    'OutFile "' + quote(emitter) + '"',
    '!define isUpdated "0 = 0"',
    'LangString appRunning 1033 "Fixture running"',
    'LangString appCannotBeClosed 1033 "Fixture closure failed"',
    '!define SYNC_THINK_INSTALLER_LOG_ROOT "' + quote(logs) + '"',
    '!include "' + quote(join(workspace, 'apps/desktop/build/installer.nsh')) + '"',
    'Section',
    'WriteUninstaller "' + quote(modern) + '"',
    'SectionEnd',
    'Function un.onInit',
    '!insertmacro customCheckAppRunning',
    'FunctionEnd',
    atomicFunctions,
    'Section "Uninstall"',
    'StrCmp $INSTDIR "' + quote(install) + '" permitted',
    'SetErrorLevel 91',
    'Quit',
    'permitted:',
    '${GetParameters} $1',
    'FileOpen $0 "' + quote(modernTrace) + '" a',
    'FileWrite $0 "root=$INSTDIR$\\r$\\nargs=$1$\\r$\\n"',
    'FileClose $0',
    ...(modernFailure
      ? ['SetErrorLevel 19', 'Quit']
      : [
          // Exercise the pinned builder's real atomic move/restore implementation.
          'CreateDirectory "$PLUGINSDIR\\old-install"',
          'Push ""',
          'Call un.atomicRMDir',
          'Pop $R0',
          '${If} $R0 != 0',
          'Push ""',
          'Call un.restoreFiles',
          'Pop $R0',
          'SetErrorLevel 19',
          'Quit',
          '${EndIf}',
          'SetOutPath $TEMP',
          'RMDir /r $INSTDIR',
        ]),
    'SectionEnd',
  ]);
  assert.equal(run(emitter).status, 0);
  const source = createLegacyUninstallerMigrationScript(
    await readFile(join(tools.templateRoot, 'include/installUtil.nsh'), 'utf8'),
  );
  const start = source.indexOf('Function uninstallOldVersion\n');
  const end = source.indexOf(
    '!macroend',
    source.indexOf('!macro uninstallOldVersion ROOT_KEY', start),
  );
  assert.ok(start >= 0 && end > start);
  const functions = source.slice(start, end + '!macroend'.length);
  const quotedPathParser = source.slice(
    source.indexOf('Function GetInQuotes'),
    source.indexOf('Function GetFileParent'),
  );
  const parent = join(directory, 'upgrade.exe');
  await compile('upgrade', [
    'Name "Actual legacy upgrade loop fixture"',
    'OutFile "' + quote(parent) + '"',
    '!define UNINSTALL_REGISTRY_KEY "' + quote(key) + '"',
    '!define INSTALL_REGISTRY_KEY "' + quote(installKey) + '"',
    '!define UNINSTALLER_OUT_FILE "' + quote(modern) + '"',
    '!define isDeleteAppData "0 = 1"',
    '!define isUpdated "0 = 0"',
    '!define SYNC_THINK_INSTALLER_LOG_ROOT "' + quote(logs) + '"',
    'LangString appRunning 1033 "Fixture running"',
    'LangString appCannotBeClosed 1033 "Fixture closure failed"',
    '!include "' + quote(join(workspace, 'apps/desktop/build/installer.nsh')) + '"',
    'Var installMode',
    'Var isTryToKeepShortcuts',
    'Var appExe',
    '!macro readReg OUT ROOT KEY VALUE',
    'ReadRegStr ${OUT} HKCU "${KEY}" "${VALUE}"',
    '!macroend',
    '!macro copyFile FROM TO',
    'CopyFiles /SILENT "${FROM}" "${TO}"',
    '!macroend',
    '!macro setIsTryToKeepShortcuts',
    'StrCpy $isTryToKeepShortcuts "false"',
    '!macroend',
    'Function GetFileParent',
    'Exch $0',
    '${GetParent} $0 $0',
    'Exch $0',
    'FunctionEnd',
    quotedPathParser,
    functions,
    'Section',
    'StrCpy $INSTDIR "' + quote(install) + '"',
    'StrCpy $installMode "CurrentUser"',
    'InitPluginsDir',
    '!insertmacro customCheckAppRunning',
    '!insertmacro uninstallOldVersion HKEY_CURRENT_USER',
    '${If} $R0 != 0',
    'SetErrorLevel 2',
    'Quit',
    '${EndIf}',
    'FileOpen $0 "' + quote(replacement) + '" w',
    'FileWrite $0 "replacement-reached"',
    'FileClose $0',
    'SectionEnd',
  ]);
  if (version === '0.1.0-rc.8' && !modernFailure) {
    const node = join(install, 'resources/node/node.exe');
    const entry = join(install, 'resources/runtime/dist/main.js');
    const ready = join(directory, 'runtime-ready.txt');
    await mkdir(dirname(node), { recursive: true });
    await mkdir(dirname(entry), { recursive: true });
    await copyFile(process.execPath, node);
    await writeFile(
      entry,
      "require('node:fs').writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);\n",
    );
    runtime = spawn(node, [entry, ready], { windowsHide: true, stdio: 'ignore' });
    const deadline = Date.now() + 10000;
    while (!existsSync(ready) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(ready));
  }
  const result = run(parent);
  const log = await readFile(join(logs, 'installer.log'), 'utf8');
  const isLegacy = ['0.1.0-rc.8', '0.1.0-rc.9'].includes(version);
  if (isLegacy && !modernFailure) {
    assert.equal(result.status, 0, log);
    assert.equal(
      existsSync(legacyTrace),
      false,
      'the installed legacy uninstaller must not execute',
    );
    assert.equal(existsSync(marker), false);
    assert.equal(await readFile(replacement, 'utf8'), 'replacement-reached');
    const trace = await readFile(modernTrace, 'utf8');
    assert.ok(trace.includes('root=' + install), trace);
    assert.match(trace, /\/KEEP_APP_DATA/);
    assert.match(trace, /--updated/);
    assert.match(trace, /\/currentuser/);
    assert.match(log, /source=current-build/);
    assert.match(log, /uninstall-result exit=0/);
    if (runtime) assert.equal(alive(runtime.pid), false);
  } else {
    assert.equal(result.status, 2, log);
    assert.equal(existsSync(marker), true, 'failed migration must preserve the old payload');
    assert.equal(existsSync(replacement), false);
    if (modernFailure) {
      assert.equal(existsSync(legacyTrace), false, 'do not fall back to the known legacy scanner');
      assert.match(log, /uninstall-result exit=19/);
    } else {
      assert.equal(existsSync(modernTrace), false);
      assert.equal(existsSync(legacyTrace), true);
      assert.match(log, /source=registered/);
      assert.match(log, /uninstall-result exit=37/);
    }
    assert.match(log, /phase=uninstall-failed/);
  }
}

test('legacy migration is pinned to exact rc.8/rc.9 and fails on template drift', async () => {
  const tools = await resolveInstallerExtractionTools(workspace);
  const source = await readFile(join(tools.templateRoot, 'include/installUtil.nsh'), 'utf8');
  const patched = createLegacyUninstallerMigrationScript(source);
  assert.match(
    patched,
    /File \/oname=\$PLUGINSDIR\\old-uninstaller\.exe "\$\{UNINSTALLER_OUT_FILE\}"/,
  );
  assert.ok(patched.includes('== "0.1.0-rc.8"') && patched.includes('== "0.1.0-rc.9"'));
  assert.ok(patched.includes('/S /KEEP_APP_DATA $0 _?=$installationDir'));
  assert.throws(() => createLegacyUninstallerMigrationScript(source + source), /template_changed/);
  assert.throws(() => createLegacyUninstallerMigrationScript('changed'), /template_changed/);
});
for (const version of ['0.1.0-rc.8', '0.1.0-rc.9', '0.1.0-rc.7']) {
  test(
    `actual NSIS upgrade loop migrates ${version} with the correct uninstaller`,
    { skip: process.platform !== 'win32', timeout: 45000 },
    (context) => migration(context, version),
  );
}
test(
  'current uninstaller failure preserves old payload and logs its real return code',
  { skip: process.platform !== 'win32', timeout: 45000 },
  (context) => migration(context, '0.1.0-rc.8', true),
);
