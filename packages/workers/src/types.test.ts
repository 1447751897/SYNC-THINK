import { describe, it, expect } from 'vitest';
import { isPathInside } from './types.js';
import { FakeDesktopWorker } from './desktop/desktop-worker.js';
import { FakeBrowserWorker } from './browser/browser-worker.js';
import { FakeFileWorker } from './file/file-worker.js';
import { collect } from './support.js';

describe('path traversal guard', () => {
  it('allows paths strictly inside the root', () => {
    expect(isPathInside('D:/proj/a/b.txt', 'D:/proj')).toBe(true);
  });
  it('rejects paths outside the root', () => {
    expect(isPathInside('D:/other/x', 'D:/proj')).toBe(false);
  });
  it('refuses ../ that would escape the root', () => {
    expect(isPathInside('D:/proj/../escape', 'D:/proj')).toBe(false);
  });
  it('handles Windows-style backslashes via template literal', () => {
    const cand = String.raw`D:\proj\file`;
    const root = String.raw`D:\proj`;
    expect(isPathInside(cand, root)).toBe(true);
  });
  it('accepts the root itself as a scoped working directory', () => {
    expect(isPathInside('D:/proj', 'D:/proj')).toBe(true);
  });
});

describe('FakeDesktopWorker', () => {
  it('emits stderr + completed-not-ok', async () => {
    const w = new FakeDesktopWorker();
    const events = await collect(
      w.exec(
        { action: { kind: 'probe' }, workingDir: 'D:/proj' },
        { token: 't', allowedRoot: 'D:/proj', timeoutMs: 1000 },
      ),
    );
    expect(events.some((e) => e.type === 'stderr')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'completed' });
  });
});

describe('FakeBrowserWorker site allowlist', () => {
  it('denies sites not in allowedSites', async () => {
    const w = new FakeBrowserWorker();
    const events = await collect(
      w.exec(
        {
          action: { kind: 'navigate', url: 'https://evil.example' },
          workingDir: 'D:/p',
          allowedSites: ['https://good.example'],
        },
        { token: 't', allowedRoot: 'D:/p', timeoutMs: 1000 },
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: 'failed' });
  });
});

describe('FakeFileWorker traversal forwards to events', () => {
  it('fails fast when relative escapes allowedRoot', async () => {
    const w = new FakeFileWorker();
    const events = await collect(
      w.exec(
        { action: { kind: 'read', relative: '../../escape.txt' }, workingDir: 'D:/proj' },
        { token: 't', allowedRoot: 'D:/other', timeoutMs: 1000 },
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: 'failed', failureClass: 'permission' });
  });
});
