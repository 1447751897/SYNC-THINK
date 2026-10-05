import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const helper = join(workspace, 'apps/desktop/build/installer-processes.ps1');
const powershell = join(
  process.env.SystemRoot ?? 'C:/Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";

function runPowerShell(source) {
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
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 45000,
    },
  );
}
function invoke(directory, mode, installerProcessId = 0) {
  const result = spawnSync(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helper,
      '-InstallDirectory',
      directory,
      '-Mode',
      mode,
      '-InstallerProcessId',
      String(installerProcessId),
      '-TimeoutSeconds',
      '10',
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 35000,
    },
  );
  assert.equal(result.error, undefined, result.stderr);
  return { ...result, report: JSON.parse(result.stdout.trim()) };
}
async function waitUntil(callback, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await callback()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail('fixture did not become ready before deadline');
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Classification is tested against snapshots so every negative case is checked
// without ever sending a termination request to the user's applications.
test(
  'installer closure selects exact installation images and runtime entries, not name/prefix lookalikes',
  { skip: process.platform !== 'win32' },
  () => {
    const source = `. ${quote(helper)}
$root = "D:\\fixture O'Brien\\SYNC-THINK"
$rows = @(
  [pscustomobject]@{ProcessId=101;ParentProcessId=1;ExecutablePath="$root\\SYNC-THINK.exe";CommandLine='desktop'},
  [pscustomobject]@{ProcessId=102;ParentProcessId=101;ExecutablePath="$root\\resources\\node\\node.exe";CommandLine=('node "'+$root+'\\resources\\runtime\\dist\\daemon\\index.js" sync-think-managed-daemon=install-fixture')},
  [pscustomobject]@{ProcessId=103;ParentProcessId=102;ExecutablePath="$root\\resources\\node\\node.exe";CommandLine=('node "'+$root+'\\resources\\runtime\\dist\\main.js" sync-think-managed-runtime=install-fixture')},
  [pscustomobject]@{ProcessId=104;ParentProcessId=1;ExecutablePath=($root+'-neighbor\\SYNC-THINK.exe');CommandLine='desktop'},
  [pscustomobject]@{ProcessId=105;ParentProcessId=1;ExecutablePath='D:\\other\\node.exe';CommandLine=('node "'+$root+'\\resources\\runtime\\dist\\main.js" sync-think-managed-runtime=install-fixture')},
  [pscustomobject]@{ProcessId=106;ParentProcessId=1;ExecutablePath="$root\\resources\\node\\node.exe";CommandLine=('node "'+$root+'\\unrelated.js"')},
  [pscustomobject]@{ProcessId=107;ParentProcessId=1;ExecutablePath="$root\\SYNC-THINK-Setup-rc.9.exe";CommandLine='setup'},
  [pscustomobject]@{ProcessId=108;ParentProcessId=1;ExecutablePath="$root\\Uninstall SYNC-THINK.exe";CommandLine='uninstall'},
  [pscustomobject]@{ProcessId=109;ParentProcessId=1;ExecutablePath=$null;CommandLine='hidden path'},
  [pscustomobject]@{ProcessId=110;ParentProcessId=1;ExecutablePath="$root\\resources\\node\\node.exe";CommandLine=('node "'+$root+'\\resources\\runtime\\dist\\main.js.extra"')},
  [pscustomobject]@{ProcessId=111;ParentProcessId=1;ExecutablePath="$root\\resources\\node\\node.exe";CommandLine=('node unrelated.js "'+$root+'\\resources\\runtime\\dist\\main.js"')}
)
$selected = @(Get-SyncThinkInstallTargets -InstallDirectory $root -Processes $rows -InstallerProcessId 0)
$selfProtected = @(Get-SyncThinkInstallTargets -InstallDirectory $root -Processes $rows -InstallerProcessId 101)
[pscustomobject]@{ids=@($selected | ForEach-Object {$_.ProcessId}); roles=@($selected | ForEach-Object {$_.Role}); selfIds=@($selfProtected | ForEach-Object {$_.ProcessId})} | ConvertTo-Json -Compress
`;
    const result = runPowerShell(source);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.ids, [101, 102, 103]);
    assert.deepEqual(report.roles, ['desktop', 'daemon', 'runtime']);
    assert.deepEqual(report.selfIds, [102, 103]);
  },
);

