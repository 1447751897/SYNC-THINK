import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { createServer } from 'node:https';
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWindowsGenericUpdateFeed } from './windows-generic-update-feed.mjs';
import {
  buildWindowsInstaller,
  verifyWindowsInstallerLayout,
} from './windows-installer-release.mjs';
import { verifyWindowsPortableLayout } from './windows-portable-release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = join(ROOT, 'apps', 'desktop', 'release');
const BASE = '0.0.1';
const TARGET = '0.0.2';
const TOKEN = 'update-install-e2e-token';
const CHANNEL = 'latest';
const EXE = 'SYNC-THINK.exe';
const UNINSTALLER = 'Uninstall SYNC-THINK.exe';
const UPDATER_CACHE_NAME = 'sync-think-updater';
const PROBE_HANDOFF_NAME = 'update-install-e2e-handoff.json';
const REMOVE_OPTIONS = Object.freeze({
  recursive: true,
  force: true,
  maxRetries: 8,
  retryDelay: 250,
});
export const UPDATE_INSTALL_BASE_INSTALL_TIMEOUT_MS = 480_000;
export const UPDATE_INSTALL_UPGRADE_HEALTH_TIMEOUT_MS = 900_000;
export const UPDATE_INSTALL_NSIS_ASSISTED_SUCCESS_EXIT_CODES = Object.freeze([0, 2]);
const sleep = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const id = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function reserveNativeUpdaterCache(cacheDir, backupDir) {
  if (
    dirname(cacheDir) !== dirname(backupDir) ||
    !basename(backupDir).startsWith(basename(cacheDir) + '.update-install-e2e-backup-')
  ) {
    throw new Error('update-install.native-cache-backup-unsafe');
  }
  if (await pathExists(backupDir)) {
    throw new Error('update-install.native-cache-backup-exists');
  }
  if (!(await pathExists(cacheDir))) return false;
  await rename(cacheDir, backupDir);
  return true;
}

export async function restoreNativeUpdaterCache(cacheDir, backupDir, wasReserved) {
  await rm(cacheDir, REMOVE_OPTIONS);
  if (wasReserved) await rename(backupDir, cacheDir);
}

export function updateInstallProbeHandoffPath(appDataDir) {
  const root = String(appDataDir ?? '').trim();
  if (!isAbsolute(root)) throw new Error('update-install.app-data-missing');
  return join(root, '@sync-think', 'desktop', PROBE_HANDOFF_NAME);
}

async function readPreparedInstallerBuild(installerDir, expectedVersion) {
  const verification = await verifyWindowsInstallerLayout(installerDir, {
    allowUnsignedFixture: true,
    requireCurrentManifest: true,
  });
  assert.equal(
    verification.ok,
    true,
    'update-install.prepared-installer-invalid:' + JSON.stringify(verification.errors),
  );
  const manifest = JSON.parse(
    await readFile(join(installerDir, 'installer-manifest.json'), 'utf8'),
  );
  assert.equal(manifest.version, expectedVersion);
  assert.equal(manifest.signing?.mode, 'unsigned-fixture');
  assert.equal(manifest.files?.length, 1);
  return { manifest };
}

async function readPortableVersion(portableDir) {
  const packageJson = JSON.parse(
    await readFile(join(portableDir, 'resources', 'app', 'package.json'), 'utf8'),
  );
  return String(packageJson.version ?? '');
}

async function createUpgradePortable(sourceDir, outputDir, version) {
  await rm(outputDir, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250,
  });
  await cp(sourceDir, outputDir, { recursive: true, force: true });

  const packagePath = join(outputDir, 'resources', 'app', 'package.json');
  const packagedApp = JSON.parse(await readFile(packagePath, 'utf8'));
  packagedApp.version = version;
  const packageContent = Buffer.from(JSON.stringify(packagedApp, null, 2) + '\n', 'utf8');
  await writeFile(packagePath, packageContent);

  const manifestPath = join(outputDir, 'release-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = version;
  const packageRecord = manifest.files?.find(
    (record) => record.path === 'resources/app/package.json',
  );
  assert.ok(packageRecord, 'update-install.portable-package-manifest-missing');
  packageRecord.bytes = packageContent.byteLength;
  packageRecord.sha256 = createHash('sha256').update(packageContent).digest('hex');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const verification = await verifyWindowsPortableLayout(outputDir, {
    signingMode: 'unsigned-fixture',
    environment: {},
  });
  if (!verification.ok) {
    throw new Error(
      'update-install.upgrade-portable-invalid:' +
        JSON.stringify({
          errors: verification.errors,
          forbiddenFiles: verification.forbiddenFiles,
        }),
    );
  }
  assert.equal(await readPortableVersion(outputDir), version);
}

