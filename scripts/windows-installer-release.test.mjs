import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  WINDOWS_INSTALLER_APP_ID,
  assertSafeInstallerInput,
  assertWindowsAuthenticodeProjection,
  createInstallerArtifactManifest,
  normalizeInstallerCompression,
  normalizeExpectedSignerSha1,
  normalizeInstallerSigningMode,
  normalizeInstallerVersion,
  resolveWindowsInstallerSigningConfiguration,
  verifyWindowsInstallerLayout,
} from './windows-installer-release.mjs';

const builderConfigPath = resolve('apps/desktop/electron-builder.json');
const releasePublisherName = 'CN=SYNC-THINK Release, O=SYNC-THINK, C=CN';
const unsignedSigning = resolveWindowsInstallerSigningConfiguration(
  { signingMode: 'unsigned-fixture' },
  {},
);
const releaseSigning = resolveWindowsInstallerSigningConfiguration(
  {
    signingMode: 'release',
    certificateSha1: 'A'.repeat(40),
    expectedSignerSha1: 'A'.repeat(40),
    publisherName: releasePublisherName,
    timestampServer: 'https://timestamp.example.test/rfc3161',
  },
  {},
);
const validSignature = Object.freeze({
  status: 'Valid',
  signerThumbprint: 'A'.repeat(40),
  signerSubject: releasePublisherName,
  timestampThumbprint: 'B'.repeat(40),
  timestampSubject: 'CN=RFC3161 Timestamp',
});

async function installerFixture(root, signing = unsignedSigning, signature = validSignature) {
  const artifact = join(root, 'SYNC-THINK-Setup-0.0.1-x64.exe');
  const blockmap = artifact + '.blockmap';
  await writeFile(artifact, 'installer-bytes');
  await writeFile(blockmap, 'blockmap-bytes');
  const signatureEvidence = new Map();
  if (signing.required) signatureEvidence.set(artifact, signature);
  const manifest = await createInstallerArtifactManifest(root, [artifact], {
    version: '0.0.1',
    compression: 'normal',
    signing,
    signatureEvidence,
    blockmapPaths: [blockmap],
    portableBytes: 100,
    buildDurationMs: 1234.4,
  });
  await writeFile(join(root, 'installer-manifest.json'), JSON.stringify(manifest));
  return { artifact, blockmap, manifest };
}

test('installer input and output stay in distinct controlled release children', () => {
  const root = resolve('D:/workspace/sync-think');
  const portable = join(root, 'apps', 'desktop', 'release', 'win-unpacked');
  const installer = join(root, 'apps', 'desktop', 'release', 'installer');

  assert.deepEqual(assertSafeInstallerInput(root, portable, installer), {
    portableDir: portable,
    installerDir: installer,
  });
  assert.throws(
    () => assertSafeInstallerInput(root, portable, portable),
    /installer\.input_output_conflict/,
  );
  assert.throws(
    () => assertSafeInstallerInput(root, portable, join(root, 'dist', 'installer')),
    /release\.output_unsafe/,
  );
});

