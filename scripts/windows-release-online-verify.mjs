#!/usr/bin/env node
/**
 * 线上发布回归：发布完成后，从公网侧确认用户真正拿到的东西是对的。
 *
 * 这是发布序列的最后一道门禁，断言三件事：
 *   1. 更新源元数据可用且指向本次版本（`/updates/<channel>.yml` 200、version 匹配、releaseNotes 非空）；
 *   2. 安装包支持 Range/206 —— electron-updater 的差分下载依赖它；
 *   3. **两个出口没有分叉**：`/downloads/` 固定名文件的实际字节，
 *      与 `/updates/` 元数据里的 size 与 SHA-512 完全一致。
 *      第 3 条要真的把文件拉下来算哈希，因为「新用户下载到的就是老用户升级到的那一份」
 *      正是 2026-09-14 那次分叉事故里唯一没有被机器校验过的东西。
 *
 *   node scripts/windows-release-online-verify.mjs \
 *     --base-url https://sync-think.online --version 0.1.0-rc.6 \
 *     --publish-dir apps/desktop/release/publish
 *
 * 只读，不改动线上任何东西。`--skip-download` 可跳过第 3 条的全量下载（应急用，会让断言变弱）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  WINDOWS_DOWNLOAD_ENTRY_FILE_NAME,
  verifyWindowsReleasePublish,
} from './windows-release-publish.mjs';

const DEFAULT_BASE_URL = 'https://sync-think.online';
const DEFAULT_CHANNEL = 'latest';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 1_000;
const DEFAULT_REMOTE_PATH = '/srv/sync-think/site';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const USAGE = `用法:
  node scripts/windows-release-online-verify.mjs [选项]

选项:
  --base-url <URL>     站点根地址，默认 ${DEFAULT_BASE_URL}（仅放行 https，回环地址可用 http）。
  --channel <名称>     channel 文件名，默认 ${DEFAULT_CHANNEL}。
  --version <版本>     期望版本；省略则跳过版本比对。
  --publish-dir <目录> 本地发布目录；提供时会断言线上元数据与本地产出同源。
  --skip-download      跳过 /downloads/ 的全量下载哈希校验（会让断言变弱）。
  --ssh-target <user@host>
                       在服务器上直接算 SHA-512（秒级），替代下载 240MB 安装包。
                       需与 --ssh-key 同时提供。
  --ssh-key <路径>     SSH 私钥路径。
  --remote-path <路径> 站点根在服务器上的绝对路径，默认 ${DEFAULT_REMOTE_PATH}。
  --timeout-ms <毫秒>  单次请求超时，默认 ${DEFAULT_TIMEOUT_MS}。
`;

export function normalizeOnlineBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (raw.length === 0) throw new Error('online-verify.base_url_missing');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('online-verify.base_url_invalid:' + raw);
  }
  if (url.protocol === 'http:') {
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error('online-verify.insecure_base_url:' + raw);
    }
  } else if (url.protocol !== 'https:') {
    throw new Error('online-verify.base_url_invalid:' + raw);
  }
  const path = url.pathname.replace(/\/+$/, '');
  return url.origin + path;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * 带退避重试的请求。
 *
 * CI runner 到站点的链路会抖：2026-09-14 那次发布实测出现过 3 秒内直接
 * `fetch failed`（DNS／连接层瞬时错误），而同一时刻 SSH 上传与随后的人工
 * 请求都完全正常。只对**网络层抛错**重试；非 2xx 属于业务结果，交给调用方
 * 判断，不在这里吞掉。
 */
async function fetchWithTimeout(
  fetchImpl,
  url,
  init,
  timeoutMs,
  attempts = DEFAULT_ATTEMPTS,
) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(RETRY_BACKOFF_MS * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/**
 * 在服务器上直接算文件 SHA-512（hex）。
 *
 * 站点出口带宽实测只有几百 KB/s，把 240MB 安装包拉回 runner 校验要一个多
 * 小时；SSH 到同一台机器上 `sha512sum` 是秒级的，断言强度相同。
 */
export function createRemoteSha512({ target, keyPath, remotePath }) {
  return async (relativePath) => {
    const remote = remotePath.replace(/\/+$/, '') + relativePath;
    const result = spawnSync(
      'ssh',
      ['-i', keyPath, '-o', 'IdentitiesOnly=yes', target, 'sha512sum -- ' + remote],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(
        'online-verify.remote_hash_failed:' + String(result.stderr ?? '').trim(),
      );
    }
    const hex = String(result.stdout ?? '').trim().split(/\s+/)[0] ?? '';
    if (!/^[0-9a-f]{128}$/i.test(hex)) {
      throw new Error('online-verify.remote_hash_invalid:' + hex.slice(0, 16));
    }
    return hex.toLowerCase();
  };
}

/** 流式读响应体并算 SHA-512，避免把 200MB+ 安装包整份读进内存。 */
async function hashResponseBody(response) {
  const reader = response.body.getReader();
  const hash = createHash('sha512');
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    bytes += value.byteLength;
  }
  return { sha512: hash.digest('base64'), bytes };
}

