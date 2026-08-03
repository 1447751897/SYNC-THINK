import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DEFAULT_WINDOWS_RELEASE_DIR,
  assertSafeReleaseOutput,
  normalizeWindowsPublisherName,
  verifyWindowsPortableLayout,
} from './windows-portable-release.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKSPACE_ROOT = resolve(SCRIPT_DIR, '..');
const RELEASE_ROOT_PARTS = ['apps', 'desktop', 'release'];

export const WINDOWS_INSTALLER_APP_ID = 'com.syncthink.desktop';
export const DEFAULT_WINDOWS_INSTALLER_DIR = join(
  DEFAULT_WORKSPACE_ROOT,
  ...RELEASE_ROOT_PARTS,
  'installer',
);
export const DEFAULT_WINDOWS_BUILDER_CONFIG = join(
  DEFAULT_WORKSPACE_ROOT,
  'apps',
  'desktop',
  'electron-builder.json',
);
export const INSTALLER_MANIFEST_NAME = 'installer-manifest.json';
export const WINDOWS_INSTALLER_COMPRESSIONS = Object.freeze(['store', 'normal', 'maximum']);
export const WINDOWS_INSTALLER_SIGNING_MODES = Object.freeze(['release', 'unsigned-fixture']);

function toPortableRelative(root, path) {
  return relative(root, path).replaceAll('\\', '/');
}

function normalizedPath(path) {
  return resolve(path).replaceAll('/', sep).toLowerCase();
}

export function assertSafeInstallerInput(workspaceRoot, portableDir, installerDir) {
  const resolvedPortable = assertSafeReleaseOutput(workspaceRoot, resolve(portableDir));
  const resolvedInstaller = assertSafeReleaseOutput(workspaceRoot, resolve(installerDir));
  if (normalizedPath(resolvedPortable) === normalizedPath(resolvedInstaller)) {
    throw new Error('installer.input_output_conflict');
  }
  return { portableDir: resolvedPortable, installerDir: resolvedInstaller };
}