test('electron-builder enables signature verification and differential NSIS packages', async () => {
  const config = JSON.parse(await readFile(builderConfigPath, 'utf8'));

  assert.equal(config.appId, WINDOWS_INSTALLER_APP_ID);
  assert.equal(config.productName, 'SYNC-THINK');
  assert.equal(config.electronVersion, '33.2.1');
  assert.equal(config.compression, 'normal');
  assert.equal(config.directories.output, 'apps/desktop/release/installer');
  assert.equal(config.win.icon, 'apps/desktop/build/icon.ico');
  assert.deepEqual(config.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.equal(config.win.executableName, 'SYNC-THINK');
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.equal(config.win.signtoolOptions.publisherName, null);
  assert.deepEqual(config.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.differentialPackage, true);
});

test('signing configuration is explicit, independently pinned and release fail-closed', () => {
  assert.equal(normalizeInstallerSigningMode('UNSIGNED-FIXTURE'), 'unsigned-fixture');
  assert.equal(
    normalizeExpectedSignerSha1('aa aa aa aa aa aa aa aa aa aa aa aa aa aa aa aa aa aa aa aa'),
    'A'.repeat(40),
  );
  assert.throws(() => normalizeInstallerSigningMode('unsigned'), /signing_mode_invalid/);
  assert.throws(
    () => resolveWindowsInstallerSigningConfiguration({ signingMode: 'release' }, {}),
    /signing_certificate_missing/,
  );
  assert.throws(
    () =>
      resolveWindowsInstallerSigningConfiguration(
        { signingMode: 'release', certificateFile: 'fixture.pfx' },
        {},
      ),
    /signer_pin_missing/,
  );
  assert.throws(
    () =>
      resolveWindowsInstallerSigningConfiguration(
        {
          signingMode: 'release',
          certificateFile: 'fixture.pfx',
          expectedSignerSha1: 'A'.repeat(40),
        },
        {},
      ),
    /publisher_name_missing/,
  );
  assert.throws(
    () =>
      resolveWindowsInstallerSigningConfiguration(
        {
          signingMode: 'release',
          certificateSha1: 'A'.repeat(40),
          expectedSignerSha1: 'B'.repeat(40),
          publisherName: releasePublisherName,
          timestampServer: 'https://timestamp.example.test/rfc3161',
        },
        {},
      ),
    /certificate_signer_pin_mismatch/,
  );
  assert.throws(
    () =>
      resolveWindowsInstallerSigningConfiguration(
        {
          signingMode: 'release',
          certificateSha1: 'A'.repeat(40),
          expectedSignerSha1: 'A'.repeat(40),
          publisherName: releasePublisherName,
        },
        {},
      ),
    /timestamp_server_missing/,
  );
  const signing = resolveWindowsInstallerSigningConfiguration(
    {
      signingMode: 'release',
      certificateSha1: 'a'.repeat(40),
      expectedSignerSha1: 'a'.repeat(40),
      publisherName: releasePublisherName,
      timestampServer: 'https://timestamp.example.test/rfc3161',
    },
    { WIN_CSC_KEY_PASSWORD: 'must-never-be-projected' },
  );
  assert.equal(signing.required, true);
  assert.equal(signing.timestampRequired, true);
  assert.equal(signing.expectedSignerSha1, 'A'.repeat(40));
  assert.equal(signing.expectedSignerSubject, releasePublisherName);
  assert.equal(signing.publisherName, releasePublisherName);
  assert.ok(signing.builderArgs.some((value) => value.includes('forceCodeSigning=true')));
  assert.ok(signing.builderArgs.some((value) => value.includes('rfc3161TimeStampServer=')));
  assert.ok(
    signing.builderArgs.includes(
      '--config.win.signtoolOptions.publisherName=' + releasePublisherName,
    ),
  );
  assert.equal(JSON.stringify(signing).includes('must-never-be-projected'), false);
  assert.throws(
    () =>
      resolveWindowsInstallerSigningConfiguration(
        {
          signingMode: 'release',
          certificateSha1: 'A'.repeat(40),
          expectedSignerSha1: 'A'.repeat(40),
          publisherName: releasePublisherName,
        },
        { CSC_LINK: 'second-certificate-source' },
      ),
    /signing_certificate_ambiguous/,
  );
  const unsigned = resolveWindowsInstallerSigningConfiguration(
    { signingMode: 'unsigned-fixture' },
    {
      SYNC_THINK_WINDOWS_EXPECTED_SIGNER_SHA1: 'A'.repeat(40),
      SYNC_THINK_WINDOWS_PUBLISHER_NAME: releasePublisherName,
    },
  );
  assert.equal(unsigned.expectedSignerSha1, null);
  assert.equal(unsigned.expectedSignerSubject, null);
  assert.equal(unsigned.publisherName, null);
});

test('Authenticode projection requires a valid signer and RFC3161 timestamp', () => {
  assert.deepEqual(
    assertWindowsAuthenticodeProjection(validSignature, releaseSigning),
    validSignature,
  );
  assert.throws(
    () =>
      assertWindowsAuthenticodeProjection(
        { ...validSignature, timestampThumbprint: null, timestampSubject: null },
        releaseSigning,
      ),
    /timestamp_missing/,
  );
  assert.throws(
    () =>
      assertWindowsAuthenticodeProjection(
        { ...validSignature, signerThumbprint: 'C'.repeat(40) },
        releaseSigning,
      ),
    /signer_thumbprint_mismatch/,
  );
  assert.throws(
    () =>
      assertWindowsAuthenticodeProjection(
        { ...validSignature, signerSubject: 'CN=SYNC-THINK Release, O=ATTACKER, C=US' },
        releaseSigning,
      ),
    /signer_subject_mismatch/,
  );
});

test('installer version and compression reject unsafe values', () => {
  assert.equal(normalizeInstallerVersion('0.0.2-smoke'), '0.0.2-smoke');
  assert.equal(normalizeInstallerVersion('1.2.3+build.4'), '1.2.3+build.4');
  assert.throws(() => normalizeInstallerVersion('../outside'), /installer\.version_invalid/);
  assert.equal(normalizeInstallerCompression('STORE'), 'store');
  assert.equal(normalizeInstallerCompression('maximum'), 'maximum');
  assert.throws(() => normalizeInstallerCompression('fast'), /installer\.compression_invalid/);
});

test('unsigned fixture manifest records installer and blockmap hashes without secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-installer-manifest-'));
  const { manifest } = await installerFixture(root);

  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.appId, WINDOWS_INSTALLER_APP_ID);
  assert.equal(manifest.signed, false);
  assert.equal(manifest.signing.mode, 'unsigned-fixture');
  assert.equal(manifest.signing.publisherName, null);
  assert.equal(manifest.differentialPackage, true);
  assert.equal(manifest.files[0]?.bytes, 15);
  assert.equal(manifest.blockmaps[0]?.bytes, 14);
  assert.equal(manifest.blockmaps[0]?.path, manifest.files[0]?.path + '.blockmap');
  assert.equal(manifest.size.artifactBytes, 29);
  assert.equal(manifest.size.reductionBytes, 71);
  assert.equal(manifest.size.reductionPercent, 71);
  assert.equal(JSON.stringify(manifest).includes(root), false);
});