function collect(child, timeoutMs, code) {
  return new Promise((resolveChild, rejectChild) => {
    let stdout = '';
    let stderr = '';
    let timeoutError = null;
    const timer = setTimeout(() => {
      timeoutError = new Error(code);
      child.kill();
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (value) => {
      stdout += value;
    });
    child.stderr?.on('data', (value) => {
      stderr += value;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectChild(error);
    });
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      if (timeoutError) {
        rejectChild(timeoutError);
        return;
      }
      resolveChild({ exitCode, signal, stdout, stderr });
    });
  });
}

export async function run(file, args, options = {}) {
  const startedAt = Date.now();
  const child = spawn(file, args, {
    cwd: ROOT,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const result = await collect(
    child,
    options.timeoutMs ?? 120000,
    options.timeoutCode ?? 'process.timeout',
  );
  const acceptedExitCodes = options.acceptedExitCodes ?? [0];
  if (!acceptedExitCodes.includes(result.exitCode)) {
    throw new Error(
      (options.errorCode ?? 'process.failed') +
        ':' +
        result.exitCode +
        ':' +
        (result.stderr || result.stdout),
    );
  }
  return { ...result, durationMs: Date.now() - startedAt };
}

async function certificate(root) {
  const pfx = join(root, 'feed.pfx');
  const cer = join(root, 'feed.cer');
  const password = 'sync-think-update-install-fixture';
  const command = [
    "$ErrorActionPreference = 'Stop'",
    '$cert = $null',
    'try {',
    "  $cert = New-SelfSignedCertificate -Subject 'CN=SYNC-THINK Update Install Fixture' -DnsName 'localhost' -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(2)",
    '  $password = ConvertTo-SecureString -String $env:SYNC_THINK_CERT_PASSWORD -AsPlainText -Force',
    '  Export-PfxCertificate -Cert $cert -FilePath $env:SYNC_THINK_CERT_PFX -Password $password | Out-Null',
    '  Export-Certificate -Cert $cert -FilePath $env:SYNC_THINK_CERT_CER -Type CERT | Out-Null',
    '} finally { if ($null -ne $cert) { Remove-Item -LiteralPath $cert.PSPath -Force } }',
  ].join('; ');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: {
      ...process.env,
      SYNC_THINK_CERT_PASSWORD: password,
      SYNC_THINK_CERT_PFX: pfx,
      SYNC_THINK_CERT_CER: cer,
    },
    timeoutMs: 30000,
    errorCode: 'update-install.certificate-failed',
  });
  const x509 = new X509Certificate(await readFile(cer));
  return { pfx: await readFile(pfx), password, data: x509.toString() };
}

