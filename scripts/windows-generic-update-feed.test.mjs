import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  createWindowsGenericUpdateMetadata,
  normalizeWindowsUpdateArtifactName,
  normalizeWindowsUpdateBlockmapName,
  normalizeWindowsUpdateChannel,
  normalizeWindowsUpdateChannelPolicy,
  normalizeWindowsUpdateVersion,
  sha256Hex,
  sha512Base64,
  verifyWindowsGenericUpdateFeed,
  writeWindowsGenericUpdateFeed,
} from './windows-generic-update-feed.mjs';

async function withTempDir(prefix, task) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await task(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createBlockmapBytes(artifactBytes, blockmap = {}) {
  const data = {
    version: '2',
    files: [
      {
        name: 'file',
        offset: 0,
        checksums: ['fixture-checksum'],
        sizes: [artifactBytes.length],
      },
    ],
    ...blockmap,
  };
  return gzipSync(Buffer.from(JSON.stringify(data), 'utf8'));
}

async function writeArtifactPair(root, name = 'SYNC-THINK-Setup-0.0.2-x64.exe') {
  const artifact = join(root, name);
  const blockmap = artifact + '.blockmap';
  const artifactBytes = Buffer.from('controlled-installer-bytes', 'utf8');
  const blockmapBytes = createBlockmapBytes(artifactBytes);
  await writeFile(artifact, artifactBytes);
  await writeFile(blockmap, blockmapBytes);
  return { artifact, blockmap, artifactBytes, blockmapBytes };
}

test('normalizes strict semver, channel, installer and blockmap names', () => {
  assert.equal(normalizeWindowsUpdateVersion('0.0.2'), '0.0.2');
  assert.equal(normalizeWindowsUpdateVersion('1.2.3-beta.1+build.7'), '1.2.3-beta.1+build.7');
  assert.throws(() => normalizeWindowsUpdateVersion('01.2.3'), /version_invalid/);
  assert.throws(() => normalizeWindowsUpdateVersion('1.2.3-beta.01'), /version_invalid/);
  assert.equal(normalizeWindowsUpdateChannel('beta-1'), 'beta-1');
  assert.throws(() => normalizeWindowsUpdateChannel('../latest'), /channel_invalid/);
  assert.equal(
    normalizeWindowsUpdateArtifactName('SYNC-THINK-Setup-0.0.2-x64.exe'),
    'SYNC-THINK-Setup-0.0.2-x64.exe',
  );
  assert.equal(
    normalizeWindowsUpdateBlockmapName('SYNC-THINK-Setup-0.0.2-x64.exe.blockmap'),
    'SYNC-THINK-Setup-0.0.2-x64.exe.blockmap',
  );
  assert.throws(() => normalizeWindowsUpdateArtifactName('../update.exe'), /artifact_name_invalid/);
  assert.throws(() => normalizeWindowsUpdateBlockmapName('../update.exe.blockmap'), /blockmap_name_invalid/);
});

test('normalizes private channel policy and rejects publishing withdrawn versions', () => {
  const policy = normalizeWindowsUpdateChannelPolicy(
    {
      audience: 'private',
      requiresAuthorization: true,
      rolloutPercent: 25,
      minimumSupportedVersion: '0.0.1',
      allowedVersions: ['0.0.2', '0.0.2'],
      withdrawnVersions: ['0.0.3'],
    },
    { channel: 'closed-beta', version: '0.0.2' },
  );
  assert.deepEqual(policy, {
    schemaVersion: 1,
    channel: 'closed-beta',
    audience: 'private',
    requiresAuthorization: true,
    rolloutPercent: 25,
    minimumSupportedVersion: '0.0.1',
    allowedVersions: ['0.0.2'],
    withdrawnVersions: ['0.0.3'],
  });
  assert.throws(
    () =>
      normalizeWindowsUpdateChannelPolicy(
        { audience: 'private', requiresAuthorization: true, withdrawnVersions: ['0.0.2'] },
        { channel: 'latest', version: '0.0.2' },
      ),
    /version_withdrawn/,
  );
  assert.throws(
    () =>
      normalizeWindowsUpdateChannelPolicy(
        { audience: 'private', requiresAuthorization: false },
        { channel: 'latest', version: '0.0.2' },
      ),
    /private_channel_auth_required/,
  );
});

test('creates electron-updater metadata with installer and blockmap hashes', async () => {
  await withTempDir('sync-think-update-metadata-', async (root) => {
    const { artifact, blockmap, blockmapBytes } = await writeArtifactPair(root);
    const metadata = await createWindowsGenericUpdateMetadata(artifact, {
      version: '0.0.2',
      channel: 'closed-beta',
      blockmapPath: blockmap,
      releaseDate: '2026-08-02T00:00:00.000Z',
      channelPolicy: {
        audience: 'private',
        requiresAuthorization: true,
        allowedVersions: ['0.0.2'],
      },
    });

    assert.equal(metadata.version, '0.0.2');
    assert.equal(metadata.files[0]?.url, 'SYNC-THINK-Setup-0.0.2-x64.exe');
    assert.equal(metadata.files[0]?.size, 26);
    assert.match(metadata.files[0]?.sha512 ?? '', /^[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(metadata.sha512, metadata.files[0]?.sha512);
    assert.equal(metadata.syncThink.blockmap.url, metadata.path + '.blockmap');
    assert.equal(metadata.syncThink.blockmap.size, blockmapBytes.length);
    assert.match(metadata.syncThink.blockmap.sha256, /^[a-f0-9]{64}$/);
    assert.equal(metadata.syncThink.channelPolicy.channel, 'closed-beta');
    assert.equal(metadata.releaseDate, '2026-08-02T00:00:00.000Z');
  });
});

test('fails closed when a paired blockmap is not gzip, JSON, or minimally schema-valid', async () => {
  await withTempDir('sync-think-update-feed-invalid-blockmap-', async (root) => {
    const artifact = join(root, 'source.exe');
    const blockmap = artifact + '.blockmap';
    await writeFile(artifact, 'controlled-installer-bytes');
    const options = {
      artifactPath: artifact,
      blockmapPath: blockmap,
      outputDir: join(root, 'feed'),
      artifactName: 'SYNC-THINK-Setup-0.0.2-x64.exe',
      version: '0.0.2',
      channel: 'latest',
    };

    await writeFile(blockmap, 'not-a-gzip-stream');
    await assert.rejects(
      writeWindowsGenericUpdateFeed(options),
      /update-feed\.blockmap_gzip_invalid/,
    );

    await writeFile(blockmap, gzipSync(Buffer.from('{not-json', 'utf8')));
    await assert.rejects(
      writeWindowsGenericUpdateFeed(options),
      /update-feed\.blockmap_json_invalid/,
    );

    await writeFile(
      blockmap,
      gzipSync(Buffer.from(JSON.stringify({ version: '2', files: [] }), 'utf8')),
    );
    await assert.rejects(
      writeWindowsGenericUpdateFeed(options),
      /update-feed\.blockmap_schema_invalid/,
    );
  });
});

test('fails closed when the paired blockmap is missing by default', async () => {
  await withTempDir('sync-think-update-feed-missing-blockmap-', async (root) => {
    const artifact = join(root, 'source.exe');
    await writeFile(artifact, 'controlled-installer-bytes');

    await assert.rejects(
      writeWindowsGenericUpdateFeed({
        artifactPath: artifact,
        outputDir: join(root, 'feed'),
        artifactName: 'SYNC-THINK-Setup-0.0.2-x64.exe',
        version: '0.0.2',
        channel: 'latest',
      }),
      /update-feed\.blockmap_missing/,
    );
    await assert.rejects(
      writeWindowsGenericUpdateFeed({
        artifactPath: artifact,
        outputDir: join(root, 'feed-explicit-false'),
        artifactName: 'SYNC-THINK-Setup-0.0.2-x64.exe',
        version: '0.0.2',
        channel: 'latest',
        requireBlockmap: false,
      }),
      /update-feed\.legacy_full_download_mode_required/,
    );
  });
});

test('allows an explicitly named legacy full-download fixture and verifies it only in that mode', async () => {
  await withTempDir('sync-think-update-feed-legacy-', async (root) => {
    const artifact = join(root, 'source.exe');
    await writeFile(artifact, 'controlled-installer-bytes');
    const feed = join(root, 'feed');
    await writeWindowsGenericUpdateFeed({
      artifactPath: artifact,
      outputDir: feed,
      artifactName: 'SYNC-THINK-Setup-0.0.2-x64.exe',
      version: '0.0.2',
      channel: 'latest',
      allowLegacyFullDownload: true,
    });

    const strict = await verifyWindowsGenericUpdateFeed(feed);
    assert.equal(strict.ok, false);
    assert.ok(strict.errors.includes('update-feed.blockmap_projection_missing'));
    const legacy = await verifyWindowsGenericUpdateFeed(feed, { allowLegacyFullDownload: true });
    assert.equal(legacy.ok, true);

    await writeFile(artifact + '.blockmap', 'present-but-invalid-blockmap');
    await assert.rejects(
      writeWindowsGenericUpdateFeed({
        artifactPath: artifact,
        outputDir: join(root, 'feed-invalid-legacy'),
        artifactName: 'SYNC-THINK-Setup-0.0.2-x64.exe',
        version: '0.0.2',
        channel: 'latest',
        allowLegacyFullDownload: true,
      }),
      /update-feed\.blockmap_gzip_invalid/,
    );
  });
});

test('writes and verifies a deterministic private Generic feed with blockmap', async () => {
  await withTempDir('sync-think-update-feed-', async (root) => {
    const { artifact, blockmap, blockmapBytes } = await writeArtifactPair(root, 'source.exe');
    const feed = join(root, 'feed');
    const result = await writeWindowsGenericUpdateFeed({
      artifactPath: artifact,
      blockmapPath: blockmap,
      artifactName: 'SYNC-THINK-Setup-0.0.2-x64.exe',
      outputDir: feed,
      version: '0.0.2',
      channel: 'closed-beta',
      releaseDate: '2026-08-02T00:00:00.000Z',
      channelPolicy: {
        audience: 'private',
        requiresAuthorization: true,
        allowedVersions: ['0.0.2'],
        withdrawnVersions: ['0.0.3'],
      },
    });

    assert.equal(result.channel, 'closed-beta');
    assert.equal(JSON.parse(await readFile(result.channelFile, 'utf8')).version, '0.0.2');
    assert.deepEqual(await readFile(result.blockmapPath), blockmapBytes);
    const verification = await verifyWindowsGenericUpdateFeed(feed, {
      channel: 'closed-beta',
      expectedVersion: '0.0.2',
    });
    assert.equal(verification.ok, true);
    assert.deepEqual(verification.errors, []);
  });
});

test('verifier rejects a rehashed blockmap whose gzip JSON fails the minimum schema', async () => {
  await withTempDir('sync-think-update-schema-corrupt-', async (root) => {
    const { artifact, blockmap } = await writeArtifactPair(root, 'source.exe');
    const feed = join(root, 'feed');
    const fixture = await writeWindowsGenericUpdateFeed({
      artifactPath: artifact,
      blockmapPath: blockmap,
      artifactName: 'SYNC-THINK-Setup-0.0.2-x64.exe',
      outputDir: feed,
      version: '0.0.2',
      channel: 'latest',
    });

    const malformed = createBlockmapBytes(Buffer.from('controlled-installer-bytes'), {
      files: [
        {
          name: 'file',
          offset: 0,
          checksums: ['fixture-checksum'],
          sizes: [],
        },
      ],
    });
    await writeFile(fixture.blockmapPath, malformed);
    const metadata = JSON.parse(await readFile(fixture.channelFile, 'utf8'));
    metadata.syncThink.blockmap.size = malformed.length;
    metadata.syncThink.blockmap.sha256 = await sha256Hex(fixture.blockmapPath);
    metadata.syncThink.blockmap.sha512 = await sha512Base64(fixture.blockmapPath);
    await writeFile(fixture.channelFile, JSON.stringify(metadata, null, 2) + '\n', 'utf8');

    const verification = await verifyWindowsGenericUpdateFeed(feed);
    assert.equal(verification.ok, false);
    assert.ok(verification.errors.includes('update-feed.blockmap_schema_invalid'));
    assert.equal(verification.errors.some((error) => error.includes('_mismatch')), false);
  });
});

test('verifier rejects installer, blockmap, path and withdrawal policy tampering', async () => {
  await withTempDir('sync-think-update-corrupt-', async (root) => {
    const { artifact, blockmap } = await writeArtifactPair(root, 'source.exe');
    const feed = join(root, 'feed');
    const fixture = await writeWindowsGenericUpdateFeed({
      artifactPath: artifact,
      blockmapPath: blockmap,
      artifactName: 'SYNC-THINK-Setup-0.0.2-x64.exe',
      outputDir: feed,
      version: '0.0.2',
      channel: 'latest',
    });

    await writeFile(fixture.artifactPath, 'tampered-installer-with-different-size');
    const corrupt = await verifyWindowsGenericUpdateFeed(feed);
    assert.equal(corrupt.ok, false);
    assert.ok(corrupt.errors.includes('update-feed.artifact_size_mismatch'));
    assert.ok(corrupt.errors.includes('update-feed.artifact_sha512_mismatch'));
    assert.ok(corrupt.errors.includes('update-feed.artifact_sha256_mismatch'));

    await writeFile(fixture.artifactPath, 'controlled-installer-bytes');
    await writeFile(fixture.blockmapPath, 'tampered-blockmap');
    const corruptBlockmap = await verifyWindowsGenericUpdateFeed(feed);
    assert.equal(corruptBlockmap.ok, false);
    assert.ok(corruptBlockmap.errors.includes('update-feed.blockmap_size_mismatch'));
    assert.ok(corruptBlockmap.errors.includes('update-feed.blockmap_sha512_mismatch'));

    const unsafeMetadata = {
      ...fixture.metadata,
      path: '../outside.exe',
      files: [{ ...fixture.metadata.files[0], url: '../outside.exe' }],
    };
    await writeFile(fixture.channelFile, JSON.stringify(unsafeMetadata) + '\n', 'utf8');
    const unsafe = await verifyWindowsGenericUpdateFeed(feed);
    assert.equal(unsafe.ok, false);
    assert.ok(unsafe.errors.includes('update-feed.artifact_path_unsafe'));

    const withdrawn = {
      ...fixture.metadata,
      syncThink: {
        ...fixture.metadata.syncThink,
        channelPolicy: {
          ...fixture.metadata.syncThink.channelPolicy,
          withdrawnVersions: ['0.0.2'],
        },
      },
    };
    await writeFile(fixture.channelFile, JSON.stringify(withdrawn) + '\n', 'utf8');
    const withdrawnResult = await verifyWindowsGenericUpdateFeed(feed);
    assert.equal(withdrawnResult.ok, false);
    assert.ok(withdrawnResult.errors.includes('update-feed.version_withdrawn'));
  });
});
