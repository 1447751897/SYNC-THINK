import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import { createRequire } from 'node:module';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  sha512Base64,
  verifyWindowsGenericUpdateFeed,
  writeWindowsGenericUpdateFeed,
} from './windows-generic-update-feed.mjs';
import { verifyWindowsInstallerLayout } from './windows-installer-release.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = resolve(SCRIPT_DIR, '..');
const DESKTOP_ROOT = join(WORKSPACE_ROOT, 'apps', 'desktop');
const DRIVER_PATH = join(DESKTOP_ROOT, 'dist', 'main', 'electron-updater-driver.js');
const RUNNER_SOURCE = join(DESKTOP_ROOT, 'tests', 'fixtures', 'desktop-updater-e2e-runner.cjs');
const RESULT_PREFIX = 'SYNC_THINK_UPDATER_E2E_RESULT=';
const CURRENT_VERSION = '0.0.1';
const AUTH_TOKEN = 'loopback-update-token';
const RELEASE_DATE = '2026-08-02T00:00:00.000Z';
const INSTALLER_DIR = join(DESKTOP_ROOT, 'release', 'installer');
const REAL_INSTALLER_PATH = join(INSTALLER_DIR, 'SYNC-THINK-Setup-0.0.1-x64.exe');

function requestPath(requestUrl) {
  return decodeURIComponent(new URL(requestUrl ?? '/', 'https://127.0.0.1').pathname);
}

function collectProcess(child, timeoutMs, timeoutCode) {
  return new Promise((resolveChild, rejectChild) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      rejectChild(new Error(timeoutCode));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectChild(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolveChild({ code, signal, stdout, stderr });
    });
  });
}

async function createHttpsFixtureCertificate(root) {
  const pfxPath = join(root, 'loopback-update-feed.pfx');
  const certificatePath = join(root, 'loopback-update-feed.cer');
  const passphrase = 'sync-think-loopback-fixture';
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$cert = $null',
    'try {',
    "  $cert = New-SelfSignedCertificate -Subject 'CN=SYNC-THINK Update Feed Fixture' -DnsName 'localhost' -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(2)",
    '  $password = ConvertTo-SecureString -String $env:SYNC_THINK_CERT_PASSWORD -AsPlainText -Force',
    '  Export-PfxCertificate -Cert $cert -FilePath $env:SYNC_THINK_CERT_PFX -Password $password | Out-Null',
    '  Export-Certificate -Cert $cert -FilePath $env:SYNC_THINK_CERT_CER -Type CERT | Out-Null',
    '} finally {',
    '  if ($null -ne $cert) { Remove-Item -LiteralPath $cert.PSPath -Force }',
    '}',
  ].join('; ');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      SYNC_THINK_CERT_PASSWORD: passphrase,
      SYNC_THINK_CERT_PFX: pfxPath,
      SYNC_THINK_CERT_CER: certificatePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const result = await collectProcess(child, 30000, 'update-feed.certificate_timeout');
  assert.equal(result.code, 0, `certificate fixture failed: ${result.stderr}`);
  const certificate = new X509Certificate(await readFile(certificatePath));
  return {
    pfx: await readFile(pfxPath),
    passphrase,
    certificateData: certificate.toString(),
  };
}