async function readLocalChannelMetadata(publishDir, channel) {
  const publishVerification = await verifyWindowsReleasePublish(publishDir, { channel });
  if (!publishVerification.ok) {
    throw new Error(
      'online-verify.local_publish_invalid:' + publishVerification.errors.join(','),
    );
  }
  const channelFile = join(resolve(publishDir), 'updates', channel + '.yml');
  if (!existsSync(channelFile)) throw new Error('online-verify.local_channel_missing');
  return JSON.parse(await readFile(channelFile, 'utf8'));
}

/**
 * @returns {Promise<{ ok: boolean, errors: string[], details: object }>}
 */
export async function verifyOnlineWindowsRelease(options = {}) {
  const baseUrl = normalizeOnlineBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const channel = String(options.channel ?? DEFAULT_CHANNEL).trim() || DEFAULT_CHANNEL;
  const expectedVersion = typeof options.version === 'string' ? options.version.trim() : null;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const checkDownloadHash = options.checkDownloadHash !== false;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  // 若提供，则在服务器上直接算哈希，不再把安装包下载回 runner。
  const remoteSha512 = typeof options.remoteSha512 === 'function' ? options.remoteSha512 : null;
  if (typeof fetchImpl !== 'function') throw new Error('online-verify.fetch_unavailable');

  const errors = [];
  const details = { baseUrl, channel, version: null, releaseNotesLength: 0, artifactRangeOk: false, downloadEntry: null };

  let expectedSha512 = null;
  let expectedSize = null;
  if (typeof options.publishDir === 'string' && options.publishDir.length > 0) {
    const local = await readLocalChannelMetadata(options.publishDir, channel);
    expectedSha512 = local?.files?.[0]?.sha512 ?? null;
    expectedSize = local?.files?.[0]?.size ?? null;
    if (expectedSha512 === null) errors.push('online-verify.local_metadata_incomplete');
    details.expectedSha512 = expectedSha512;
  }

  // 1) channel 元数据
  const channelUrl = baseUrl + '/updates/' + channel + '.yml';
  let metadata = null;
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      channelUrl,
      { headers: { 'cache-control': 'no-cache', pragma: 'no-cache' } },
      timeoutMs,
    );
    if (response.status !== 200) {
      errors.push('online-verify.channel_status:' + response.status);
    } else {
      metadata = JSON.parse(await response.text());
      details.metadataUrl = channelUrl;
    }
  } catch (error) {
    errors.push('online-verify.channel_unreachable:' + (error?.message ?? String(error)));
  }

  const entry = metadata?.files?.[0] ?? null;
  if (metadata !== null) {
    details.version = typeof metadata.version === 'string' ? metadata.version : null;
    details.releaseNotesLength =
      typeof metadata.releaseNotes === 'string' ? metadata.releaseNotes.length : 0;

    if (details.version === null) errors.push('online-verify.version_missing');
    if (expectedVersion !== null && details.version !== expectedVersion) {
      errors.push('online-verify.version_mismatch:' + details.version + '!=' + expectedVersion);
    }
    if (details.releaseNotesLength === 0) {
      // 更新日志为空 = 用户点开「更新内容」看到空白面板，属于发布事故。
      errors.push('online-verify.release_notes_missing');
    }
    if (entry === null || typeof entry.url !== 'string' || entry.url.length === 0) {
      errors.push('online-verify.artifact_url_missing');
    }
    if (entry !== null) {
      if (!Number.isInteger(entry.size) || entry.size <= 0) {
        errors.push('online-verify.artifact_size_invalid');
      }
      if (typeof entry.sha512 !== 'string' || entry.sha512.length === 0) {
        errors.push('online-verify.artifact_sha512_missing');
      } else if (expectedSha512 !== null && entry.sha512 !== expectedSha512) {
        // 线上元数据与本地构建产出不同源 —— 说明线上是别的构建，或上传没落地。
        errors.push('online-verify.artifact_sha512_not_from_this_build');
      }
    }
  }

  // 2) 安装包 Range/206（差分下载依赖）
  if (entry !== null && typeof entry.url === 'string' && entry.url.length > 0) {
    const artifactUrl = baseUrl + '/updates/' + basename(entry.url);
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        artifactUrl,
        { headers: { range: 'bytes=0-0' } },
        timeoutMs,
      );
      if (response.status !== 206) {
        errors.push('online-verify.artifact_range_status:' + response.status);
      } else {
        const contentRange = response.headers.get('content-range') ?? '';
        if (!/^bytes 0-0\//.test(contentRange)) {
          errors.push('online-verify.artifact_content_range_invalid:' + contentRange);
        } else if (expectedSize !== null && Number(contentRange.split('/')[1]) !== expectedSize) {
          errors.push('online-verify.artifact_total_size_mismatch:' + contentRange);
        } else {
          details.artifactRangeOk = true;
        }
      }
      // 显式丢弃剩余 body，避免连接悬挂。
      await response.body?.cancel?.();
    } catch (error) {
      errors.push('online-verify.artifact_unreachable:' + (error?.message ?? String(error)));
    }
  }

  // 3) 新用户下载入口：与更新源逐字节一致
  const downloadUrl = baseUrl + '/downloads/' + WINDOWS_DOWNLOAD_ENTRY_FILE_NAME;
  // 期望尺寸优先取线上元数据（它就是要发出去的那份），本地目录只作回退。
  const expectedDownloadSize = Number.isInteger(entry?.size) ? entry.size : expectedSize;
  details.downloadEntry = { url: downloadUrl, checkedBytes: false };
  try {
    if (checkDownloadHash && remoteSha512) {
      // 服务器侧直算：断言强度与下载全量一致（sha512 相同即内容相同、大小也
      // 必然相同），但省掉一次 240MB 拉取——站点出口带宽实测只有几百 KB/s。
      const hex = await remoteSha512('/downloads/' + WINDOWS_DOWNLOAD_ENTRY_FILE_NAME);
      const sha512 = Buffer.from(hex, 'hex').toString('base64');
      details.downloadEntry.sha512 = sha512;
      details.downloadEntry.checkedBytes = true;
      details.downloadEntry.hashedOnServer = true;
      if (entry?.sha512 && sha512 !== entry.sha512) {
        errors.push('online-verify.download_entry_not_identical_to_updates');
      }
    } else if (checkDownloadHash) {
      const response = await fetchWithTimeout(fetchImpl, downloadUrl, {}, timeoutMs);
      if (response.status !== 200) {
        errors.push('online-verify.download_entry_status:' + response.status);
      } else {
        const { sha512, bytes } = await hashResponseBody(response);
        details.downloadEntry.bytes = bytes;
        details.downloadEntry.sha512 = sha512;
        details.downloadEntry.checkedBytes = true;
        if (expectedDownloadSize !== null && bytes !== expectedDownloadSize) {
          errors.push(
            'online-verify.download_entry_size_mismatch:' + bytes + '!=' + expectedDownloadSize,
          );
        }
        if (entry?.sha512 && sha512 !== entry.sha512) {
          // 核心断言：两个出口分叉。
          errors.push('online-verify.download_entry_not_identical_to_updates');
        }
      }
    } else {
      const response = await fetchWithTimeout(
        fetchImpl,
        downloadUrl,
        { headers: { range: 'bytes=0-0' } },
        timeoutMs,
      );
      const total = Number((response.headers.get('content-range') ?? '').split('/')[1]);
      details.downloadEntry.bytes = Number.isFinite(total) ? total : null;
      await response.body?.cancel?.();
      if (expectedDownloadSize !== null && details.downloadEntry.bytes !== expectedDownloadSize) {
        errors.push(
          'online-verify.download_entry_size_mismatch:' + details.downloadEntry.bytes + '!=' + expectedDownloadSize,
        );
      }
    }
  } catch (error) {
    errors.push('online-verify.download_entry_unreachable:' + (error?.message ?? String(error)));
  }

  // 本地产出自身的双出口一致性（零网络依赖，纯本地）。
  if (typeof options.publishDir === 'string' && options.publishDir.length > 0) {
    const localVerification = await verifyWindowsReleasePublish(options.publishDir, { channel });
    if (!localVerification.ok) {
      errors.push('online-verify.local_publish_invalid:' + localVerification.errors.join(','));
    }
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], details };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return;
  }
  const { values } = parseArgs({
    args: argv,
    options: {
      'base-url': { type: 'string' },
      channel: { type: 'string', default: DEFAULT_CHANNEL },
      version: { type: 'string' },
      'publish-dir': { type: 'string' },
      'skip-download': { type: 'boolean', default: false },
      'ssh-target': { type: 'string' },
      'ssh-key': { type: 'string' },
      'remote-path': { type: 'string' },
      'timeout-ms': { type: 'string' },
    },
    allowPositionals: false,
  });

  const sshTarget = values['ssh-target'];
  const sshKey = values['ssh-key'];
  if ((sshTarget === undefined) !== (sshKey === undefined)) {
    throw new Error('online-verify.ssh_options_incomplete:--ssh-target 与 --ssh-key 必须同时提供');
  }

  const timeoutMs = values['timeout-ms'] === undefined ? undefined : Number(values['timeout-ms']);
  const result = await verifyOnlineWindowsRelease({
    baseUrl: values['base-url'],
    channel: values.channel,
    version: values.version,
    publishDir: values['publish-dir'],
    checkDownloadHash: values['skip-download'] !== true,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
    remoteSha512:
      sshTarget === undefined
        ? undefined
        : createRemoteSha512({
            target: sshTarget,
            keyPath: sshKey,
            remotePath: values['remote-path'] ?? DEFAULT_REMOTE_PATH,
          }),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(String(error?.message ?? error) + '\n');
    process.exitCode = 1;
  });
}
