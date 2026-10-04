/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { embeddedBrowserProfileName, readDefaultEmbeddedBrowserProfile, writeDefaultEmbeddedBrowserProfile } from './embedded-browser-profile.js';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.removeItem('sync-think:embedded-browser-default-profile:v1');
});

describe('embedded browser default profile', () => {
  it('uses one stable persisted browser profile with a nontechnical name', () => {
    expect(readDefaultEmbeddedBrowserProfile()).toBe('persist:browser-panel');
    expect(embeddedBrowserProfileName('persist:browser-panel')).toBe('默认浏览器资料');
    expect(embeddedBrowserProfileName('')).toBe('默认浏览器资料');
  });
  it('remembers the explicit persistent profile selection', () => {
    expect(writeDefaultEmbeddedBrowserProfile('persist:browser-panel')).toBe(true);
    expect(readDefaultEmbeddedBrowserProfile()).toBe('persist:browser-panel');
    expect(writeDefaultEmbeddedBrowserProfile('')).toBe(true);
    expect(readDefaultEmbeddedBrowserProfile()).toBe('');
  });
  it('rejects unknown or temporary defaults, including stale stored values', () => {
    expect(writeDefaultEmbeddedBrowserProfile('temporary-tab')).toBe(false);
    window.localStorage.setItem('sync-think:embedded-browser-default-profile:v1', 'temporary-tab');
    expect(readDefaultEmbeddedBrowserProfile()).toBe('persist:browser-panel');
    expect(embeddedBrowserProfileName('temporary-tab')).toBe('临时资料');
  });
  it('reports storage failures rather than pretending to save settings', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(writeDefaultEmbeddedBrowserProfile('persist:browser-panel')).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readDefaultEmbeddedBrowserProfile()).toBe('persist:browser-panel');
  });
});
