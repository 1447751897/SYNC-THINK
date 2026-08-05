import { describe, expect, it } from 'vitest';
import {
  BROWSER_PROFILE_MAINTENANCE_REQUEST_TIMEOUT_MS,
  BROWSER_RECORDING_REQUEST_TIMEOUT_MS,
  USAGE_SUMMARY_REQUEST_TIMEOUT_MS,
  resolveRuntimeRequestTimeoutMs,
} from './runtime-client.js';

describe('RuntimePipeClient request timeout policy', () => {
  it('gives usage summary enough time for a first-time background cache build', () => {
    expect(resolveRuntimeRequestTimeoutMs('usage.summary', 5_000)).toBe(
      USAGE_SUMMARY_REQUEST_TIMEOUT_MS,
    );
    expect(resolveRuntimeRequestTimeoutMs('runtime.healthcheck', 5_000)).toBe(5_000);
  });

  it('allows cold Browser Profile inspection and maintenance to finish', () => {
    for (const type of [
      'browser.profile.listSiteSessions',
      'browser.profile.clearSiteSession',
      'browser.profile.delete',
    ]) {
      expect(resolveRuntimeRequestTimeoutMs(type, 5_000)).toBe(
        BROWSER_PROFILE_MAINTENANCE_REQUEST_TIMEOUT_MS,
      );
    }
    expect(resolveRuntimeRequestTimeoutMs('browser.profile.list', 5_000)).toBe(5_000);
  });

  it('allows Browser recording lifecycle operations to open and close a system browser', () => {
    for (const type of ['browser.recording.start', 'browser.recording.stop']) {
      expect(resolveRuntimeRequestTimeoutMs(type, 5_000)).toBe(
        BROWSER_RECORDING_REQUEST_TIMEOUT_MS,
      );
    }
    expect(resolveRuntimeRequestTimeoutMs('browser.recording.list', 5_000)).toBe(5_000);
    expect(resolveRuntimeRequestTimeoutMs('browser.recording.get', 5_000)).toBe(5_000);
  });
});