async function startFixtureServer(root, tlsFixture) {
  const requests = [];
  const server = createServer(
    { pfx: tlsFixture.pfx, passphrase: tlsFixture.passphrase },
    async (request, response) => {
      const pathname = requestPath(request.url);
      const authorized = request.headers.authorization === `Bearer ${AUTH_TOKEN}`;
      requests.push({
        method: request.method,
        pathname,
        authorized,
        secure: request.socket.encrypted === true,
      });
      if (!authorized) {
        response.writeHead(401, { 'Content-Type': 'text/plain', 'Content-Length': '12' });
        response.end('unauthorized');
        return;
      }

      const segments = pathname.split('/').filter(Boolean);
      if (segments.length !== 2) {
        response.writeHead(404).end();
        return;
      }
      const [scenario, filename] = segments;
      if (!/^[a-z0-9-]+$/.test(scenario) || basename(filename) !== filename) {
        response.writeHead(404).end();
        return;
      }

      const path = join(root, scenario, filename);
      let bytes;
      try {
        bytes = await readFile(path);
      } catch {
        response.writeHead(404).end();
        return;
      }

      response.writeHead(200, {
        'Content-Type': filename.endsWith('.yml')
          ? 'text/yaml; charset=utf-8'
          : 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
      });
      if (!filename.endsWith('.exe')) {
        response.end(bytes);
        return;
      }

      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        response.write(bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 4));
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
    baseUrl: `https://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      ),
  };
}

function createFixtureBlockmapBytes(artifactSize) {
  return gzipSync(
    Buffer.from(
      JSON.stringify({
        version: '2',
        files: [
          {
            name: 'file',
            offset: 0,
            checksums: ['fixture-checksum'],
            sizes: [artifactSize],
          },
        ],
      }),
      'utf8',
    ),
  );
}

async function prepareFeed(root, scenario) {
  const feedDir = join(root, scenario.id);
  const artifactName =
    scenario.artifactName ?? `SYNC-THINK-Setup-${scenario.artifactVersion ?? '0.0.2'}-x64.exe`;
  const sourceArtifact = scenario.artifactSource ?? join(root, `${scenario.id}-source.exe`);
  if (!scenario.artifactSource) {
    await writeFile(sourceArtifact, Buffer.alloc(2 * 1024 * 1024, scenario.fillByte ?? 0x5a));
  }
  const sourceArtifactStat = await stat(sourceArtifact);
  const sourceBlockmap = join(root, `${scenario.id}-source.exe.blockmap`);
  await writeFile(sourceBlockmap, createFixtureBlockmapBytes(sourceArtifactStat.size));
  const fixture = await writeWindowsGenericUpdateFeed({
    artifactPath: sourceArtifact,
    blockmapPath: sourceBlockmap,
    artifactName,
    outputDir: feedDir,
    version: scenario.metadataVersion ?? '0.0.2',
    channel: scenario.feedChannel ?? 'latest',
    releaseDate: RELEASE_DATE,
  });

  if (scenario.invalidVersion) {
    const metadata = { ...fixture.metadata, version: scenario.invalidVersion };
    await writeFile(fixture.channelFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  }
  if (scenario.corruptChecksum) {
    const wrongSha512 = Buffer.alloc(64, 0x2a).toString('base64');
    const metadata = {
      ...fixture.metadata,
      sha512: wrongSha512,
      files: fixture.metadata.files.map((file) => ({ ...file, sha512: wrongSha512 })),
    };
    await writeFile(fixture.channelFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  }

  return { feedDir, artifactName, fixture };
}

function collectChild(child, timeoutMs) {
  return new Promise((resolveChild, rejectChild) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      rejectChild(new Error('update-feed.e2e_child_timeout'));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectChild(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(RESULT_PREFIX));
      if (!resultLine) {
        rejectChild(
          new Error(
            `update-feed.e2e_result_missing:exit=${String(code)}:signal=${String(signal)}:stdout=${stdout}:stderr=${stderr}`,
          ),
        );
        return;
      }
      let result;
      try {
        result = JSON.parse(resultLine.slice(RESULT_PREFIX.length));
      } catch (error) {
        rejectChild(error);
        return;
      }
      resolveChild({ code, signal, stdout, stderr, result });
    });
  });
}

async function runElectronScenario(options) {
  const appDir = join(options.root, 'apps', options.id);
  const userDataPath = join(options.root, 'user-data', options.id);
  const localAppData = join(options.root, 'local-app-data', options.id);
  const updaterCacheDirName = `sync-think-updater-e2e-${options.id}`;
  await mkdir(appDir, { recursive: true });
  await mkdir(userDataPath, { recursive: true });
  await mkdir(localAppData, { recursive: true });
  await copyFile(RUNNER_SOURCE, join(appDir, 'main.cjs'));
  await writeFile(
    join(appDir, 'package.json'),
    `${JSON.stringify({ name: `sync-think-updater-e2e-${options.id}`, version: CURRENT_VERSION, main: 'main.cjs' }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(appDir, 'dev-app-update.yml'),
    `updaterCacheDirName: ${updaterCacheDirName}\n`,
    'utf8',
  );

  const child = spawn(options.electronExecutable, [appDir], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      LOCALAPPDATA: localAppData,
      SYNC_THINK_UPDATER_E2E_CONFIG: JSON.stringify({
        driverPath: DRIVER_PATH,
        feedUrl: `${options.baseUrl}/${options.id}/`,
        channel: options.channel ?? 'latest',
        token: AUTH_TOKEN,
        action: options.action ?? 'check',
        userDataPath,
        timeoutMs: options.timeoutMs ?? 45000,
        trustedCertificateData: options.trustedCertificateData ?? null,
      }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const childResult = await collectChild(child, options.childTimeoutMs ?? 60000);
  assert.equal(childResult.code, 0, `${options.id}: ${childResult.stderr}`);
  assert.equal(
    childResult.result.fatal,
    undefined,
    `${options.id}: ${JSON.stringify(childResult.result)}`,
  );
  assert.equal(childResult.result.appVersion, CURRENT_VERSION);
  return {
    ...childResult.result,
    cacheArtifactPath: join(localAppData, updaterCacheDirName, 'pending', options.artifactName),
  };
}

function errorCode(result, phase) {
  return result[`${phase}Error`]?.code ?? null;
}

async function main() {
  await access(DRIVER_PATH);
  await access(RUNNER_SOURCE);
  await access(REAL_INSTALLER_PATH);
  const installerVerification = await verifyWindowsInstallerLayout(INSTALLER_DIR);
  assert.equal(
    installerVerification.ok,
    true,
    `real installer fixture invalid: ${installerVerification.errors.join(',')}`,
  );
  const desktopRequire = createRequire(pathToFileURL(join(DESKTOP_ROOT, 'package.json')));
  const electronExecutable = desktopRequire('electron');
  const root = await mkdtemp(join(tmpdir(), 'sync-think-generic-feed-e2e-'));
  let server = null;
  try {
    const scenarios = [
      { id: 'same-version', metadataVersion: '0.0.1' },
      { id: 'lower-version', metadataVersion: '0.0.0' },
      { id: 'higher-version', metadataVersion: '0.0.2' },
      { id: 'invalid-version', metadataVersion: '0.0.2', invalidVersion: 'not-semver' },
      { id: 'channel-mismatch', metadataVersion: '0.0.2', feedChannel: 'latest', channel: 'beta' },
      { id: 'download-valid', metadataVersion: '0.0.2', action: 'download', fillByte: 0x41 },
      {
        id: 'download-corrupt',
        metadataVersion: '0.0.2',
        action: 'download',
        corruptChecksum: true,
        fillByte: 0x42,
      },
      {
        id: 'https-real-installer',
        metadataVersion: '0.0.2',
        action: 'download',
        artifactSource: REAL_INSTALLER_PATH,
        artifactName: basename(REAL_INSTALLER_PATH),
        timeoutMs: 120000,
        childTimeoutMs: 135000,
      },
    ];
    const prepared = new Map();
    for (const scenario of scenarios) {
      prepared.set(scenario.id, await prepareFeed(root, scenario));
    }

    for (const id of [
      'same-version',
      'lower-version',
      'higher-version',
      'download-valid',
      'https-real-installer',
    ]) {
      const fixture = prepared.get(id);
      const verification = await verifyWindowsGenericUpdateFeed(fixture.feedDir, {
        expectedVersion: scenarios.find((scenario) => scenario.id === id).metadataVersion,
      });
      assert.equal(verification.ok, true, `${id}: ${verification.errors.join(',')}`);
    }

    const tlsFixture = await createHttpsFixtureCertificate(root);
    server = await startFixtureServer(root, tlsFixture);
    const results = new Map();
    for (const scenario of scenarios) {
      const fixture = prepared.get(scenario.id);
      results.set(
        scenario.id,
        await runElectronScenario({
          ...scenario,
          root,
          baseUrl: server.baseUrl,
          electronExecutable,
          artifactName: fixture.artifactName,
          trustedCertificateData: tlsFixture.certificateData,
        }),
      );
    }

    assert.equal(results.get('same-version').checkTerminal?.type, 'not-available');
    assert.equal(results.get('same-version').checkTerminal?.version, '0.0.1');
    assert.equal(errorCode(results.get('same-version'), 'check'), null);

    assert.equal(results.get('lower-version').checkTerminal?.type, 'not-available');
    assert.equal(results.get('lower-version').checkTerminal?.version, '0.0.0');
    assert.equal(errorCode(results.get('lower-version'), 'check'), null);

    assert.equal(results.get('higher-version').checkTerminal?.type, 'available');
    assert.equal(results.get('higher-version').checkTerminal?.version, '0.0.2');
    assert.equal(errorCode(results.get('higher-version'), 'check'), null);

    assert.equal(errorCode(results.get('invalid-version'), 'check'), 'ERR_UPDATER_INVALID_VERSION');
    assert.equal(results.get('invalid-version').checkTerminal, null);

    assert.equal(
      errorCode(results.get('channel-mismatch'), 'check'),
      'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
    );
    assert.equal(results.get('channel-mismatch').checkTerminal, null);

    const validDownload = results.get('download-valid');
    assert.equal(validDownload.checkTerminal?.type, 'available');
    assert.equal(validDownload.downloadTerminal?.type, 'downloaded');
    assert.equal(validDownload.downloadTerminal?.version, '0.0.2');
    assert.equal(errorCode(validDownload, 'download'), null);
    assert.ok(validDownload.events.some((event) => event.type === 'progress' && event.percent > 0));
    await access(validDownload.cacheArtifactPath);
    assert.equal(
      await sha512Base64(validDownload.cacheArtifactPath),
      prepared.get('download-valid').fixture.metadata.sha512,
    );

    const corruptDownload = results.get('download-corrupt');
    assert.equal(corruptDownload.checkTerminal?.type, 'available');
    assert.equal(corruptDownload.downloadTerminal, null);
    assert.equal(errorCode(corruptDownload, 'download'), 'ERR_CHECKSUM_MISMATCH');

    const realInstallerDownload = results.get('https-real-installer');
    assert.equal(realInstallerDownload.checkTerminal?.type, 'available');
    assert.equal(realInstallerDownload.downloadTerminal?.type, 'downloaded');
    assert.equal(realInstallerDownload.downloadTerminal?.version, '0.0.2');
    assert.equal(errorCode(realInstallerDownload, 'download'), null);
    assert.ok(
      realInstallerDownload.events.some((event) => event.type === 'progress' && event.percent > 0),
    );
    const cachedInstallerStat = await stat(realInstallerDownload.cacheArtifactPath);
    const sourceInstallerStat = await stat(REAL_INSTALLER_PATH);
    assert.equal(cachedInstallerStat.size, sourceInstallerStat.size);
    assert.equal(
      await sha512Base64(realInstallerDownload.cacheArtifactPath),
      prepared.get('https-real-installer').fixture.metadata.sha512,
    );

    for (const result of results.values()) {
      assert.ok(result.certificateChecks.length >= 1);
      assert.ok(
        result.certificateChecks.some(
          (check) =>
            check.hostname === '127.0.0.1' &&
            check.hostMatches === true &&
            check.certificateMatches === true &&
            check.accepted === true,
        ),
        JSON.stringify(result.certificateChecks),
      );
      assert.ok(
        result.certificateChecks
          .filter((check) => check.accepted)
          .every((check) => check.hostMatches === true && check.certificateMatches === true),
        JSON.stringify(result.certificateChecks),
      );
    }

    assert.ok(server.requests.length >= scenarios.length);
    assert.ok(server.requests.every((request) => request.authorized));
    assert.ok(server.requests.every((request) => request.secure));
    assert.ok(server.requests.some((request) => request.pathname === '/channel-mismatch/beta.yml'));
    assert.ok(
      server.requests.some((request) =>
        request.pathname.endsWith('/download-valid/SYNC-THINK-Setup-0.0.2-x64.exe'),
      ),
    );
    assert.ok(
      server.requests.some(
        (request) => request.pathname === '/https-real-installer/SYNC-THINK-Setup-0.0.1-x64.exe',
      ),
    );

    const report = scenarios.map((scenario) => {
      const result = results.get(scenario.id);
      return {
        scenario: scenario.id,
        check: result.checkTerminal?.type ?? errorCode(result, 'check') ?? 'none',
        download: result.downloadTerminal?.type ?? errorCode(result, 'download') ?? 'not-requested',
      };
    });
    process.stdout.write(
      `${JSON.stringify({ ok: true, currentVersion: CURRENT_VERSION, requests: server.requests.length, report }, null, 2)}\n`,
    );
  } finally {
    if (server) await server.close();
    await rm(root, { recursive: true, force: true });
  }
}

await main();