test(
  'installer closure rejects a volume root before scanning or stopping processes',
  { skip: process.platform !== 'win32' },
  () => {
    const result = invoke('D:\\', 'Stop');
    assert.equal(result.status, 30);
    assert.equal(result.report.ok, false);
    assert.match(result.report.error, /installation directory/i);
  },
);

test(
  'installer closure waits for a protected ancestor and reports a bounded failure without forcing it',
  { skip: process.platform !== 'win32' },
  () => {
    const source = `. ${quote(helper)}
$root = 'D:\\fixture\\protected'
$script:fixture = @(
  [pscustomobject]@{ProcessId=$PID;ParentProcessId=1;ExecutablePath="$root\\resources\\node\\node.exe";CommandLine=('node "'+$root+'\\resources\\runtime\\dist\\daemon\\index.js"')},
  [pscustomobject]@{ProcessId=($PID+1000000);ParentProcessId=$PID;ExecutablePath='C:\\fixture\\setup.exe';CommandLine='setup'}
)
function Get-SyncThinkProcessSnapshot { return $script:fixture }
function Stop-SyncThinkInstallTree { throw 'Protected ancestor must not be terminated' }
$report = Invoke-SyncThinkInstallerClosure -InstallDirectory $root -Mode Stop -InstallerProcessId ($PID+1000000) -TimeoutSeconds 1
[pscustomobject]@{exitCode=$report.exitCode;ok=$report.ok;errors=@($report.errors);remaining=@($report.remaining | ForEach-Object {$_.Role})} | ConvertTo-Json -Compress
`;
    const result = runPowerShell(source);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.exitCode, 20);
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.remaining, ['daemon']);
  },
);

