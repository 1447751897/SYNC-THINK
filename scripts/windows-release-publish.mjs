#!/usr/bin/env node
/**
 * Windows 发布双出口。
 *
 * 同一个安装包必须同时出现在两个出口，否则新用户与老用户会拿到不同版本：
 *   updates/   自动更新源，文件名带版本号（`SYNC-THINK-Setup-<version>-x64.exe`）
 *   downloads/ 新用户下载入口，文件名固定（`SYNC-THINK-Setup-Windows-x64.exe`）
 *
 * 本脚本以「已通过校验的更新源目录」为唯一事实来源，把它铺成两个出口，
 * 并校验两个出口的字节一致（downloads 固定名文件的 SHA-512 必须等于
 * 更新源元数据里的 SHA-512）。这样就不会再出现「首页发的是 rc.4、
 * 更新源里是 rc.5」这类分叉。
 *
 * 命令：
 *   stage  --feed-dir <dir> [--out <dir>] [--channel latest]
 *   verify --publish-dir <dir> [--channel latest]
 *   upload --publish-dir <dir> [--host h] [--user u] [--remote-path p] [--key <path>] [--owner o] [--apply]
 *
 * `upload` 默认只打印计划（dry-run），必须显式传 `--apply` 才真正写线上。
 */
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  normalizeWindowsUpdateArtifactName,
  normalizeWindowsUpdateBlockmapName,
  normalizeWindowsUpdateChannel,
  sha512Base64,
  verifyWindowsGenericUpdateFeed,
} from './windows-generic-update-feed.mjs';

/** 新用户下载入口的固定文件名——与站点首页 `index.html` 里的链接一致。 */
export const WINDOWS_DOWNLOAD_ENTRY_FILE_NAME = 'SYNC-THINK-Setup-Windows-x64.exe';

const UPDATES_DIR_NAME = 'updates';
const DOWNLOADS_DIR_NAME = 'downloads';
const DEFAULT_REMOTE_PATH = '/srv/sync-think/site';
const DEFAULT_REMOTE_OWNER = 'syncthink';

function resolveFeedArtifactName(metadata) {
  const url = metadata?.files?.[0]?.url;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('release-publish.feed_artifact_missing');
  }
  // 经 normalize 校验，拒绝路径穿越与非法名字。
  return normalizeWindowsUpdateArtifactName(basename(url));
}

async function copyIfPresent(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) return false;
  await copyFile(sourcePath, targetPath);
  return true;
}

/**
 * stage 会先清空输出目录，所以输出目录绝不能与源 feed 目录互相包含，
 * 否则会把唯一的发布事实来源删掉。
 */
function assertNoPathOverlap(feedDir, outputDir) {
  const norm = (value) => resolve(value).toLowerCase();
  const feed = norm(feedDir);
  const output = norm(outputDir);
  if (feed === output || feed.startsWith(output + sep) || output.startsWith(feed + sep)) {
    throw new Error('release-publish.output_dir_conflicts_with_feed');
  }
}

/**
 * 把已校验的更新源目录铺成两个出口。
 *
 * @returns 摘要：版本、两侧路径、安装包字节数与 SHA-512。
 */
export async function stageWindowsReleasePublish(options) {
  const feedDir = resolve(options.feedDir);
  const outputDir = resolve(options.outputDir);
  const channel = normalizeWindowsUpdateChannel(options.channel ?? 'latest');
  assertNoPathOverlap(feedDir, outputDir);

  const verification = await verifyWindowsGenericUpdateFeed(feedDir, { channel });
  if (!verification.ok) {
    throw new Error('release-publish.feed_invalid: ' + verification.errors.join(', '));
  }
  const metadata = verification.metadata;
  const artifactName = resolveFeedArtifactName(metadata);

  const updatesDir = join(outputDir, UPDATES_DIR_NAME);
  const downloadsDir = join(outputDir, DOWNLOADS_DIR_NAME);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(updatesDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });

  const channelFile = join(updatesDir, channel + '.yml');
  await copyFile(join(feedDir, channel + '.yml'), channelFile);
  await copyFile(join(feedDir, artifactName), join(updatesDir, artifactName));

  let blockmapName = null;
  const rawBlockmapUrl = metadata?.syncThink?.blockmap?.url;
  if (typeof rawBlockmapUrl === 'string' && rawBlockmapUrl.length > 0) {
    blockmapName = normalizeWindowsUpdateBlockmapName(basename(rawBlockmapUrl));
    const copied = await copyIfPresent(
      join(feedDir, blockmapName),
      join(updatesDir, blockmapName),
    );
    if (!copied) blockmapName = null;
  }

  const downloadEntryPath = join(downloadsDir, WINDOWS_DOWNLOAD_ENTRY_FILE_NAME);
  await copyFile(join(feedDir, artifactName), downloadEntryPath);

  const entry = metadata.files[0];
  return {
    channel,
    version: metadata.version,
    outputDir,
    updatesDir,
    downloadsDir,
    channelFile,
    artifactPath: join(updatesDir, artifactName),
    blockmapName,
    downloadEntryPath,
    size: entry.size,
    sha512: entry.sha512,
  };
}

/**
 * 校验一个发布目录：更新源自身合法，且下载入口与更新源逐字节一致。
 */