async function sha256(path) {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

function normalizeOptionalString(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeExpectedSignerSha1(value) {
  const normalized = String(value ?? '')
    .replaceAll(/\s/g, '')
    .toUpperCase();
  if (!/^[A-F0-9]{40}$/.test(normalized)) {
    throw new Error('installer.expected_signer_sha1_invalid');
  }
  return normalized;
}

export function normalizeInstallerSigningMode(value) {
  const mode = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!WINDOWS_INSTALLER_SIGNING_MODES.includes(mode)) {
    throw new Error('installer.signing_mode_invalid');
  }
  return mode;
}

function normalizeTimestampServer(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new Error('installer.timestamp_server_invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('installer.timestamp_server_invalid');
  }
  return url.toString();
}

export function resolveWindowsInstallerSigningConfiguration(
  options = {},
  environment = process.env,
) {
  const mode = normalizeInstallerSigningMode(
    options.signingMode ?? environment.SYNC_THINK_WINDOWS_SIGNING_MODE ?? 'release',
  );
  if (mode === 'unsigned-fixture') {
    return {
      mode,
      required: false,
      timestampRequired: false,
      timestampServer: null,
      certificateSource: 'unsigned-fixture',
      expectedSignerSha1: null,
      expectedSignerSubject: null,
      publisherName: null,
      builderArgs: ['--config.win.signExecutable=false'],
      builderEnv: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    };
  }

  const certificateSha1 = normalizeOptionalString(
    options.certificateSha1 ?? environment.SYNC_THINK_WINDOWS_CERTIFICATE_SHA1,
  );
  if (certificateSha1 && !/^[A-Fa-f0-9]{40}$/.test(certificateSha1)) {
    throw new Error('installer.certificate_sha1_invalid');
  }
  const certificateSubjectName = normalizeOptionalString(
    options.certificateSubjectName ?? environment.SYNC_THINK_WINDOWS_CERTIFICATE_SUBJECT,
  );
  const certificateFile = normalizeOptionalString(
    options.certificateFile ?? environment.SYNC_THINK_WINDOWS_CERTIFICATE_FILE,
  );
  const cscLink = normalizeOptionalString(environment.WIN_CSC_LINK ?? environment.CSC_LINK);
  const configuredSources = [
    certificateSha1,
    certificateSubjectName,
    certificateFile,
    cscLink,
  ].filter(Boolean);
  if (configuredSources.length !== 1) {
    throw new Error(
      configuredSources.length === 0
        ? 'installer.signing_certificate_missing'
        : 'installer.signing_certificate_ambiguous',
    );
  }
  const signerPinValue = normalizeOptionalString(
    options.expectedSignerSha1 ?? environment.SYNC_THINK_WINDOWS_EXPECTED_SIGNER_SHA1,
  );
  if (!signerPinValue) throw new Error('installer.signer_pin_missing');
  const expectedSignerSha1 = normalizeExpectedSignerSha1(signerPinValue);
  const publisherNameValue = normalizeOptionalString(
    options.publisherName ?? environment.SYNC_THINK_WINDOWS_PUBLISHER_NAME,
  );
  if (!publisherNameValue) throw new Error('installer.publisher_name_missing');
  let publisherName;
  try {
    publisherName = normalizeWindowsPublisherName(publisherNameValue);
  } catch {
    throw new Error('installer.publisher_name_invalid');
  }
  if (certificateSha1 && certificateSha1.toUpperCase() !== expectedSignerSha1) {
    throw new Error('installer.certificate_signer_pin_mismatch');
  }
  const timestampServerValue = normalizeOptionalString(
    options.timestampServer ?? environment.SYNC_THINK_WINDOWS_RFC3161_TIMESTAMP_SERVER,
  );
  if (!timestampServerValue) throw new Error('installer.timestamp_server_missing');
  const timestampServer = normalizeTimestampServer(timestampServerValue);
  const builderArgs = [
    '--config.forceCodeSigning=true',
    '--config.win.signtoolOptions.rfc3161TimeStampServer=' + timestampServer,
    '--config.win.signtoolOptions.publisherName=' + publisherName,
  ];
  let certificateSource = 'csc-link';
  if (certificateSha1) {
    certificateSource = 'sha1';
    builderArgs.push('--config.win.signtoolOptions.certificateSha1=' + certificateSha1);
  } else if (certificateSubjectName) {
    certificateSource = 'subject';
    builderArgs.push(
      '--config.win.signtoolOptions.certificateSubjectName=' + certificateSubjectName,
    );
  } else if (certificateFile) {
    certificateSource = 'file';
    builderArgs.push('--config.win.signtoolOptions.certificateFile=' + resolve(certificateFile));
  }
  return {
    mode,
    required: true,
    timestampRequired: true,
    timestampServer,
    certificateSource,
    expectedSignerSha1,
    expectedSignerSubject: publisherName,
    publisherName,
    builderArgs,
    builderEnv: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  };
}

async function directoryBytes(root) {
  let bytes = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(path);
    else if (entry.isFile()) bytes += (await stat(path)).size;
  }
  return bytes;
}

async function isNonEmptyFile(path) {
  try {
    const value = await stat(path);
    return value.isFile() && value.size > 0;
  } catch {
    return false;
  }
}

