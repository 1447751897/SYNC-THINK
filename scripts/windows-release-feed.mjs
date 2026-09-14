#!/usr/bin/env node
/**
 * CLI wrapper around `windows-generic-update-feed.mjs`, which is a library and
 * exposes no command line of its own.
 *
 * It exists so the release pipeline has one command that turns a built
 * installer into a verified update feed, with the release notes pulled from
 * `docs/releases/CHANGELOG.md` rather than retyped. Retyping is how the feed
 * and the changelog drift apart, and a drifted feed ships users a blank
 * "更新内容" panel.
 *
 *   node scripts/windows-release-feed.mjs generate \
 *     --artifact apps/desktop/release/installer/SYNC-THINK-Setup-0.1.0-rc.6-x64.exe \
 *     --out apps/desktop/release/feed --version 0.1.0-rc.6
 *
 *   node scripts/windows-release-feed.mjs verify --feed-dir apps/desktop/release/feed --version 0.1.0-rc.6
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  CHANGELOG_DEFAULT_PATH,
  findChangelogEntry,
  parseChangelog,
  renderChangelogReleaseNotes,
} from './changelog.mjs';
import {
  verifyWindowsGenericUpdateFeed,
  writeWindowsGenericUpdateFeed,
} from './windows-generic-update-feed.mjs';

const USAGE = `用法:
  node scripts/windows-release-feed.mjs generate --artifact <exe> --out <目录> [选项]
  node scripts/windows-release-feed.mjs verify --feed-dir <目录> [选项]

generate 选项:
  --artifact <路径>      必需。构建产出的安装包（*.exe）。
  --blockmap <路径>      差分索引，默认与安装包同名的 .blockmap。
  --version <版本>       默认从安装包文件名推断。
  --out <目录>           必需。更新源目录（写入 <channel>.yml 与安装包副本）。
  --channel <名称>       默认 latest。
  --changelog <路径>     默认 ${CHANGELOG_DEFAULT_PATH}。
  --release-notes <文本> 应急覆盖，跳过 CHANGELOG（仅用于回填历史版本）。
  --release-date <日期>  默认取 CHANGELOG 中该版本的日期。

verify 选项:
  --feed-dir <目录>      必需。要校验的更新源目录。
`;

function requireArg(value, flag) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`release-feed.missing_argument:${flag}`);
  }
  return value;
}

const ARTIFACT_VERSION_PATTERN = /^SYNC-THINK-Setup-(?<version>.+)-x64\.exe$/i;

export function inferVersionFromArtifact(artifactPath) {
  const match = ARTIFACT_VERSION_PATTERN.exec(basename(artifactPath));
  if (!match) throw new Error(`release-feed.version_required:${basename(artifactPath)}`);
  return match.groups.version;
}

/**
 * Read the release notes for one version out of the changelog.
 *
 * @returns {Promise<{ releaseNotes: string, releaseDate: string | null }>}
 */
export async function readReleaseNotesForVersion(changelogPath, version, override) {
  if (typeof override === 'string' && override.trim().length > 0) {
    return { releaseNotes: override, releaseDate: null };
  }
  const absolute = resolve(changelogPath);
  if (!existsSync(absolute)) throw new Error(`release-feed.changelog_missing:${absolute}`);
  const markdown = await readFile(absolute, 'utf8');
  const { entries } = parseChangelog(markdown);
  const entry = findChangelogEntry(entries, version);
  if (entry === null) {
    throw new Error(`release-feed.changelog_version_missing:${version}`);
  }
  return { releaseNotes: renderChangelogReleaseNotes(entry), releaseDate: entry.date };
}

export async function runGenerate(options) {
  const artifactPath = resolve(requireArg(options.artifact, '--artifact'));
  if (!existsSync(artifactPath)) throw new Error(`release-feed.artifact_missing:${artifactPath}`);
  const version = options.version ?? inferVersionFromArtifact(artifactPath);
  const outputDir = resolve(requireArg(options.out, '--out'));
  const channel = options.channel;
  const changelogPath = options.changelog ?? CHANGELOG_DEFAULT_PATH;

  const { releaseNotes, releaseDate } = await readReleaseNotesForVersion(
    changelogPath,
    version,
    options['release-notes'],
  );
  const effectiveReleaseDate = options['release-date'] ?? releaseDate ?? undefined;

  const written = await writeWindowsGenericUpdateFeed({
    artifactPath,
    blockmapPath: options.blockmap,
    outputDir,
    version,
    channel,
    // The public self-hosted feed is anonymous; the library default is a
    // private channel that demands authorization.
    channelPolicy: { audience: 'public', requiresAuthorization: false },
    releaseNotes,
    releaseDate: effectiveReleaseDate,
    requireBlockmap: true,
  });

  const verification = await verifyWindowsGenericUpdateFeed(outputDir, {
    channel,
    expectedVersion: version,
    requireBlockmap: true,
  });
  if (!verification.ok) {
    throw new Error(`release-feed.verification_failed:${JSON.stringify(verification.errors)}`);
  }

  return {
    version,
    channel,
    outputDir,
    channelFile: written.channelFile,
    releaseDate: effectiveReleaseDate ?? null,
    releaseNotesLength: releaseNotes.length,
    verification,
  };
}

export async function runVerify(options) {
  const feedDir = resolve(requireArg(options['feed-dir'], '--feed-dir'));
  const verification = await verifyWindowsGenericUpdateFeed(feedDir, {
    channel: options.channel,
    expectedVersion: options.version,
    requireBlockmap: true,
  });
  if (!verification.ok) {
    throw new Error(`release-feed.verification_failed:${JSON.stringify(verification.errors)}`);
  }
  return { feedDir, channel: options.channel, version: options.version ?? null, verification };
}

export function parseReleaseFeedArgs(argv) {
  const subcommand = argv[0] !== undefined && !argv[0].startsWith('--') ? argv[0] : 'generate';
  const rest = argv[0] !== undefined && !argv[0].startsWith('--') ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      artifact: { type: 'string' },
      blockmap: { type: 'string' },
      version: { type: 'string' },
      out: { type: 'string' },
      'feed-dir': { type: 'string' },
      channel: { type: 'string', default: 'latest' },
      changelog: { type: 'string' },
      'release-notes': { type: 'string' },
      'release-date': { type: 'string' },
    },
    allowPositionals: false,
  });
  return { subcommand, values };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return;
  }
  const { subcommand, values } = parseReleaseFeedArgs(argv);
  let result;
  if (subcommand === 'generate') {
    result = await runGenerate(values);
  } else if (subcommand === 'verify') {
    result = await runVerify(values);
  } else {
    throw new Error(`release-feed.command_unknown:${subcommand}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, ...result }, null, 2) + '\n');
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]));

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(String(error?.message ?? error) + '\n');
    process.exitCode = 1;
  });
}
