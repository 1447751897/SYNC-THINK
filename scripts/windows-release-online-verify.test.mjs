import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  normalizeOnlineBaseUrl,
  verifyOnlineWindowsRelease,
} from './windows-release-online-verify.mjs';

const VERSION = '0.1.0-rc.6';
const ARTIFACT_NAME = 'SYNC-THINK-Setup-' + VERSION + '-x64.exe';
const DOWNLOAD_NAME = 'SYNC-THINK-Setup-Windows-x64.exe';
const BASE_URL = 'https://sync-think.online';
const CHANNEL_URL = BASE_URL + '/updates/latest.yml';
const ARTIFACT_URL = BASE_URL + '/updates/' + ARTIFACT_NAME;
const DOWNLOAD_URL = BASE_URL + '/downloads/' + DOWNLOAD_NAME;

function sha512Base64(buffer) {
  return createHash('sha512').update(buffer).digest('base64');
}

const PAYLOAD = Buffer.from('sync-think-installer-payload-'.repeat(64), 'utf8');

function channelMetadata(overrides = {}) {
  return {
    version: VERSION,
    files: [
      {
        url: ARTIFACT_NAME,
        sha512: sha512Base64(PAYLOAD),
        size: PAYLOAD.byteLength,
      },
    ],
    releaseNotes: '# v0.1.0-rc.6\n\n- 一条真实的更新日志。\n',
    ...overrides,
  };
}

/**
 * 一个最小的线上替身：channel 元数据、Range/206 安装包、下载入口。
 */
function createMockFetch(options = {}) {
  const metadata = options.metadata ?? channelMetadata();
  const downloadBody = options.downloadBody ?? PAYLOAD;
  const rangeStatus = options.rangeStatus ?? 206;
  const channelStatus = options.channelStatus ?? 200;
  const downloadStatus = options.downloadStatus ?? 200;
  const calls = [];

  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, range: init.headers?.range ?? null });
    if (target === CHANNEL_URL) {
      return new Response(JSON.stringify(metadata), {
        status: channelStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (target === ARTIFACT_URL) {
      return new Response(null, {
        status: rangeStatus,
        headers: { 'content-range': 'bytes 0-0/' + metadata.files[0].size },
      });
    }
    if (target === DOWNLOAD_URL) {
      if (typeof init.headers?.range === 'string') {
        return new Response(null, {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/' + downloadBody.byteLength },
        });
      }
      return new Response(downloadBody, { status: downloadStatus });
    }
    return new Response('not found', { status: 404 });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('全部断言通过：元数据、Range/206 与两个出口逐字节一致', async () => {
  const fetchImpl = createMockFetch();
  const result = await verifyOnlineWindowsRelease({ baseUrl: BASE_URL, version: VERSION, fetchImpl });

  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.details.version, VERSION);
  assert.equal(result.details.artifactRangeOk, true);
  assert.equal(result.details.downloadEntry.checkedBytes, true);
  assert.equal(result.details.downloadEntry.sha512, sha512Base64(PAYLOAD));
});

test('检出下载入口分叉：/downloads/ 的字节不是 /updates/ 的那一份', async () => {
  // 这正是 2026-09-14 那类事故：更新源已是新版，下载页还停在旧版。
  const stale = Buffer.from('stale-installer-from-an-older-release', 'utf8');
  const fetchImpl = createMockFetch({ downloadBody: stale });
  const result = await verifyOnlineWindowsRelease({ baseUrl: BASE_URL, version: VERSION, fetchImpl });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('online-verify.download_entry_not_identical_to_updates'));
  assert.ok(result.errors.includes('online-verify.download_entry_size_mismatch:' + stale.byteLength + '!=' + PAYLOAD.byteLength));
});

test('检出 releaseNotes 缺失 —— 用户会看到空白更新面板', async () => {
  const fetchImpl = createMockFetch({ metadata: channelMetadata({ releaseNotes: '' }) });
  const result = await verifyOnlineWindowsRelease({ baseUrl: BASE_URL, version: VERSION, fetchImpl });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('online-verify.release_notes_missing'));
});

test('检出线上版本与本次发布不一致', async () => {
  const fetchImpl = createMockFetch({ metadata: channelMetadata({ version: '0.1.0-rc.5' }) });
  const result = await verifyOnlineWindowsRelease({ baseUrl: BASE_URL, version: VERSION, fetchImpl });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('online-verify.version_mismatch:0.1.0-rc.5!=' + VERSION));
});

test('检出安装包不支持 Range/206 —— 差分下载会失效', async () => {
  const fetchImpl = createMockFetch({ rangeStatus: 200 });
  const result = await verifyOnlineWindowsRelease({ baseUrl: BASE_URL, version: VERSION, fetchImpl });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('online-verify.artifact_range_status:200'));
  assert.equal(result.details.artifactRangeOk, false);
});

test('--skip-download 只比对长度，不拉全量字节', async () => {
  const fetchImpl = createMockFetch();
  const result = await verifyOnlineWindowsRelease({
    baseUrl: BASE_URL,
    version: VERSION,
    checkDownloadHash: false,
    fetchImpl,
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.details.downloadEntry.checkedBytes, false);
  assert.equal(result.details.downloadEntry.bytes, PAYLOAD.byteLength);
  assert.equal(
    fetchImpl.calls.find((call) => call.url === DOWNLOAD_URL)?.range,
    'bytes=0-0',
  );
});

test('channel 文件不可用时如实报错，而不是假通过', async () => {
  const fetchImpl = createMockFetch({ channelStatus: 404 });
  const result = await verifyOnlineWindowsRelease({ baseUrl: BASE_URL, version: VERSION, fetchImpl });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('online-verify.channel_status:404'));
});

test('拒绝非回环的 http 源（与客户端只接受 HTTPS 的策略一致）', () => {
  assert.throws(() => normalizeOnlineBaseUrl('http://sync-think.online'), /insecure_base_url/);
  assert.equal(normalizeOnlineBaseUrl('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000');
  assert.equal(normalizeOnlineBaseUrl('https://sync-think.online/'), 'https://sync-think.online');
});