export async function createInstallerArtifactManifest(installerDir, artifactPaths, metadata) {
  const root = resolve(installerDir);
  const signing = metadata.signing;
  if (!signing || !WINDOWS_INSTALLER_SIGNING_MODES.includes(signing.mode)) {
    throw new Error('installer.signing_projection_invalid');
  }
  const signatures = metadata.signatureEvidence ?? new Map();
  const files = [];
  for (const artifactPath of [...new Set(artifactPaths)].sort()) {
    const absolute = resolve(artifactPath);
    const rel = relative(root, absolute);
    if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
      throw new Error('installer.artifact_outside_output');
    }
    const value = await stat(absolute);
    if (!value.isFile() || value.size <= 0) throw new Error('installer.artifact_empty');
    const signature = signatures.get(absolute) ?? null;
    if (signing.required) assertWindowsAuthenticodeProjection(signature, signing);
    files.push({
      path: toPortableRelative(root, absolute),
      bytes: value.size,
      sha256: await sha256(absolute),
      signature: signature ? normalizeAuthenticodeProjection(signature) : null,
    });
  }
  const blockmaps = [];
  for (const blockmapPath of [...new Set(metadata.blockmapPaths ?? [])].sort()) {
    const absolute = resolve(blockmapPath);
    const rel = relative(root, absolute);
    if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
      throw new Error('installer.blockmap_outside_output');
    }
    const value = await stat(absolute);
    if (!value.isFile() || value.size <= 0) throw new Error('installer.blockmap_empty');
    blockmaps.push({
      path: toPortableRelative(root, absolute),
      bytes: value.size,
      sha256: await sha256(absolute),
    });
  }
  if (blockmaps.length !== files.length) throw new Error('installer.blockmap_count_invalid');
  for (const file of files) {
    if (!blockmaps.some((blockmap) => blockmap.path === file.path + '.blockmap')) {
      throw new Error('installer.blockmap_pair_missing');
    }
  }
  const portableBytes = Number(metadata.portableBytes);
  const artifactBytes = [...files, ...blockmaps].reduce((sum, file) => sum + file.bytes, 0);
  const reductionPercent =
    portableBytes > 0 ? Number(((1 - artifactBytes / portableBytes) * 100).toFixed(3)) : 0;
  const signed = signing.required && files.every((file) => file.signature?.status === 'Valid');
  return {
    schemaVersion: 3,
    productName: 'SYNC-THINK',
    appId: WINDOWS_INSTALLER_APP_ID,
    version: metadata.version,
    platform: 'win32',
    arch: 'x64',
    target: 'nsis',
    signed,
    signing: {
      mode: signing.mode,
      required: signing.required,
      timestampRequired: signing.timestampRequired,
      timestampServer: signing.timestampServer,
      certificateSource: signing.certificateSource,
      publisherName: signing.publisherName,
    },
    differentialPackage: true,
    compression: normalizeInstallerCompression(metadata.compression),
    source: { portableBytes },
    build: { durationMs: Math.max(0, Math.round(Number(metadata.buildDurationMs))) },
    size: {
      artifactBytes,
      reductionBytes: Math.max(0, portableBytes - artifactBytes),
      reductionPercent,
    },
    files,
    blockmaps,
  };
}