function parseSingleByteRange(value, resourceBytes) {
  if (value === undefined) return null;
  if (typeof value !== 'string') return false;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value.trim());
  if (!match) return false;
  const start = Number(match[1]);
  const requestedEnd = match[2] === '' ? resourceBytes - 1 : Number(match[2]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    start >= resourceBytes ||
    requestedEnd < start
  ) {
    return false;
  }
  return { start, end: Math.min(requestedEnd, resourceBytes - 1) };
}
async function feedServer(feedDir, tls) {
  const requests = [];
  const server = createServer(
    { pfx: tls.pfx, passphrase: tls.password },
    async (request, response) => {
      const pathname = decodeURIComponent(
        new URL(request.url ?? '/', 'https://127.0.0.1').pathname,
      );
      const authorized = request.headers.authorization === 'Bearer ' + TOKEN;
      const evidence = {
        method: request.method,
        pathname,
        authorized,
        secure: request.socket.encrypted === true,
        range: typeof request.headers.range === 'string' ? request.headers.range : null,
        statusCode: null,
        resourceBytes: null,
        servedBytes: 0,
      };
      requests.push(evidence);
      if (!authorized) {
        evidence.statusCode = 401;
        evidence.servedBytes = Buffer.byteLength('unauthorized');
        response.writeHead(401).end('unauthorized');
        return;
      }
      const filename = pathname.replace(/^\/+/, '');
      if (!filename || basename(filename) !== filename) {
        evidence.statusCode = 404;
        response.writeHead(404).end();
        return;
      }
      let bytes;
      try {
        bytes = await readFile(join(feedDir, filename));
      } catch {
        evidence.statusCode = 404;
        response.writeHead(404).end();
        return;
      }

      evidence.resourceBytes = bytes.length;
      const range = parseSingleByteRange(request.headers.range, bytes.length);
      if (range === false) {
        evidence.statusCode = 416;
        response.writeHead(416, {
          'Content-Range': 'bytes */' + bytes.length,
          'Content-Length': '0',
          'Cache-Control': 'no-store',
        });
        response.end();
        return;
      }
      if (range !== null) {
        const partial = bytes.subarray(range.start, range.end + 1);
        evidence.statusCode = 206;
        evidence.servedBytes = partial.length;
        response.writeHead(206, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(partial.length),
          'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        });
        response.end(partial);
        return;
      }

      evidence.statusCode = 200;
      evidence.servedBytes = bytes.length;
      response.writeHead(200, {
        'Content-Type': filename.endsWith('.yml')
          ? 'text/yaml; charset=utf-8'
          : 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      });
      if (!filename.endsWith('.exe')) {
        response.end(bytes);
        return;
      }
      for (let offset = 0; offset < bytes.length; offset += 262144) {
        response.write(bytes.subarray(offset, Math.min(bytes.length, offset + 262144)));
        await sleep(1);
      }
      response.end();
    },
  );
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: 'https://127.0.0.1:' + address.port + '/',
    requests,
    close: () =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      ),
  };
}
async function waitState(path, predicate, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    try {
      state = JSON.parse(await readFile(path, 'utf8'));
      if (state.errorCode) throw new Error('update-install.probe-error:' + state.errorCode);
      if (predicate(state)) return state;
    } catch (error) {
      if (String(error?.message ?? error).startsWith('update-install.probe-error:')) throw error;
    }
    await sleep(250);
  }
  throw new Error(code + ':' + JSON.stringify(state));
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function identity(userData, database) {
  const metadataBytes = await readFile(join(userData, 'runtime-identity.json'));
  const metadata = JSON.parse(metadataBytes.toString('utf8'));
  const cipher = await readFile(
    join(userData, 'secure-store', 'runtime-identity', metadata.pipeSecretHandle + '.safe-storage'),
  );
  return {
    installId: metadata.installId,
    handle: metadata.pipeSecretHandle,
    metadataHash: hash(metadataBytes),
    cipherHash: hash(cipher),
    databaseBytes: (await stat(database)).size,
  };
}

export function registryVersionCommand(installDir) {
  const target = join(installDir, UNINSTALLER).replaceAll("'", "''").toLowerCase();
  return [
    "$root = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'",
    "$target = '" + target + "'",
    '$version = $null',
    "if (Test-Path -LiteralPath $root) { foreach ($key in Get-ChildItem -LiteralPath $root) { $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue; $value = [string]$entry.UninstallString; if ($value -and $value.ToLowerInvariant().Contains($target)) { $version = [string]$entry.DisplayVersion; if (-not $version) { $version = '__present_without_version__' }; break } } }",
    'Write-Output $version',
  ].join('; ');
}

async function registryVersion(installDir) {
  const command = registryVersionCommand(installDir);
  return (
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      timeoutMs: 20000,
    })
  ).stdout.trim();
}

