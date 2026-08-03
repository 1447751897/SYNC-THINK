import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { createServer } from 'node:https';
import { access, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWindowsGenericUpdateFeed } from './windows-generic-update-feed.mjs';
import { buildWindowsInstaller } from './windows-installer-release.mjs';
import { verifyWindowsPortableLayout } from './windows-portable-release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = join(ROOT, 'apps', 'desktop', 'release');
const BASE = '0.0.1';
const TARGET = '0.0.2';
const TOKEN = 'update-install-e2e-token';
const CHANNEL = 'latest';
const EXE = 'SYNC-THINK.exe';
const UNINSTALLER = 'Uninstall SYNC-THINK.exe';
const sleep = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const id = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');

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
    const timer = setTimeout(() => {
      child.kill();
      rejectChild(new Error(code));
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
      resolveChild({ exitCode, signal, stdout, stderr });
    });
  });
}

async function run(file, args, options = {}) {
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
  if (result.exitCode !== 0) {
    throw new Error(
      (options.errorCode ?? 'process.failed') +
        ':' +
        result.exitCode +
        ':' +
        (result.stderr || result.stdout),
    );
  }
  return result;
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

async function registryVersion(installDir) {
  const target = join(installDir, UNINSTALLER).replaceAll("'", "''").toLowerCase();
  const command = [
    "$root = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'",
    "$target = '" + target + "'",
    '$version = $null',
    'if (Test-Path -LiteralPath $root) { foreach ($key in Get-ChildItem -LiteralPath $root) { $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue; $value = [string]$entry.UninstallString; if ($value -and $value.ToLowerInvariant().Contains($target)) { $version = [string]$entry.DisplayVersion; break } } }',
    'Write-Output $version',
  ].join('; ');
  return (
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      timeoutMs: 20000,
    })
  ).stdout.trim();
}

async function cleanup(installDir, localAppData, installId) {
  let runtimePid = '';
  try {
    runtimePid = (
      await readFile(join(localAppData, 'SYNC-THINK', 'runtime-' + installId + '.pid'), 'utf8')
    ).trim();
  } catch {}
  const prefix = (installDir.endsWith('\\') ? installDir : installDir + '\\').replaceAll("'", "''");
  const command = [
    "$prefix = '" + prefix + "'",
    'Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and ([string]$_.ExecutablePath).StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    runtimePid
      ? 'Stop-Process -Id ' + Number(runtimePid) + ' -Force -ErrorAction SilentlyContinue'
      : '',
  ]
    .filter(Boolean)
    .join('; ');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    timeoutMs: 20000,
  });
}

async function main() {
  if (process.platform !== 'win32') throw new Error('update-install.windows-only');
  const root = join(ROOT, '.data', 'update-install-e2e-' + id());
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
  };
  paths.database = join(paths.runtimeData, 'sync-think.db');
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
  assert.equal(await readPortableVersion(paths.basePortable), BASE);
  await createUpgradePortable(paths.basePortable, paths.upgradePortable, TARGET);
  const baseBuild = await buildWindowsInstaller({
    portableDir: paths.basePortable,
    installerDir: paths.baseInstaller,
    version: BASE,
    signingMode: 'unsigned-fixture',
  });
  const upgradeBuild = await buildWindowsInstaller({
    portableDir: paths.upgradePortable,
    installerDir: paths.upgradeInstaller,
    version: TARGET,
    signingMode: 'unsigned-fixture',
  });
  const baseInstaller = join(paths.baseInstaller, baseBuild.manifest.files[0].path);
  const upgradeInstaller = join(paths.upgradeInstaller, upgradeBuild.manifest.files[0].path);
  await run(baseInstaller, ['/S', '/D=' + paths.install], {
    env: {
      ...process.env,
      LOCALAPPDATA: paths.localAppData,
    },
    timeoutMs: 120000,
    errorCode: 'update-install.base-install-failed',
  });
  const executable = join(paths.install, EXE);
  await access(executable);
  const updaterCacheDir = join(paths.localAppData, 'sync-think-updater');
  await mkdir(updaterCacheDir, { recursive: true });
  // A fresh manual NSIS install does not populate electron-updater's isolated cache.
  // Seed the exact installed baseline so the E2E represents the state after a prior updater install.
  await cp(baseInstaller, join(updaterCacheDir, 'installer.exe'));
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
  const server = await feedServer(paths.feed, tls);
  let baseIdentity = null;
  let desktop = null;
  try {
    const probe = {
      resultPath: paths.probe,
      userDataPath: paths.userData,
      targetVersion: TARGET,
      markerName: 'Update install E2E ' + basename(root),
      timeoutMs: 480000,
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
        SYNC_THINK_UPDATE_INSTALL_E2E_CONFIG: JSON.stringify(probe),
      },
      stdio: ['ignore', out, err],
      windowsHide: true,
    });
    closeSync(out);
    closeSync(err);
    await waitState(
      paths.probe,
      (state) => state.events?.some((event) => event.type === 'base-runtime-ready'),
      120000,
      'update-install.base-runtime-timeout',
    );
    baseIdentity = await identity(paths.userData, paths.database);
    console.log('[update-install] base ready; waiting for updater relaunch');
    const finalState = await waitState(
      paths.probe,
      (state) => state.completed === true,
      480000,
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
    console.log('[update-install] real quitAndInstall E2E passed');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await writeFile(
      join(paths.logs, 'feed-requests.json'),
      JSON.stringify(server.requests, null, 2) + '\n',
      'utf8',
    ).catch(() => undefined);
    await server.close().catch(() => undefined);
    if (baseIdentity)
      await cleanup(paths.install, paths.localAppData, baseIdentity.installId).catch(
        () => undefined,
      );
    else desktop?.kill();
  }
}

main().catch((error) => {
  console.error(
    '[update-install]',
    error instanceof Error ? (error.stack ?? error.message) : error,
  );
  process.exitCode = 1;
});