export async function listWindowsInstallerArtifacts(installerDir) {
  let entries;
  try {
    entries = await readdir(installerDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        extname(entry.name).toLowerCase() === '.exe' &&
        !entry.name.toLowerCase().includes('uninstaller'),
    )
    .map((entry) => join(installerDir, entry.name))
    .sort();
}

export async function listWindowsInstallerBlockmaps(installerDir) {
  let entries;
  try {
    entries = await readdir(installerDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.exe.blockmap'))
    .map((entry) => join(installerDir, entry.name))
    .sort();
}

export async function verifyWindowsInstallerLayout(installerDir, options = {}) {
  const root = resolve(installerDir);
  const errors = [];
  const artifacts = await listWindowsInstallerArtifacts(root);
  const blockmapPaths = await listWindowsInstallerBlockmaps(root);
  if (artifacts.length === 0) errors.push('installer.artifact_missing');
  if (artifacts.length > 1) errors.push('installer.artifact_ambiguous');
  for (const artifact of artifacts) {
    if (!(await isNonEmptyFile(artifact))) errors.push('installer.artifact_empty');
  }

  let manifest = null;
  if (options.requireManifest !== false) {
    try {
      manifest = JSON.parse(await readFile(join(root, INSTALLER_MANIFEST_NAME), 'utf8'));
    } catch {
      errors.push('installer.manifest_missing_or_invalid');
    }
  }

  if (manifest) {
    const currentManifest = manifest.schemaVersion === 3;
    const legacyManifest = manifest.schemaVersion === 2 && options.requireCurrentManifest !== true;
    if (!currentManifest && !legacyManifest) errors.push('installer.manifest_schema_invalid');
    if (currentManifest) {
      if (blockmapPaths.length !== artifacts.length)
        errors.push('installer.blockmap_count_invalid');
      for (const artifact of artifacts) {
        if (!(await isNonEmptyFile(artifact + '.blockmap'))) {
          errors.push('installer.blockmap_pair_missing');
        }
      }
    }
    if (manifest.appId !== WINDOWS_INSTALLER_APP_ID) errors.push('installer.app_id_invalid');
    if (manifest.productName !== 'SYNC-THINK') errors.push('installer.product_name_invalid');
    if (manifest.platform !== 'win32' || manifest.arch !== 'x64' || manifest.target !== 'nsis') {
      errors.push('installer.target_invalid');
    }
    if (currentManifest && manifest.differentialPackage !== true) {
      errors.push('installer.differential_package_invalid');
    }
    let signing = null;
    if (currentManifest) {
      try {
        const mode = normalizeInstallerSigningMode(manifest.signing?.mode);
        let expectedSignerSha1 = null;
        let expectedSignerSubject = null;
        if (mode === 'release') {
          const signerPinValue = normalizeOptionalString(options.expectedSignerSha1);
          if (!signerPinValue) {
            errors.push('installer.signer_pin_missing');
          } else {
            try {
              expectedSignerSha1 = normalizeExpectedSignerSha1(signerPinValue);
            } catch (error) {
              errors.push(
                error instanceof Error ? error.message : 'installer.expected_signer_sha1_invalid',
              );
            }
          }
          const publisherPinValue = normalizeOptionalString(
            options.expectedPublisherName ?? options.expectedSignerSubject,
          );
          if (!publisherPinValue) {
            errors.push('installer.publisher_name_pin_missing');
          } else {
            try {
              expectedSignerSubject = normalizeWindowsPublisherName(publisherPinValue);
            } catch {
              errors.push('installer.publisher_name_pin_invalid');
            }
          }
        }
        signing = {
          mode,
          required: manifest.signing?.required === true,
          timestampRequired: manifest.signing?.timestampRequired === true,
          timestampServer: manifest.signing?.timestampServer ?? null,
          certificateSource: manifest.signing?.certificateSource ?? null,
          publisherName: manifest.signing?.publisherName ?? null,
          expectedSignerSha1,
          expectedSignerSubject,
        };
        if (mode === 'release') {
          if (!signing.required || !signing.timestampRequired || manifest.signed !== true) {
            errors.push('installer.signing_projection_invalid');
          }
          normalizeTimestampServer(signing.timestampServer);
          if (
            !signing.publisherName ||
            !signing.expectedSignerSubject ||
            signing.publisherName !== signing.expectedSignerSubject
          ) {
            errors.push('installer.publisher_name_manifest_mismatch');
          }
        } else if (
          signing.required ||
          signing.timestampRequired ||
          manifest.signed !== false ||
          options.allowUnsignedFixture !== true
        ) {
          errors.push('installer.unsigned_fixture_not_allowed');
        }
      } catch {
        errors.push('installer.signing_projection_invalid');
      }
    }
    try {
      normalizeInstallerCompression(manifest.compression);
    } catch {
      errors.push('installer.compression_invalid');
    }
    if (
      !Number.isSafeInteger(manifest.source?.portableBytes) ||
      manifest.source.portableBytes <= 0
    ) {
      errors.push('installer.source_bytes_invalid');
    }
    if (!Number.isSafeInteger(manifest.build?.durationMs) || manifest.build.durationMs < 0) {
      errors.push('installer.build_duration_invalid');
    }

    const validateRecords = async (records, actualPaths, kind) => {
      if (!Array.isArray(records) || records.length !== actualPaths.length) {
        errors.push('installer.manifest_' + kind + '_invalid');
        return;
      }
      const expected = new Set(actualPaths.map((value) => toPortableRelative(root, value)));
      for (const file of records) {
        const absolute = resolve(root, String(file?.path ?? ''));
        const rel = relative(root, absolute);
        if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
          errors.push('installer.manifest_path_unsafe');
          continue;
        }
        if (!expected.has(toPortableRelative(root, absolute))) {
          errors.push('installer.manifest_' + kind + '_unexpected');
        }
        if (!(await isNonEmptyFile(absolute))) {
          errors.push('installer.manifest_' + kind + '_missing');
          continue;
        }
        const value = await stat(absolute);
        if (value.size !== file.bytes || (await sha256(absolute)) !== file.sha256) {
          errors.push('installer.manifest_digest_mismatch');
        }
        if (kind === 'files' && signing?.mode === 'release') {
          try {
            assertWindowsAuthenticodeProjection(file.signature, signing);
            if (options.verifyAuthenticode !== false) {
              const inspect = options.inspectSignature ?? inspectWindowsAuthenticodeSignature;
              const current = await inspect(absolute);
              const verified = assertWindowsAuthenticodeProjection(current, signing);
              if (
                JSON.stringify(verified) !==
                JSON.stringify(normalizeAuthenticodeProjection(file.signature))
              ) {
                errors.push('installer.signature_manifest_drift');
              }
            }
          } catch (error) {
            errors.push(error instanceof Error ? error.message : 'installer.signature_invalid');
          }
        }
      }
    };
    await validateRecords(manifest.files, artifacts, 'files');
    if (currentManifest) await validateRecords(manifest.blockmaps, blockmapPaths, 'blockmaps');
    if (currentManifest && Array.isArray(manifest.files) && Array.isArray(manifest.blockmaps)) {
      for (const file of manifest.files) {
        if (!manifest.blockmaps.some((blockmap) => blockmap.path === file.path + '.blockmap')) {
          errors.push('installer.blockmap_pair_missing');
        }
      }
      const artifactBytes = [...manifest.files, ...manifest.blockmaps].reduce(
        (sum, file) => sum + (Number.isSafeInteger(file.bytes) ? file.bytes : 0),
        0,
      );
      const portableBytes = manifest.source?.portableBytes;
      const expectedReductionBytes =
        Number.isSafeInteger(portableBytes) && portableBytes > 0
          ? Math.max(0, portableBytes - artifactBytes)
          : null;
      const expectedReductionPercent =
        Number.isSafeInteger(portableBytes) && portableBytes > 0
          ? Number(((1 - artifactBytes / portableBytes) * 100).toFixed(3))
          : null;
      if (
        manifest.size?.artifactBytes !== artifactBytes ||
        manifest.size?.reductionBytes !== expectedReductionBytes ||
        manifest.size?.reductionPercent !== expectedReductionPercent
      ) {
        errors.push('installer.size_metrics_invalid');
      }
    } else if (legacyManifest && Array.isArray(manifest.files)) {
      const artifactBytes = manifest.files.reduce(
        (sum, file) => sum + (Number.isSafeInteger(file.bytes) ? file.bytes : 0),
        0,
      );
      const portableBytes = manifest.source?.portableBytes;
      const expectedReductionBytes =
        Number.isSafeInteger(portableBytes) && portableBytes > 0
          ? Math.max(0, portableBytes - artifactBytes)
          : null;
      const expectedReductionPercent =
        Number.isSafeInteger(portableBytes) && portableBytes > 0
          ? Number(((1 - artifactBytes / portableBytes) * 100).toFixed(3))
          : null;
      if (
        manifest.size?.artifactBytes !== artifactBytes ||
        manifest.size?.reductionBytes !== expectedReductionBytes ||
        manifest.size?.reductionPercent !== expectedReductionPercent
      ) {
        errors.push('installer.size_metrics_invalid');
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    artifacts: artifacts.map((value) => toPortableRelative(root, value)),
    blockmaps: blockmapPaths.map((value) => toPortableRelative(root, value)),
    manifest,
  };
}

function resolveElectronBuilderCli(workspaceRoot) {
  const candidates = [
    join(workspaceRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    join(
      workspaceRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder',
    ),
  ];
  const candidate = candidates.find((path) => existsSync(path));
  if (!candidate) throw new Error('installer.electron_builder_missing');
  if (candidate.endsWith('.js')) return { command: process.execPath, prefixArgs: [candidate] };
  return { command: candidate, prefixArgs: [] };
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
      windowsHide: true,
      shell: false,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        rejectPromise(
          new Error(
            'installer.command_failed:' +
              command +
              ':code=' +
              String(code) +
              ':signal=' +
              String(signal),
          ),
        );
      }
    });
  });
}