test(
  'actual Windows closure stops a respawning daemon tree and orphan runtime while preserving installer and unrelated processes',
  { skip: process.platform !== 'win32', timeout: 60000 },
  async (context) => {
    const base = resolve(tmpdir());
    const directory = await mkdtemp(join(base, 'sync-think-installer-'));
    const root = join(directory, "install O'Brien space");
    const neighbor = root + '-neighbor';
    const children = [];
    context.after(async () => {
      for (const child of children) {
        if (typeof child.pid === 'number' && alive(child.pid)) child.kill();
      }
      await new Promise((r) => setTimeout(r, 300));
      const rel = relative(base, resolve(directory));
      assert.ok(rel && !rel.startsWith('..' + sep) && !isAbsolute(rel));
      await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    });
    const node = join(root, 'resources/node/node.exe');
    const desktop = join(root, 'SYNC-THINK.exe');
    const neighborNode = join(neighbor, 'resources/node/node.exe');
    await mkdir(dirname(node), { recursive: true });
    await mkdir(dirname(neighborNode), { recursive: true });
    await copyFile(process.execPath, node);
    await copyFile(process.execPath, desktop);
    await copyFile(process.execPath, neighborNode);
    const daemon = join(root, 'resources/runtime/dist/daemon/index.js');
    const runtime = join(root, 'resources/runtime/dist/main.js');
    const neighborRuntime = join(neighbor, 'resources/runtime/dist/main.js');
    const sleep = join(directory, 'sleep.cjs');
    await mkdir(dirname(daemon), { recursive: true });
    await mkdir(dirname(neighborRuntime), { recursive: true });
    await writeFile(
      sleep,
      "require('node:fs').writeFileSync(process.argv[2], String(process.pid));setInterval(()=>{},1000);\n",
    );
    const daemonReady = join(directory, 'daemon-ready.json');
    await writeFile(
      daemon,
      `const fs=require('node:fs'),{spawn}=require('node:child_process');
if(process.argv.includes('--child')){setInterval(()=>{},1000);}else{
let generation=0;const start=()=>{const child=spawn(process.execPath,[__filename,'--child','sync-think-managed-daemon=fixture'],{stdio:'ignore',windowsHide:true});fs.writeFileSync(${JSON.stringify(daemonReady)},JSON.stringify({parent:process.pid,child:child.pid,generation:++generation}));child.once('exit',()=>setTimeout(start,50));};start();}
`,
    );
    await writeFile(
      runtime,
      "require('node:fs').writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);\n",
    );
    await writeFile(
      neighborRuntime,
      "require('node:fs').writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);\n",
    );
    const launch = (exe, args) => {
      const child = spawn(exe, args, { stdio: 'ignore', windowsHide: true });
      children.push(child);
      return child;
    };
    const ownDaemon = launch(node, [daemon, 'sync-think-managed-daemon=fixture']);
    const ownRuntimeReady = join(directory, 'runtime-ready.txt');
    const ownRuntime = launch(node, [
      runtime,
      ownRuntimeReady,
      'sync-think-managed-runtime=fixture',
    ]);
    const desktopReady = join(directory, 'desktop-ready.txt');
    const ownDesktop = launch(desktop, [sleep, desktopReady]);
    const installerReady = join(directory, 'installer-ready.txt');
    const installer = launch(desktop, [sleep, installerReady]);
    const neighborReady = join(directory, 'neighbor-ready.txt');
    const sibling = launch(neighborNode, [
      neighborRuntime,
      neighborReady,
      'sync-think-managed-runtime=fixture',
    ]);
    const unrelatedReady = join(directory, 'unrelated-ready.txt');
    const unrelated = launch(node, [sleep, unrelatedReady]);
    await waitUntil(async () => {
      try {
        await Promise.all(
          [
            daemonReady,
            ownRuntimeReady,
            desktopReady,
            installerReady,
            neighborReady,
            unrelatedReady,
          ].map((p) => readFile(p)),
        );
        return true;
      } catch {
        return false;
      }
    });
    const initialDaemon = JSON.parse(await readFile(daemonReady, 'utf8'));
    const checked = invoke(root, 'Check', installer.pid);
    assert.equal(checked.status, 10, checked.stdout + checked.stderr);
    assert.equal(checked.report.remaining.length, 4);
    assert.ok(alive(ownDaemon.pid) && alive(ownRuntime.pid), 'Check is read-only');
    const stopped = invoke(root, 'Stop', installer.pid);
    assert.equal(stopped.status, 0, stopped.stdout + stopped.stderr);
    assert.equal(stopped.report.ok, true);
    assert.deepEqual(stopped.report.remaining, []);
    assert.ok(!alive(ownDaemon.pid));
    assert.ok(!alive(initialDaemon.child));
    assert.ok(!alive(ownRuntime.pid));
    assert.ok(!alive(ownDesktop.pid));
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(
      JSON.parse(await readFile(daemonReady, 'utf8')).generation,
      initialDaemon.generation,
      'daemon did not respawn after closure',
    );
    assert.ok(alive(installer.pid), 'installer process remains alive');
    assert.ok(alive(sibling.pid), 'neighbor installation remains alive');
    assert.ok(alive(unrelated.pid), 'unrelated Node command remains alive');
    assert.equal(invoke(root, 'Check', installer.pid).status, 0);
  },
);

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
const nsisQuote = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"');

