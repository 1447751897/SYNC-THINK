/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadShellPanel, shellChunkRetryUrl } from './shell-chunk-retry.js';

afterEach(() => {
  delete window.__syncThinkShellChunks;
});

describe('native ESM retry addresses', () => {
  it('gives each explicit retry a new local chunk address', () => {
    window.__syncThinkShellChunks = { SettingsPage: './chunks/SettingsPage-HASH.js' };
    expect(shellChunkRetryUrl('SettingsPage', 1)).toContain(
      '/chunks/SettingsPage-HASH.js?shellRetry=1',
    );
    expect(shellChunkRetryUrl('SettingsPage', 2)).toContain('?shellRetry=2');
    expect(shellChunkRetryUrl('MissingPage', 1)).toBeUndefined();
    expect(shellChunkRetryUrl('SettingsPage', 1)).not.toBe(shellChunkRetryUrl('SettingsPage', 1));
  });

  it.each([
    'https://example.com/code.js',
    '../outside.js',
    './chunks/../outside.js',
    './chunks/code.js?other=1',
  ])('ignores an invalid chunk mapping: %s', (path) => {
    window.__syncThinkShellChunks = { SettingsPage: path };
    expect(shellChunkRetryUrl('SettingsPage', 1)).toBeUndefined();
  });

  it('keeps the normal static import on first load and in unbundled tests', async () => {
    const load = vi.fn(async () => ({ default: () => null }));
    window.__syncThinkShellChunks = { SettingsPage: './chunks/SettingsPage-HASH.js' };
    await loadShellPanel(load, 'SettingsPage', 0);
    delete window.__syncThinkShellChunks;
    await loadShellPanel(load, 'SettingsPage', 1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