export async function verifyWindowsReleasePublish(publishDir, options = {}) {
  const root = resolve(publishDir);
  const channel = normalizeWindowsUpdateChannel(options.channel ?? 'latest');
  const errors = [];

  const verification = await verifyWindowsGenericUpdateFeed(join(root, UPDATES_DIR_NAME), {
    channel,
  });
  errors.push(...verification.errors);
  const metadata = verification.metadata;

  const entryPath = join(root, DOWNLOADS_DIR_NAME, WINDOWS_DOWNLOAD_ENTRY_FILE_NAME);
  let entryStat = null;
  try {
    entryStat = await stat(entryPath);
  } catch {
    errors.push('release-publish.download_entry_missing');
  }

  if (entryStat !== null) {
    if (!entryStat.isFile() || entryStat.size <= 0) {
      errors.push('release-publish.download_entry_invalid');
    } else if (metadata?.files?.[0]) {
      const expected = metadata.files[0];
      // 核心不变量：两个出口必须是同一个字节流。
      if (entryStat.size !== expected.size) {
        errors.push('release-publish.download_entry_size_mismatch');
      }
      if (expected.sha512 !== (await sha512Base64(entryPath))) {
        errors.push('release-publish.download_entry_sha512_mismatch');
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    version: metadata?.version ?? null,
  };
}

/**
 * 构造上传计划。返回命令数组，CLI 负责执行或打印。
 *
 * 上传后必须 `chown`：站点由 Caddy 以 `syncthink` 身份读取，
 * 若以 root 直传，文件属主会变成 root，Caddy 读不到。
 */
export function buildWindowsReleaseUploadPlan(options) {
  const host = options.host;
  const user = options.user;
  const keyPath = options.keyPath;
  const remotePath = options.remotePath ?? DEFAULT_REMOTE_PATH;
  const owner = options.owner ?? DEFAULT_REMOTE_OWNER;
  const publishDir = resolve(options.publishDir);

  for (const [name, value] of [
    ['host', host],
    ['user', user],
    ['keyPath', keyPath],
  ]) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error('release-publish.upload_missing_' + name);
    }
  }

  const target = user + '@' + host;
  const sshBase = ['ssh', '-i', keyPath, '-o', 'IdentitiesOnly=yes', target];
  const scpBase = ['scp', '-i', keyPath, '-o', 'IdentitiesOnly=yes'];
  const updatesDir = join(publishDir, UPDATES_DIR_NAME);
  const downloadsDir = join(publishDir, DOWNLOADS_DIR_NAME);

  return [
    {
      kind: 'mkdir',
      argv: [...sshBase, 'mkdir -p ' + remotePath + '/updates ' + remotePath + '/downloads'],
    },
    {
      kind: 'upload-updates',
      argv: [...scpBase, updatesDir + '/.', target + ':' + remotePath + '/updates/'],
    },
    {
      kind: 'upload-downloads',
      argv: [...scpBase, downloadsDir + '/.', target + ':' + remotePath + '/downloads/'],
    },
    {
      kind: 'chown',
      argv: [
        ...sshBase,
        'chown -R ' + owner + ':' + owner + ' ' + remotePath + '/updates ' + remotePath + '/downloads',
      ],
    },
  ];
}

function runPlan(plan, { apply }) {
  for (const step of plan) {
    if (!apply) {
      console.log('[dry-run] ' + step.kind + ': ' + step.argv.join(' '));
      continue;
    }
    console.log('[run] ' + step.kind);
    const result = spawnSync(step.argv[0], step.argv.slice(1), { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error('release-publish.step_failed: ' + step.kind);
    }
  }
}

function requireOption(values, name, envName) {
  const value = values[name] ?? (envName ? process.env[envName] : undefined);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('release-publish.missing_option: --' + name + (envName ? ' (或 ' + envName + ')' : ''));
  }
  return value.trim();
}

async function main() {
  const [command = 'verify', ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      'feed-dir': { type: 'string' },
      'publish-dir': { type: 'string' },
      out: { type: 'string' },
      channel: { type: 'string', default: 'latest' },
      version: { type: 'string' },
      host: { type: 'string' },
      user: { type: 'string' },
      key: { type: 'string' },
      'remote-path': { type: 'string' },
      owner: { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  if (command === 'stage') {
    const feedDir = requireOption(values, 'feed-dir');
    const outputDir = values.out ?? feedDir + '-publish';
    const result = await stageWindowsReleasePublish({
      feedDir,
      outputDir,
      channel: values.channel,
    });
    const verification = await verifyWindowsReleasePublish(outputDir, { channel: values.channel });
    if (!verification.ok) {
      console.error('双出口校验失败: ' + verification.errors.join(', '));
      process.exitCode = 1;
      return;
    }
    console.log(
      '双出口就绪 v' + result.version + ' (' + result.sha512.slice(0, 16) + '…)\n' +
        '  updates/   ' + result.artifactPath + '\n' +
        '  downloads/ ' + result.downloadEntryPath,
    );
    return;
  }

  if (command === 'verify') {
    const publishDir = requireOption(values, 'publish-dir');
    const result = await verifyWindowsReleasePublish(publishDir, { channel: values.channel });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === 'upload') {
    const plan = buildWindowsReleaseUploadPlan({
      publishDir: requireOption(values, 'publish-dir'),
      host: requireOption(values, 'host', 'SYNC_THINK_DEPLOY_HOST'),
      user: requireOption(values, 'user', 'SYNC_THINK_DEPLOY_USER'),
      keyPath: requireOption(values, 'key', 'SYNC_THINK_DEPLOY_KEY_PATH'),
      remotePath: values['remote-path'],
      owner: values.owner,
    });
    runPlan(plan, { apply: values.apply === true });
    if (!values.apply) console.log('（dry-run，未写入线上；确认无误后加 --apply）');
    return;
  }

  console.error('未知命令: ' + command + '（可用: stage / verify / upload）');
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