async function exerciseNsisClosure(context, invalidRoot = false) {
  const compiler =
    process.env.SYNC_THINK_TEST_MAKENSIS ??
    (await findCompiler(join(process.env.LOCALAPPDATA, 'electron-builder/Cache')));
  assert.ok(compiler, 'NSIS compiler must be populated by the installer build');
  const base = resolve(tmpdir());
  const directory = await mkdtemp(join(base, 'sync-think-nsis-close-'));
  const install = join(directory, "NSIS O'Brien space");
  const node = join(install, 'resources/node/node.exe');
  const entry = join(install, 'resources/runtime/dist/main.js');
  const ready = join(directory, 'runtime-ready.txt');
  const completed = join(directory, 'completed.txt');
  let child;
  context.after(async () => {
    if (child && alive(child.pid)) child.kill();
    await new Promise((r) => setTimeout(r, 250));
    const rel = relative(base, resolve(directory));
    assert.ok(rel && !rel.startsWith('..' + sep) && !isAbsolute(rel));
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  await mkdir(dirname(node), { recursive: true });
  await mkdir(dirname(entry), { recursive: true });
  await copyFile(process.execPath, node);
  await writeFile(
    entry,
    "require('node:fs').writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);\n",
  );
  child = spawn(node, [entry, ready, 'sync-think-managed-runtime=nsis-fixture'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  await waitUntil(async () => {
    try {
      return Boolean(await readFile(ready));
    } catch {
      return false;
    }
  });
  const script = join(directory, 'close.nsi'),
    exe = join(directory, 'close.exe');
  const trace = join(directory, 'nsis-trace.txt'),
    tracedHook = join(directory, 'installer-traced.nsh');
  const hookSource = await readFile(join(workspace, 'apps/desktop/build/installer.nsh'), 'utf8');
  await writeFile(
    tracedHook,
    hookSource
      .replace('\"${__FILEDIR__}\\installer-processes.ps1\"', '\"' + nsisQuote(helper) + '\"')
      .replaceAll(
        'DetailPrint \"$SyncThinkCloseDetails\"',
        'FileOpen $0 \"' +
          nsisQuote(trace) +
          '\" a\nFileWrite $0 \"$SyncThinkCloseStatus: $SyncThinkCloseDetails$\\r$\\n\"\nFileClose $0\nDetailPrint \"$SyncThinkCloseDetails\"',
      ),
  );
  await writeFile(
    script,
    [
      'Unicode true',
      'RequestExecutionLevel user',
      'SilentInstall silent',
      'Name "Installer close regression"',
      'OutFile "' + nsisQuote(exe) + '"',
      '!include "LogicLib.nsh"',
      '!define isUpdated "0 = 1"',
      'LangString appRunning 1033 "Fixture is running"',
      'LangString appCannotBeClosed 1033 "Fixture closure failed"',
      '!define SYNC_THINK_INSTALLER_LOG_ROOT "' + nsisQuote(join(directory, 'logs')) + '"',
      '!include "' + nsisQuote(tracedHook) + '"',
      'Section',
      'StrCpy $INSTDIR "' + nsisQuote(invalidRoot ? 'D:\\' : install) + '"',
      '!insertmacro customCheckAppRunning',
      'FileOpen $0 "' + nsisQuote(completed) + '" w',
      'FileWrite $0 "replacement-reached"',
      'FileClose $0',
      'SectionEnd',
    ].join('\n'),
  );
  const compiled = spawnSync(compiler, ['/V2', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const result = spawnSync(exe, ['/S'], { encoding: 'utf8', windowsHide: true, timeout: 35000 });
  assert.equal(result.error, undefined);
  const traceText = await readFile(trace, 'utf8').catch(() => '(no trace)');
  assert.equal(result.status, invalidRoot ? 2 : 0, result.stdout + result.stderr + traceText);
  if (invalidRoot) {
    await assert.rejects(readFile(completed), { code: 'ENOENT' });
    assert.equal(alive(child.pid), true, 'failed closure must not touch fixture runtime');
    const log = await readFile(join(directory, 'logs/installer.log'), 'utf8');
    assert.match(log, /phase=process-check/);
    assert.doesNotMatch(log, /phase=process-stop/);
  } else {
    assert.equal(await readFile(completed, 'utf8'), 'replacement-reached');
    assert.equal(alive(child.pid), false, 'NSIS must close detached runtime before proceeding');
  }
}

test(
  'actual NSIS custom closure closes a background runtime before the replacement section',
  { skip: process.platform !== 'win32', timeout: 45000 },
  (context) => exerciseNsisClosure(context),
);
test(
  'actual NSIS closure failure aborts before the replacement section',
  { skip: process.platform !== 'win32', timeout: 45000 },
  (context) => exerciseNsisClosure(context, true),
);

test('NSIS custom closure is wired before old-version replacement with bounded errors and no global taskkill', async () => {
  const source = await readFile(join(workspace, 'apps/desktop/build/installer.nsh'), 'utf8');
  assert.match(source, /!macro customCheckAppRunning/);
  assert.match(source, /installer-processes\.ps1/);
  assert.match(source, /-Mode Check/);
  assert.match(source, /-Mode Stop/);
  assert.match(source, /MB_RETRYCANCEL/);
  assert.match(source, /nsExec::ExecToStack \/TIMEOUT=/);
  assert.doesNotMatch(source, /taskkill\s+.*\/IM/i);
});
