import { describe, expect, it } from 'vitest';
import {
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
});
