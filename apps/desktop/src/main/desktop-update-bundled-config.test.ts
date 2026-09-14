import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseBundledDesktopUpdateFeedConfiguration,
  readBundledDesktopUpdateFeedConfiguration,
} from './desktop-update-bundled-config.js';

/**
 * Exactly the bytes `createWindowsUpdateFeedConfig` in
 * scripts/windows-portable-release.mjs writes for the shipped feed. The release
 * test asserts that function against this same literal, so a change to either
 * side of the contract breaks a test instead of silently shipping a sidecar
 * the runtime cannot read.
 */
const RELEASE_SIDECAR_BYTES =
  '{\n  "schemaVersion": 1,\n  "feedUrl": "https://sync-think.online/updates",\n  "channel": "beta"\n}\n';

const temporaryRoots: string[] = [];

function makeTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-update-feed-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('parseBundledDesktopUpdateFeedConfiguration', () => {
  it('accepts a minimal feed document and defaults the channel', () => {
    expect(
      parseBundledDesktopUpdateFeedConfiguration(
        JSON.stringify({ schemaVersion: 1, feedUrl: 'https://sync-think.online/updates' }),
      ),
    ).toEqual({ feedUrl: 'https://sync-think.online/updates', channel: null });
  });

  it('accepts and trims an explicit channel', () => {
    expect(
      parseBundledDesktopUpdateFeedConfiguration(
        JSON.stringify({
          schemaVersion: 1,
          feedUrl: 'https://sync-think.online/updates',
          channel: '  beta  ',
        }),
      ),
    ).toEqual({ feedUrl: 'https://sync-think.online/updates', channel: 'beta' });
  });

  it('treats an empty feed URL as "no bundled feed" so the environment still wins', () => {
    expect(
      parseBundledDesktopUpdateFeedConfiguration(JSON.stringify({ schemaVersion: 1, feedUrl: '' })),
    ).toBeNull();
    expect(
      parseBundledDesktopUpdateFeedConfiguration(
        JSON.stringify({ schemaVersion: 1, feedUrl: '   ' }),
      ),
    ).toBeNull();
  });

  it('returns null for malformed documents instead of half-applying them', () => {
    for (const raw of [
      'not json at all',
      'null',
      '[]',
      '"https://sync-think.online/updates"',
      JSON.stringify({ feedUrl: 'https://sync-think.online/updates' }),
      JSON.stringify({ schemaVersion: 2, feedUrl: 'https://sync-think.online/updates' }),
      JSON.stringify({ schemaVersion: 1, feedUrl: 42 }),
      JSON.stringify({ schemaVersion: 1, feedUrl: 'https://a.test', channel: 7 }),
      JSON.stringify({ schemaVersion: 1, feedUrl: 'https://a.test', channel: '   ' }),
      JSON.stringify({ schemaVersion: 1, feedUrl: 'https://a.test' }) + 'x'.repeat(20 * 1024),
    ]) {
      expect(parseBundledDesktopUpdateFeedConfiguration(raw)).toBeNull();
    }
  });
});

describe('readBundledDesktopUpdateFeedConfiguration', () => {
  it('returns null when the app is not packaged', () => {
    expect(readBundledDesktopUpdateFeedConfiguration(null)).toBeNull();
  });

  it('returns null when the sidecar is absent', () => {
    expect(readBundledDesktopUpdateFeedConfiguration(makeTemporaryRoot())).toBeNull();
  });

  it('reads the sidecar from the resources directory of an installed app', () => {
    const root = makeTemporaryRoot();
    writeFileSync(
      join(root, 'update-feed.json'),
      JSON.stringify({
        schemaVersion: 1,
        feedUrl: 'https://sync-think.online/updates',
        channel: 'latest',
      }),
      'utf8',
    );

    expect(readBundledDesktopUpdateFeedConfiguration(root)).toEqual({
      feedUrl: 'https://sync-think.online/updates',
      channel: 'latest',
    });
  });

  it('degrades to null when the sidecar is corrupt', () => {
    const root = makeTemporaryRoot();
    writeFileSync(join(root, 'update-feed.json'), '{ this is not json', 'utf8');

    expect(readBundledDesktopUpdateFeedConfiguration(root)).toBeNull();
  });

  it('round-trips the exact document the release build writes', () => {
    const root = makeTemporaryRoot();
    writeFileSync(join(root, 'update-feed.json'), RELEASE_SIDECAR_BYTES, 'utf8');

    expect(readBundledDesktopUpdateFeedConfiguration(root)).toEqual({
      feedUrl: 'https://sync-think.online/updates',
      channel: 'beta',
    });
  });

  it('reads a build that shipped without a feed as unconfigured', () => {
    const root = makeTemporaryRoot();
    writeFileSync(
      join(root, 'update-feed.json'),
      '{\n  "schemaVersion": 1,\n  "feedUrl": ""\n}\n',
      'utf8',
    );

    expect(readBundledDesktopUpdateFeedConfiguration(root)).toBeNull();
  });
});
