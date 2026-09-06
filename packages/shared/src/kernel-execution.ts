import type { KernelDetectionResult } from './types/kernel.js';

export function isKernelExecutionSupported(
  kernel: Pick<KernelDetectionResult, 'kernelId' | 'executionSupported'>,
): boolean {
  return kernel.executionSupported ?? ['native', 'claude-code', 'codex'].includes(kernel.kernelId);
}

export function isKernelExecutable(
  kernel: Pick<KernelDetectionResult, 'kernelId' | 'executionSupported' | 'installed'>,
): boolean {
  return kernel.installed && isKernelExecutionSupported(kernel);
}

export function kernelExecutionUnavailableReason(name: string): string {
  return name + ' 执行尚未接通，请选择 Sync-Think、Claude Code 或 Codex';
}