async function runCommandCapture(command, args, options = {}) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (value) => {
      stdout += value;
    });
    child.stderr.on('data', (value) => {
      stderr += value;
    });
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else
        rejectPromise(
          new Error(
            'installer.command_failed:' +
              command +
              ':code=' +
              String(code) +
              ':signal=' +
              String(signal),
          ),
        );
    });
  });
}

function normalizeAuthenticodeProjection(value) {
  return {
    status: String(value?.Status ?? value?.status ?? ''),
    signerThumbprint:
      normalizeOptionalString(value?.SignerThumbprint ?? value?.signerThumbprint)?.toUpperCase() ??
      null,
    signerSubject: normalizeOptionalString(value?.SignerSubject ?? value?.signerSubject),
    timestampThumbprint:
      normalizeOptionalString(
        value?.TimestampThumbprint ?? value?.timestampThumbprint,
      )?.toUpperCase() ?? null,
    timestampSubject: normalizeOptionalString(value?.TimestampSubject ?? value?.timestampSubject),
  };
}

export async function inspectWindowsAuthenticodeSignature(artifactPath, options = {}) {
  if (options.projection) return normalizeAuthenticodeProjection(options.projection);
  if (process.platform !== 'win32')
    throw new Error('installer.signature_verification_windows_only');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$signature = Get-AuthenticodeSignature -LiteralPath $env:SYNC_THINK_SIGNATURE_TARGET',
    '[pscustomobject]@{',
    'Status = [string]$signature.Status',
    'SignerThumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null }',
    'SignerSubject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }',
    'TimestampThumbprint = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Thumbprint } else { $null }',
    'TimestampSubject = if ($signature.TimeStamperCertificate) { $signature.TimeStamperCertificate.Subject } else { $null }',
    '} | ConvertTo-Json -Compress',
  ].join('; ');
  const result = await runCommandCapture(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { env: { SYNC_THINK_SIGNATURE_TARGET: resolve(artifactPath) } },
  );
  try {
    return normalizeAuthenticodeProjection(JSON.parse(result.stdout.trim()));
  } catch {
    throw new Error('installer.signature_projection_invalid');
  }
}