test('release manifest requires signed and timestamped evidence and re-verifies projection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-installer-signed-'));
  const { manifest } = await installerFixture(root, releaseSigning);
  assert.equal(manifest.signed, true);
  assert.equal(manifest.signing.publisherName, releasePublisherName);
  assert.equal(manifest.files[0]?.signature?.timestampThumbprint, 'B'.repeat(40));

  const missingPins = await verifyWindowsInstallerLayout(root, {
    inspectSignature: async () => validSignature,
  });
  assert.equal(missingPins.ok, false);
  assert.ok(missingPins.errors.includes('installer.signer_pin_missing'));
  assert.ok(missingPins.errors.includes('installer.publisher_name_pin_missing'));

  const valid = await verifyWindowsInstallerLayout(root, {
    inspectSignature: async () => validSignature,
    expectedSignerSha1: 'A'.repeat(40),
    expectedPublisherName: releasePublisherName,
  });
  assert.equal(valid.ok, true);

  const drift = await verifyWindowsInstallerLayout(root, {
    inspectSignature: async () => ({ ...validSignature, timestampThumbprint: 'C'.repeat(40) }),
    expectedSignerSha1: 'A'.repeat(40),
    expectedPublisherName: releasePublisherName,
  });
  assert.equal(drift.ok, false);
  assert.ok(drift.errors.includes('installer.signature_manifest_drift'));
});

test('external signer and publisher pins reject a coherently replaced installer and manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-installer-replaced-'));
  const attackerPublisher = 'CN=SYNC-THINK Release, O=ATTACKER, C=US';
  const attackerSigning = {
    ...releaseSigning,
    expectedSignerSha1: 'C'.repeat(40),
    expectedSignerSubject: attackerPublisher,
    publisherName: attackerPublisher,
  };
  const attackerSignature = {
    ...validSignature,
    signerThumbprint: 'C'.repeat(40),
    signerSubject: attackerPublisher,
  };
  await installerFixture(root, attackerSigning, attackerSignature);

  const result = await verifyWindowsInstallerLayout(root, {
    inspectSignature: async () => attackerSignature,
    expectedSignerSha1: 'A'.repeat(40),
    expectedPublisherName: releasePublisherName,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('installer.signer_thumbprint_mismatch'));
  assert.ok(result.errors.includes('installer.publisher_name_manifest_mismatch'));
});

test('legacy schema v2 remains readable only through compatibility API mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-installer-legacy-'));
  const { blockmap, manifest } = await installerFixture(root);
  await rm(blockmap);
  const legacyManifest = { ...manifest, schemaVersion: 2 };
  delete legacyManifest.signing;
  delete legacyManifest.differentialPackage;
  delete legacyManifest.blockmaps;
  legacyManifest.size = {
    artifactBytes: manifest.files[0].bytes,
    reductionBytes: 100 - manifest.files[0].bytes,
    reductionPercent: 85,
  };
  await writeFile(join(root, 'installer-manifest.json'), JSON.stringify(legacyManifest));

  const compatible = await verifyWindowsInstallerLayout(root);
  assert.equal(compatible.ok, true);
  assert.deepEqual(compatible.blockmaps, []);

  const strict = await verifyWindowsInstallerLayout(root, { requireCurrentManifest: true });
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.includes('installer.manifest_schema_invalid'));
});

test('installer verifier rejects implicit unsigned use, blockmap corruption and stale metrics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-installer-layout-'));
  const { blockmap, manifest } = await installerFixture(root);

  const implicitUnsigned = await verifyWindowsInstallerLayout(root);
  assert.equal(implicitUnsigned.ok, false);
  assert.ok(implicitUnsigned.errors.includes('installer.unsigned_fixture_not_allowed'));

  const valid = await verifyWindowsInstallerLayout(root, { allowUnsignedFixture: true });
  assert.equal(valid.ok, true);

  await writeFile(blockmap, 'changed-blockmap');
  const stale = await verifyWindowsInstallerLayout(root, { allowUnsignedFixture: true });
  assert.equal(stale.ok, false);
  assert.ok(stale.errors.includes('installer.manifest_digest_mismatch'));

  await writeFile(blockmap, 'blockmap-bytes');
  await writeFile(
    join(root, 'installer-manifest.json'),
    JSON.stringify({ ...manifest, size: { ...manifest.size, artifactBytes: 1 } }),
  );
  const invalidMetrics = await verifyWindowsInstallerLayout(root, { allowUnsignedFixture: true });
  assert.equal(invalidMetrics.ok, false);
  assert.ok(invalidMetrics.errors.includes('installer.size_metrics_invalid'));
});

test('installer verifier reports missing artifact without throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-installer-missing-'));
  await mkdir(root, { recursive: true });
  const result = await verifyWindowsInstallerLayout(root, { requireManifest: false });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('installer.artifact_missing'));
});
