import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { resolveChangelogReleaseNotes } from './changelog.mjs';
import {
  inferVersionFromArtifact,
  parseReleaseFeedArgs,
  readReleaseNotesForVersion,
  runGenerate,
} from './windows-release-feed.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_CHANGELOG_PATH = join(REPO_ROOT, 'docs/releases/CHANGELOG.md');
const VERSION = '0.1.0-rc.5';
const ARTIFACT_NAME = `SYNC-THINK-Setup-${VERSION}-x64.exe`;

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
      { name: 'file', offset: 0, checksums: ['fixture-checksum'], sizes: [artifactBytes.length] },
    ],
  };
  return gzipSync(Buffer.from(JSON.stringify(data), 'utf8'));
}

test('inferVersionFromArtifact extracts the version from the installer file name', () => {
  assert.equal(inferVersionFromArtifact('/tmp/' + ARTIFACT_NAME), VERSION);
  assert.throws(() => inferVersionFromArtifact('/tmp/setup.exe'), /release-feed\.version_required/);
});

test('readReleaseNotesForVersion pulls the notes and date from the repository changelog', async () => {
  const { releaseNotes, releaseDate } = await readReleaseNotesForVersion(REAL_CHANGELOG_PATH, VERSION);
  assert.equal(releaseDate, '2026-09-14');
  assert.match(releaseNotes, /### 新功能/);
  assert.match(releaseNotes, /\n1\. /);
});

test('readReleaseNotesForVersion lets an explicit override win', async () => {
  const { releaseNotes } = await readReleaseNotesForVersion(REAL_CHANGELOG_PATH, VERSION, '手工覆盖内容');
  assert.equal(releaseNotes, '手工覆盖内容');
});

test('readReleaseNotesForVersion reports an unknown version by name', async () => {
  await assert.rejects(
    () => readReleaseNotesForVersion(REAL_CHANGELOG_PATH, '9.9.9'),
    /release-feed\.changelog_version_missing:9\.9\.9/,
  );
});

test('parseReleaseFeedArgs defaults to generate on the latest channel', () => {
  const generated = parseReleaseFeedArgs(['--artifact', 'a.exe', '--out', 'out']);
  assert.equal(generated.subcommand, 'generate');
  assert.equal(generated.values.channel, 'latest');
  assert.equal(generated.values.artifact, 'a.exe');

  const verified = parseReleaseFeedArgs(['verify', '--feed-dir', 'feed']);
  assert.equal(verified.subcommand, 'verify');
  assert.equal(verified.values['feed-dir'], 'feed');
});

test('generate writes a public feed whose release notes come from the changelog', async () => {
  await withTempDir('sync-think-release-feed-', async (root) => {
    const artifact = join(root, ARTIFACT_NAME);
    const bytes = Buffer.from('controlled-installer-bytes', 'utf8');
    await writeFile(artifact, bytes);
    await writeFile(`${artifact}.blockmap`, createBlockmapBytes(bytes));

    const out = join(root, 'feed');
    const result = await runGenerate({
      artifact,
      out,
      version: VERSION,
      channel: 'latest',
      changelog: REAL_CHANGELOG_PATH,
    });

    assert.equal(result.version, VERSION);
    assert.equal(result.releaseDate, '2026-09-14');

    const metadata = JSON.parse(await readFile(join(out, 'latest.yml'), 'utf8'));
    const markdown = await readFile(REAL_CHANGELOG_PATH, 'utf8');

    // The published notes must be byte-identical to the changelog section: this
    // is the assertion that stops the feed and the changelog drifting apart.
    assert.equal(metadata.releaseNotes, resolveChangelogReleaseNotes(markdown, VERSION));
    assert.equal(metadata.version, VERSION);
    assert.equal(metadata.syncThink.channelPolicy.audience, 'public');
    assert.equal(metadata.syncThink.channelPolicy.requiresAuthorization, false);
  });
});