export function assertWindowsAuthenticodeProjection(projection, signing) {
  const value = normalizeAuthenticodeProjection(projection);
  if (value.status !== 'Valid' || !value.signerThumbprint || !value.signerSubject) {
    throw new Error('installer.signature_invalid');
  }
  if (signing.timestampRequired && (!value.timestampThumbprint || !value.timestampSubject)) {
    throw new Error('installer.timestamp_missing');
  }
  if (
    signing.expectedSignerSha1 &&
    value.signerThumbprint !== signing.expectedSignerSha1.toUpperCase()
  ) {
    throw new Error('installer.signer_thumbprint_mismatch');
  }
  if (signing.expectedSignerSubject && value.signerSubject !== signing.expectedSignerSubject) {
    throw new Error('installer.signer_subject_mismatch');
  }
  return value;
}

async function readReleaseVersion(workspaceRoot) {
  const packageJson = JSON.parse(await readFile(join(workspaceRoot, 'package.json'), 'utf8'));
  return String(packageJson.version ?? '0.0.0');
}

export function normalizeInstallerVersion(value) {
  const version = String(value ?? '').trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('installer.version_invalid');
  }
  return version;
}

export function normalizeInstallerCompression(value) {
  const compression = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!WINDOWS_INSTALLER_COMPRESSIONS.includes(compression)) {
    throw new Error('installer.compression_invalid');
  }
  return compression;
}