export function cleanupProcessCommand(installDir, runtimePid = '') {
  const prefix = (installDir.endsWith('\\') ? installDir : installDir + '\\').replaceAll("'", "''");
  return [
    "$prefix = '" + prefix + "'",
    'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and ([string]$_.ExecutablePath).StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    runtimePid
      ? '$runtime = Get-Process -Id ' +
        Number(runtimePid) +
        ' -ErrorAction SilentlyContinue; if ($runtime) { Stop-Process -Id $runtime.Id -Force -ErrorAction Stop }'
      : '',
    'exit 0',
  ]
    .filter(Boolean)
    .join('; ');
}

async function cleanup(installDir, localAppData, installId) {
  let runtimePid = '';
  if (installId) {
    try {
      runtimePid = (
        await readFile(join(localAppData, 'SYNC-THINK', 'runtime-' + installId + '.pid'), 'utf8')
      ).trim();
    } catch {}
  }
  const command = cleanupProcessCommand(installDir, runtimePid);
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    timeoutMs: 20000,
  });
  const uninstaller = join(installDir, UNINSTALLER);
  if (await pathExists(uninstaller)) {
    await run(uninstaller, ['/S', '/currentuser'], {
      timeoutMs: UPDATE_INSTALL_BASE_INSTALL_TIMEOUT_MS,
      timeoutCode: 'update-install.cleanup-uninstall-timeout',
      errorCode: 'update-install.cleanup-uninstall-failed',
    });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (!(await pathExists(installDir)) && (await registryVersion(installDir)) === '') return;
      await sleep(250);
    }
    throw new Error('update-install.cleanup-uninstall-incomplete');
  }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('update-install.windows-only');
  const nativeLocalAppData = String(process.env.LOCALAPPDATA ?? '').trim();
  if (!nativeLocalAppData) throw new Error('update-install.native-local-app-data-missing');
  const runId = id();
  const reuseInstallers = process.argv.includes('--reuse-installers');
  const root = join(ROOT, '.data', 'update-install-e2e-' + runId);
  const paths = {
    basePortable: join(RELEASE, 'win-unpacked'),
    upgradePortable: join(RELEASE, 'win-unpacked-update-e2e-upgrade'),
    baseInstaller: join(RELEASE, 'installer-update-e2e-base'),
    upgradeInstaller: join(RELEASE, 'installer-update-e2e-upgrade'),
    install: join(root, 'install'),
    userData: join(root, 'user-data'),
    localAppData: join(root, 'local-app-data'),
    runtimeData: join(root, 'runtime-data'),
    feed: join(root, 'feed'),
    logs: join(root, 'logs'),
    probe: join(root, 'probe-result.json'),
    result: join(root, 'smoke-result.json'),
    progress: join(root, 'logs', 'progress.json'),
    recoverySnapshot: join(root, 'recovery-snapshot'),
    handoff: updateInstallProbeHandoffPath(process.env.APPDATA),
    nativeUpdaterCache: join(nativeLocalAppData, UPDATER_CACHE_NAME),
    nativeUpdaterCacheBackup: join(
      nativeLocalAppData,
      UPDATER_CACHE_NAME + '.update-install-e2e-backup-' + runId,
    ),
  };
  paths.database = join(paths.runtimeData, 'sync-think.db');
  paths.isolatedUpdaterCache = join(paths.localAppData, UPDATER_CACHE_NAME);
  if (await pathExists(paths.handoff)) {
    throw new Error('update-install.preexisting-handoff');
  }
  await Promise.all(
    [
      paths.install,
      paths.userData,
      paths.localAppData,
      paths.runtimeData,
      paths.feed,
      paths.logs,
    ].map((value) => mkdir(value, { recursive: true })),
  );
  console.log('[update-install] root: ' + root);
  const markProgress = async (stage, detail = {}) =>
    writeFile(
      paths.progress,
      JSON.stringify({ stage, at: new Date().toISOString(), ...detail }, null, 2) + '\n',
      'utf8',
    );
  assert.equal(await readPortableVersion(paths.basePortable), BASE);
  if (!reuseInstallers) {
    await createUpgradePortable(paths.basePortable, paths.upgradePortable, TARGET);
  } else {
    assert.equal(await readPortableVersion(paths.upgradePortable), TARGET);
  }
  const baseBuild = reuseInstallers
    ? await readPreparedInstallerBuild(paths.baseInstaller, BASE)
    : await buildWindowsInstaller({
        portableDir: paths.basePortable,
        installerDir: paths.baseInstaller,
        version: BASE,
        signingMode: 'unsigned-fixture',
      });
  const upgradeBuild = reuseInstallers
    ? await readPreparedInstallerBuild(paths.upgradeInstaller, TARGET)
    : await buildWindowsInstaller({
        portableDir: paths.upgradePortable,
        installerDir: paths.upgradeInstaller,
        version: TARGET,
        signingMode: 'unsigned-fixture',
      });
  await markProgress('fixtures-ready', { reuseInstallers });
  const baseInstaller = join(paths.baseInstaller, baseBuild.manifest.files[0].path);
  const upgradeInstaller = join(paths.upgradeInstaller, upgradeBuild.manifest.files[0].path);
  let baseIdentity = null;
  let desktop = null;
  let server = null;
  let nativeUpdaterCachePrepared = false;
  let nativeUpdaterCacheReserved = false;
  let baseInstallDurationMs = null;
  let baseInstallExitCode = null;
  try {
    nativeUpdaterCacheReserved = await reserveNativeUpdaterCache(
      paths.nativeUpdaterCache,
      paths.nativeUpdaterCacheBackup,
    );
    nativeUpdaterCachePrepared = true;
    await markProgress('native-cache-reserved');
    let baseInstall;
    try {
      baseInstall = await run(
        baseInstaller,
        ['/S', '/currentuser', '/D=' + paths.install],
        {
          env: {
            ...process.env,
            LOCALAPPDATA: paths.localAppData,
          },
          timeoutMs: UPDATE_INSTALL_BASE_INSTALL_TIMEOUT_MS,
          timeoutCode: 'update-install.base-install-timeout',
          errorCode: 'update-install.base-install-failed',
          acceptedExitCodes: UPDATE_INSTALL_NSIS_ASSISTED_SUCCESS_EXIT_CODES,
        },
      );
    } catch (error) {
      await markProgress('base-install-failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    baseInstallDurationMs = baseInstall.durationMs;
    baseInstallExitCode = baseInstall.exitCode;
    await markProgress('base-installed', { baseInstallDurationMs, baseInstallExitCode });
    const executable = join(paths.install, EXE);
    await Promise.all([
      access(executable),
      access(join(paths.install, 'resources', 'runtime', 'package.json')),
      access(join(paths.install, UNINSTALLER)),
    ]);
    const installedLayout = await verifyWindowsPortableLayout(paths.install, {
      signingMode: 'unsigned-fixture',
      environment: {},
    });
    assert.equal(
      installedLayout.ok,
      true,
      'update-install.base-layout-invalid:' + JSON.stringify(installedLayout.errors),
    );
    assert.equal(await registryVersion(paths.install), BASE);
    const archivedBaseInstaller = join(
      paths.nativeUpdaterCache,
      'recovery',
      'installers',
      BASE,
      'installer.exe',
    );
    assert.equal(hash(await readFile(archivedBaseInstaller)), hash(await readFile(baseInstaller)));
    await markProgress('base-validated');
    await mkdir(paths.isolatedUpdaterCache, { recursive: true });
    // NSIS resolves LOCALAPPDATA through the Windows Known Folder API. Seed the
    // environment-isolated cache used by Electron while preserving the native cache separately.
    await cp(baseInstaller, join(paths.isolatedUpdaterCache, 'installer.exe'));
    const isolatedRecoveryInstaller = join(
      paths.isolatedUpdaterCache,
      'recovery',
      'installers',
      BASE,
      'installer.exe',
    );
    await mkdir(dirname(isolatedRecoveryInstaller), { recursive: true });
    await cp(baseInstaller, isolatedRecoveryInstaller);
    await cp(baseInstaller + '.blockmap', join(paths.feed, basename(baseInstaller) + '.blockmap'));
    await writeWindowsGenericUpdateFeed({
      artifactPath: upgradeInstaller,
      outputDir: paths.feed,
      version: TARGET,
      channel: CHANNEL,
      requireBlockmap: true,
      channelPolicy: {
        channel: CHANNEL,
        audience: 'private',
        requiresAuthorization: true,
        allowedVersions: [TARGET],
        withdrawnVersions: [],
      },
    });
    const tls = await certificate(root);
    server = await feedServer(paths.feed, tls);
    await markProgress('feed-ready');
    const probe = {
      resultPath: paths.probe,
      userDataPath: paths.userData,
      targetVersion: TARGET,
      markerName: 'Update install E2E ' + basename(root),
      timeoutMs: UPDATE_INSTALL_UPGRADE_HEALTH_TIMEOUT_MS,
      trustedCertificateData: tls.data,
    };
    const out = openSync(join(paths.logs, 'desktop.stdout.log'), 'a');
    const err = openSync(join(paths.logs, 'desktop.stderr.log'), 'a');
    desktop = spawn(executable, [], {
      cwd: paths.install,
      env: {
        ...process.env,
        LOCALAPPDATA: paths.localAppData,
        SYNC_THINK_DB_PATH: paths.database,
        SYNC_THINK_RUNTIME_FORCE_RESTART: '1',
        SYNC_THINK_UPDATE_FEED_URL: server.url,
        SYNC_THINK_UPDATE_CHANNEL: CHANNEL,
        SYNC_THINK_UPDATE_TOKEN: TOKEN,
        SYNC_THINK_UPDATE_ROLLBACK_ALLOW_UNSIGNED_FIXTURE: '1',
        SYNC_THINK_UPDATE_ROLLBACK_HEALTH_TIMEOUT_MS: String(
          UPDATE_INSTALL_UPGRADE_HEALTH_TIMEOUT_MS,
        ),
        SYNC_THINK_UPDATE_INSTALL_E2E_CONFIG: JSON.stringify(probe),
      },
      stdio: ['ignore', out, err],
      windowsHide: true,
    });
    closeSync(out);
    closeSync(err);
    await markProgress('desktop-spawned', { pid: desktop.pid ?? null });
    await waitState(
      paths.probe,
      (state) => state.events?.some((event) => event.type === 'base-runtime-ready'),
      120000,
      'update-install.base-runtime-timeout',
    );
    baseIdentity = await identity(paths.userData, paths.database);
    await markProgress('base-ready');
    console.log('[update-install] base ready; waiting for updater relaunch');
    const finalState = await waitState(
      paths.probe,
      (state) => state.completed === true,
      UPDATE_INSTALL_UPGRADE_HEALTH_TIMEOUT_MS,
      'update-install.relaunch-timeout',
    );
    const upgradedIdentity = await identity(paths.userData, paths.database);
    assert.deepEqual(
      {
        installId: upgradedIdentity.installId,
        handle: upgradedIdentity.handle,
        metadataHash: upgradedIdentity.metadataHash,
        cipherHash: upgradedIdentity.cipherHash,
      },
      {
        installId: baseIdentity.installId,
        handle: baseIdentity.handle,
        metadataHash: baseIdentity.metadataHash,
        cipherHash: baseIdentity.cipherHash,
      },
    );
    assert.ok(upgradedIdentity.databaseBytes > 0);
    assert.equal(finalState.installRequestCount, 1);
    assert.ok(
      finalState.events.some(
        (event) => event.type === 'upgrade-runtime-ready' && event.version === TARGET,
      ),
    );
    const installed = JSON.parse(
      await readFile(join(paths.install, 'resources', 'app', 'package.json'), 'utf8'),
    ).version;
    const registered = await registryVersion(paths.install);
    assert.equal(installed, TARGET);
    assert.equal(registered, TARGET);
    assert.ok(server.requests.some((request) => request.pathname === '/' + CHANNEL + '.yml'));
    const installerRequests = server.requests.filter(
      (request) => request.method === 'GET' && request.pathname.endsWith('.exe'),
    );
    assert.ok(installerRequests.length > 0);
    const rangeRequests = installerRequests.filter(
      (request) => request.range !== null && request.statusCode === 206,
    );
    assert.ok(rangeRequests.length > 0);
    assert.equal(
      installerRequests.some((request) => request.statusCode === 200),
      false,
    );
    const upgradeInstallerBytes = (await stat(upgradeInstaller)).size;
    const servedInstallerBytes = rangeRequests.reduce(
      (total, request) => total + request.servedBytes,
      0,
    );
    assert.ok(servedInstallerBytes > 0);
    assert.ok(servedInstallerBytes < upgradeInstallerBytes);
    assert.ok(
      rangeRequests.every(
        (request) =>
          request.resourceBytes === upgradeInstallerBytes &&
          request.servedBytes > 0 &&
          request.servedBytes < request.resourceBytes,
      ),
    );
    const blockmapRequests = server.requests.filter((request) =>
      request.pathname.endsWith('.exe.blockmap'),
    );
    assert.ok(blockmapRequests.length > 0);
    assert.ok(server.requests.every((request) => request.authorized && request.secure));
    const result = {
      schemaVersion: 2,
      root,
      baseVersion: BASE,
      targetVersion: TARGET,
      installedVersion: installed,
      registryVersion: registered,
      installRequestCount: finalState.installRequestCount,
      markerId: finalState.markerId,
      runtimeRestarted: true,
      identityStable: true,
      secretHandleStable: true,
      metadataStable: true,
      ciphertextStable: true,
      databasePresent: true,
      installerSigningMode: 'unsigned-fixture',
      unsignedFixtureExplicit: true,
      baseInstallExitCode,
      baseInstallDurationMs,
      baseInstallTimeoutMs: UPDATE_INSTALL_BASE_INSTALL_TIMEOUT_MS,
      nativeUpdaterCacheIsolation: true,
      differentialPackage: true,
      blockmapRequested: blockmapRequests.length > 0,
      blockmapRequestCount: blockmapRequests.length,
      rangeRequestCount: rangeRequests.length,
      partialContentResponseCount: rangeRequests.length,
      fullInstallerBytes: upgradeInstallerBytes,
      servedInstallerBytes,
      savedInstallerBytes: upgradeInstallerBytes - servedInstallerBytes,
      fullInstallerDownloadObserved: installerRequests.some(
        (request) => request.statusCode === 200,
      ),
      currentVersionPreservedUntilInstall: true,
      automaticRollbackAttempted: false,
      diagnostics: {
        stdoutPath: join(paths.logs, 'desktop.stdout.log'),
        stderrPath: join(paths.logs, 'desktop.stderr.log'),
        probePath: paths.probe,
      },
      feedRequests: server.requests,
      probeEvents: finalState.events,
    };
    await writeFile(paths.result, JSON.stringify(result, null, 2) + '\n', 'utf8');
    await markProgress('completed');
    console.log('[update-install] real quitAndInstall E2E passed');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    let cleanupError = null;
    await writeFile(
      join(paths.logs, 'feed-requests.json'),
      JSON.stringify(server?.requests ?? [], null, 2) + '\n',
      'utf8',
    ).catch(() => undefined);
    await server?.close().catch(() => undefined);
    desktop?.kill();
    await cp(join(paths.isolatedUpdaterCache, 'recovery'), paths.recoverySnapshot, {
      recursive: true,
    }).catch(() => undefined);
    try {
      await cleanup(paths.install, paths.localAppData, baseIdentity?.installId ?? '');
    } catch (error) {
      cleanupError = error;
      console.error('[update-install] cleanup failed:', error);
    }
    await rm(paths.handoff, { force: true });
    if (nativeUpdaterCachePrepared) {
      await restoreNativeUpdaterCache(
        paths.nativeUpdaterCache,
        paths.nativeUpdaterCacheBackup,
        nativeUpdaterCacheReserved,
      );
    }
    if (cleanupError) throw cleanupError;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      '[update-install]',
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  });
}
