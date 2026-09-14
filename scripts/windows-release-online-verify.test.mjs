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

test('网络抖动：前两次 fetch 抛错、第三次成功仍判定通过', async () => {
  // 2026-09-14 那次发布实测：CI runner 到站点 3 秒内直接 `fetch failed`，
  // 而同一时刻 SSH 与人工请求都正常。这类瞬时错误必须重试，不能误报发布失败。
  const base = createMockFetch();
  let failures = 0;
  const flaky = async (url, init) => {
    if (failures < 2) {
      failures += 1;
      throw new TypeError('fetch failed', { cause: new Error('EAI_AGAIN') });
    }
    return base(url, init);
  };

  const result = await verifyOnlineWindowsRelease({
    baseUrl: BASE_URL,
    version: VERSION,
    fetchImpl: flaky,
  });

  assert.equal(failures, 2, '应当恰好重试两次');
  assert.deepEqual(result.errors, []);
});

test('网络持续不可用时如实报错，不无限重试', async () => {
  let attempts = 0;
  const dead = async () => {
    attempts += 1;
    throw new TypeError('fetch failed', { cause: new Error('ENOTFOUND') });
  };

  const result = await verifyOnlineWindowsRelease({
    baseUrl: BASE_URL,
    version: VERSION,
    fetchImpl: dead,
  });

  assert.equal(result.ok, false);
  // 两个端点各重试 3 次：channel 元数据、download 全量下载。
  // artifact 的 Range 校验在 metadata 为空时本就跳过，所以不是 9 次。
  assert.equal(attempts, 6);
  assert.ok(result.errors.some((e) => e.startsWith('online-verify.channel_unreachable:')));
});

test('服务器侧直算哈希：不拉回安装包也能断言两个出口一致', async () => {
  const fetchImpl = createMockFetch();
  const result = await verifyOnlineWindowsRelease({
    baseUrl: BASE_URL,
    version: VERSION,
    fetchImpl,
    remoteSha512: async () => createHash('sha512').update(PAYLOAD).digest('hex'),
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.details.downloadEntry.checkedBytes, true);
  assert.equal(result.details.downloadEntry.hashedOnServer, true);
  // 关键：没有发起全量下载（出口带宽只有几百 KB/s，这一步此前要跑一个多小时）
  assert.equal(
    fetchImpl.calls.some((call) => call.url === DOWNLOAD_URL && call.range === null),
    false,
  );
});

test('服务器侧直算哈希同样能检出两个出口分叉', async () => {
  const fetchImpl = createMockFetch();
  const result = await verifyOnlineWindowsRelease({
    baseUrl: BASE_URL,
    version: VERSION,
    fetchImpl,
    remoteSha512: async () => createHash('sha512').update('另一份字节').digest('hex'),
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('online-verify.download_entry_not_identical_to_updates'));
});
