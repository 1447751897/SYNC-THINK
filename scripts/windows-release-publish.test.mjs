import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { sha512Base64, writeWindowsGenericUpdateFeed } from './windows-generic-update-feed.mjs';
import {
  WINDOWS_DOWNLOAD_ENTRY_FILE_NAME,
  buildWindowsReleaseUploadPlan,
  stageWindowsReleasePublish,
  verifyWindowsReleasePublish,
} from './windows-release-publish.mjs';

const TEST_VERSION = '0.1.0-rc.6';
const ARTIFACT_NAME = 'SYNC-THINK-Setup-' + TEST_VERSION + '-x64.exe';

async function withTempDir(prefix, task) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await task(root);
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function createBlockmapBytes(artifactBytes) {
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
  };
  return gzipSync(Buffer.from(JSON.stringify(data), 'utf8'));
}

async function createFeed(root) {
  const artifact = join(root, 'source.exe');
  const artifactBytes = Buffer.from('controlled-installer-bytes', 'utf8');
  await writeFile(artifact, artifactBytes);
  const blockmap = artifact + '.blockmap';
  await writeFile(blockmap, createBlockmapBytes(artifactBytes));

  const feedDir = join(root, 'feed');
  await writeWindowsGenericUpdateFeed({
    artifactPath: artifact,
    blockmapPath: blockmap,
    artifactName: ARTIFACT_NAME,
    outputDir: feedDir,
    version: TEST_VERSION,
    channel: 'latest',
  });
  return { feedDir };
}

test('stage 铺出两个出口，且下载入口与更新源元数据逐字节一致', async () => {
  await withTempDir('sync-think-publish-', async (root) => {
    const { feedDir } = await createFeed(root);
    const publishDir = join(root, 'publish');

    const result = await stageWindowsReleasePublish({ feedDir, outputDir: publishDir });
    assert.equal(result.version, TEST_VERSION);
    assert.equal(result.blockmapName, ARTIFACT_NAME + '.blockmap');

    const metadata = JSON.parse(await readFile(join(publishDir, 'updates', 'latest.yml'), 'utf8'));
    assert.equal(metadata.version, TEST_VERSION);
    assert.equal(metadata.files[0].url, ARTIFACT_NAME);

    // 核心不变量：新用户下载入口必须与老用户更新源是同一个字节流。
    const entryPath = join(publishDir, 'downloads', WINDOWS_DOWNLOAD_ENTRY_FILE_NAME);
    assert.equal(await sha512Base64(entryPath), metadata.files[0].sha512);
    assert.equal(
      await sha512Base64(join(publishDir, 'updates', ARTIFACT_NAME)),
      metadata.files[0].sha512,
    );

    const verification = await verifyWindowsReleasePublish(publishDir);
    assert.equal(verification.ok, true, verification.errors.join(', '));
    assert.equal(verification.version, TEST_VERSION);
  });
});

test('verify 检出被篡改的下载入口（两个出口一旦分叉必须失败）', async () => {
  await withTempDir('sync-think-publish-tamper-', async (root) => {
    const { feedDir } = await createFeed(root);
    const publishDir = join(root, 'publish');
    await stageWindowsReleasePublish({ feedDir, outputDir: publishDir });

    await writeFile(
      join(publishDir, 'downloads', WINDOWS_DOWNLOAD_ENTRY_FILE_NAME),
      Buffer.from('swapped-installer-bytes'),
    );

    const verification = await verifyWindowsReleasePublish(publishDir);
    assert.equal(verification.ok, false);
    assert.ok(verification.errors.includes('release-publish.download_entry_size_mismatch'));
    assert.ok(verification.errors.includes('release-publish.download_entry_sha512_mismatch'));
  });
});

test('verify 检出缺失的下载入口', async () => {
  await withTempDir('sync-think-publish-missing-', async (root) => {
    const { feedDir } = await createFeed(root);
    const publishDir = join(root, 'publish');
    await stageWindowsReleasePublish({ feedDir, outputDir: publishDir });

    await unlink(join(publishDir, 'downloads', WINDOWS_DOWNLOAD_ENTRY_FILE_NAME));

    const verification = await verifyWindowsReleasePublish(publishDir);
    assert.equal(verification.ok, false);
    assert.ok(verification.errors.includes('release-publish.download_entry_missing'));
  });
});

test('stage 拒绝以未通过校验的更新源为输入', async () => {
  await withTempDir('sync-think-publish-badfeed-', async (root) => {
    const { feedDir } = await createFeed(root);
    // 篡改安装包，更新源自身校验会失败。
    await writeFile(join(feedDir, ARTIFACT_NAME), Buffer.from('tampered-installer'));

    await assert.rejects(
      () => stageWindowsReleasePublish({ feedDir, outputDir: join(root, 'publish') }),
      /release-publish\.feed_invalid/,
    );
  });
});

test('stage 拒绝与源目录重叠的输出目录（避免删掉唯一事实来源）', async () => {
  await withTempDir('sync-think-publish-overlap-', async (root) => {
    const { feedDir } = await createFeed(root);

    await assert.rejects(
      () => stageWindowsReleasePublish({ feedDir, outputDir: feedDir }),
      /output_dir_conflicts_with_feed/,
    );
    await assert.rejects(
      () => stageWindowsReleasePublish({ feedDir, outputDir: join(feedDir, 'nested') }),
      /output_dir_conflicts_with_feed/,
    );
    await assert.rejects(
      () => stageWindowsReleasePublish({ feedDir, outputDir: root }),
      /output_dir_conflicts_with_feed/,
    );
  });
});

test('upload 计划覆盖建目录、两个出口与属主修正', () => {
  const plan = buildWindowsReleaseUploadPlan({
    publishDir: '/tmp/publish',
    host: 'example.test',
    user: 'deploy',
    keyPath: '/keys/deploy',
  });

  assert.deepEqual(
    plan.map((step) => step.kind),
    ['mkdir', 'upload-updates', 'upload-downloads', 'chown'],
  );
  const chown = plan.find((step) => step.kind === 'chown');
  assert.ok(chown.argv.join(' ').includes('chown -R syncthink:syncthink'));
  assert.ok(chown.argv.join(' ').includes('/srv/sync-think/site/updates'));
  const uploads = plan.find((step) => step.kind === 'upload-downloads');
  assert.ok(uploads.argv[0] === 'scp');
  assert.ok(uploads.argv.join(' ').includes('deploy@example.test:/srv/sync-think/site/downloads/'));

  assert.throws(
    () =>
      buildWindowsReleaseUploadPlan({
        publishDir: '/tmp/publish',
        user: 'deploy',
        keyPath: '/keys/deploy',
      }),
    /upload_missing_host/,
  );
});
