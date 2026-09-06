import { describe, expect, it } from 'vitest';
import { isKernelExecutable } from './kernel-execution.js';

describe('kernel execution availability', () => {
  it.each(['native', 'claude-code', 'codex'])(
    'preserves legacy availability for %s',
    (kernelId) => {
      expect(isKernelExecutable({ kernelId, installed: true })).toBe(true);
      expect(isKernelExecutable({ kernelId, installed: false })).toBe(false);
      expect(isKernelExecutable({ kernelId, installed: true, executionSupported: false })).toBe(
        false,
      );
    },
  );
  it.each(['pi', 'unknown-kernel'])('requires explicit execution support for %s', (kernelId) => {
    expect(isKernelExecutable({ kernelId, installed: true })).toBe(false);
    expect(isKernelExecutable({ kernelId, installed: true, executionSupported: true })).toBe(true);
    expect(isKernelExecutable({ kernelId, installed: false, executionSupported: true })).toBe(
      false,
    );
  });
});
