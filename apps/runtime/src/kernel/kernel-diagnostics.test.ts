import { expect, it } from 'vitest';
import { formatKernelExitDiagnostic, KernelStartupError } from './kernel-diagnostics.js';
it('puts the fatal state initialization error before warnings in bounded UI summaries', () => {
  const stderr =
    'WARNING: stale temporary directory: access denied\nWARNING: PATH aliases unavailable\nError: failed to initialize sqlite state runtime under HOME';
  const detail = formatKernelExitDiagnostic('Codex app-server', 1, stderr);
  const error = new KernelStartupError('Codex', new Error(detail));
  expect(error.message.slice(0, 240)).toContain('failed to initialize sqlite');
  expect(error.message).toContain('WARNING: stale');
});
it('keeps secrets redacted in reordered diagnostics', () => {
  const detail = formatKernelExitDiagnostic(
    'Codex',
    1,
    'WARNING: secret-value\nError: secret-value',
    ['secret-value'],
  );
  expect(detail).not.toContain('secret-value');
  expect(detail).toContain('[REDACTED]');
});