async function readInstallerCompression(builderConfig) {
  const config = JSON.parse(await readFile(builderConfig, 'utf8'));
  return normalizeInstallerCompression(config.compression);
}

export async function buildWindowsInstaller(options = {}) {
  if (process.platform !== 'win32') throw new Error('installer.windows_only');
  const workspaceRoot = resolve(options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT);
  const paths = assertSafeInstallerInput(
    workspaceRoot,
    options.portableDir ?? join(workspaceRoot, ...RELEASE_ROOT_PARTS, 'win-unpacked'),
    options.installerDir ?? join(workspaceRoot, ...RELEASE_ROOT_PARTS, 'installer'),
  );
  const builderConfig = resolve(options.builderConfig ?? DEFAULT_WINDOWS_BUILDER_CONFIG);
  const compression = normalizeInstallerCompression(
    options.compression ?? (await readInstallerCompression(builderConfig)),
  );
  const version = normalizeInstallerVersion(
    options.version ??
      process.env.SYNC_THINK_RELEASE_VERSION ??
      (await readReleaseVersion(workspaceRoot)),
  );
  const signing = resolveWindowsInstallerSigningConfiguration(
    options,
    options.environment ?? process.env,
  );
  const portable = await verifyWindowsPortableLayout(paths.portableDir, {
    signingMode: signing.mode,
    publisherName: signing.publisherName,
    environment: {},
  });
  if (!portable.ok) {
    throw new Error(
      'installer.portable_layout_invalid:' +
        JSON.stringify({ errors: portable.errors, forbiddenFiles: portable.forbiddenFiles }),
    );
  }

  await rm(paths.installerDir, { recursive: true, force: true });
  await mkdir(paths.installerDir, { recursive: true });

  const cli = resolveElectronBuilderCli(workspaceRoot);
  const args = [
    ...cli.prefixArgs,
    '--projectDir',
    workspaceRoot,
    '--config',
    builderConfig,
    '--config.directories.output=' +
      relative(workspaceRoot, paths.installerDir).replaceAll('\\', '/'),
    '--win',
    'nsis',
    '--x64',
    '--prepackaged',
    paths.portableDir,
    '--config.extraMetadata.version=' + version,
    '--config.compression=' + compression,
    ...signing.builderArgs,
  ];
  const buildStartedAt = performance.now();
  await runCommand(cli.command, args, {
    cwd: workspaceRoot,
    env: signing.builderEnv,
  });
  const buildDurationMs = performance.now() - buildStartedAt;

  const artifacts = await listWindowsInstallerArtifacts(paths.installerDir);
  if (artifacts.length !== 1)
    throw new Error('installer.artifact_count_invalid:' + artifacts.length);
  const blockmapPaths = await listWindowsInstallerBlockmaps(paths.installerDir);
  if (blockmapPaths.length !== artifacts.length) {
    throw new Error('installer.blockmap_count_invalid:' + blockmapPaths.length);
  }
  const signatureEvidence = new Map();
  if (signing.required) {
    for (const artifact of artifacts) {
      const projection = await inspectWindowsAuthenticodeSignature(artifact);
      signatureEvidence.set(artifact, assertWindowsAuthenticodeProjection(projection, signing));
    }
  }
  const manifest = await createInstallerArtifactManifest(paths.installerDir, artifacts, {
    version,
    compression,
    signing,
    signatureEvidence,
    blockmapPaths,
    portableBytes: await directoryBytes(paths.portableDir),
    buildDurationMs,
  });
  await writeFile(
    join(paths.installerDir, INSTALLER_MANIFEST_NAME),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  const verification = await verifyWindowsInstallerLayout(paths.installerDir, {
    allowUnsignedFixture: signing.mode === 'unsigned-fixture',
    requireCurrentManifest: true,
    expectedSignerSha1: signing.expectedSignerSha1,
    expectedPublisherName: signing.publisherName,
  });
  if (!verification.ok) {
    throw new Error('installer.layout_invalid:' + JSON.stringify({ errors: verification.errors }));
  }
  return { ...paths, manifest, verification };
}

function readPathArgument(args, name) {
  const index = args.findIndex((value) => value === name);
  if (index >= 0 && args[index + 1]) return resolve(args[index + 1]);
  const inline = args.find((value) => value.startsWith(name + '='));
  return inline ? resolve(inline.slice(name.length + 1)) : undefined;
}

function readValueArgument(args, name) {
  const index = args.findIndex((value) => value === name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  const inline = args.find((value) => value.startsWith(name + '='));
  return inline ? inline.slice(name.length + 1) : undefined;
}

async function main() {
  const [command = 'verify', ...args] = process.argv.slice(2);
  const installerDir = readPathArgument(args, '--out') ?? DEFAULT_WINDOWS_INSTALLER_DIR;
  if (command === 'build') {
    const result = await buildWindowsInstaller({
      installerDir,
      portableDir: readPathArgument(args, '--prepackaged') ?? DEFAULT_WINDOWS_RELEASE_DIR,
      version: readValueArgument(args, '--version'),
      compression: readValueArgument(args, '--compression'),
      signingMode: readValueArgument(args, '--signing-mode'),
      timestampServer: readValueArgument(args, '--timestamp-server'),
      certificateSha1: readValueArgument(args, '--certificate-sha1'),
      expectedSignerSha1: readValueArgument(args, '--expected-signer-sha1'),
      publisherName: readValueArgument(args, '--publisher-name'),
      certificateSubjectName: readValueArgument(args, '--certificate-subject'),
      certificateFile: readPathArgument(args, '--certificate-file'),
    });
    console.log('[installer] Windows NSIS installer ready');
    console.log(
      JSON.stringify(
        {
          installerDir: result.installerDir,
          appId: result.manifest.appId,
          version: result.manifest.version,
          signed: result.manifest.signed,
          compression: result.manifest.compression,
          source: result.manifest.source,
          build: result.manifest.build,
          size: result.manifest.size,
          artifacts: result.verification.artifacts,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'verify') {
    assertSafeReleaseOutput(DEFAULT_WORKSPACE_ROOT, installerDir);
    const result = await verifyWindowsInstallerLayout(installerDir, {
      allowUnsignedFixture: args.includes('--allow-unsigned-fixture'),
      requireCurrentManifest: true,
      expectedSignerSha1:
        readValueArgument(args, '--expected-signer-sha1') ??
        process.env.SYNC_THINK_WINDOWS_EXPECTED_SIGNER_SHA1,
      expectedPublisherName:
        readValueArgument(args, '--publisher-name') ??
        process.env.SYNC_THINK_WINDOWS_PUBLISHER_NAME,
    });
    console.log(JSON.stringify({ installerDir, ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  throw new Error('installer.command_unknown:' + command);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error('[installer]', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
