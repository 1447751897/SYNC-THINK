import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DesktopUpdateSnapshot } from '../desktop-update-contract.js';
import {
  readDesktopUpdatePreferences,
  shouldAutoCheckDesktopUpdates,
  writeDesktopUpdatePreferences,
} from './desktop-update-preferences.js';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sync-think-update-preferences-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const idleSnapshot: DesktopUpdateSnapshot = {
  schemaVersion: 1,
  phase: 'idle',
  configured: true,
  currentVersion: '0.0.1',
  channel: 'latest',
  availableVersion: null,
  progressPercent: null,
  checkedAt: null,
  downloadedAt: null,
  errorCode: null,
};

describe('desktop update preferences', () => {
  it('defaults auto-check on and persists an explicit choice atomically', async () => {
    const root = await tempRoot();
    expect(readDesktopUpdatePreferences(root)).toEqual({ autoCheck: true });

    writeDesktopUpdatePreferences(root, { autoCheck: false });

    expect(readDesktopUpdatePreferences(root)).toEqual({ autoCheck: false });
    await expect(readFile(join(root, 'desktop-update-preferences.json'), 'utf8')).resolves.toBe(
      '{"autoCheck":false}\n',
    );
  });

  it('falls back to the default for malformed preference data', async () => {
    const root = await tempRoot();
    await writeFile(join(root, 'desktop-update-preferences.json'), '{broken', 'utf8');
    expect(readDesktopUpdatePreferences(root)).toEqual({ autoCheck: true });
  });

  it('checks at startup only when the preference and update channel are ready', () => {
    expect(shouldAutoCheckDesktopUpdates({ autoCheck: true }, idleSnapshot)).toBe(true);
    expect(shouldAutoCheckDesktopUpdates({ autoCheck: false }, idleSnapshot)).toBe(false);
    expect(
      shouldAutoCheckDesktopUpdates(
        { autoCheck: true },
        { ...idleSnapshot, configured: false, phase: 'disabled' },
      ),
    ).toBe(false);
    expect(
      shouldAutoCheckDesktopUpdates({ autoCheck: true }, { ...idleSnapshot, phase: 'checking' }),
    ).toBe(false);
  });
});
