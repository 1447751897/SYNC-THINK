/**
 * Native kernel adapter — the existing SYNC-THINK runtime exposed through the
 * KernelAdapter contract (design doc §5.1).
 *
 * The native kernel runs **in-process**: the host dispatch routes `native` runs
 * to the existing `executeDemoRun` loop and never consumes `start()`. All
 * existing behavior (dual-protocol adapters, failure classification, 70%
 * compression, fallback chain, approval fence) stays untouched — zero
 * regression. This adapter exists so the registry and the UI can treat native
 * uniformly with external kernels.
 */
import type { KernelAdapter, KernelCapabilities, KernelEvent, KernelRequest } from '@sync-think/shared';

export class NativeKernelAdapter implements KernelAdapter {
  readonly id = 'native' as const;
  readonly name = '原生内核';
  readonly icon = 'native';

  readonly capabilities: KernelCapabilities = {
    protocols: ['anthropic-messages', 'openai-chat', 'openai-responses'],
    permission: 'own',
    permissionBridge: false,
    pause: 'executor',
    compress: 'own',
    usageReport: true,
  };

  /** Native ships with the runtime — no external version to track. */
  readonly knownGoodVersions: readonly string[] = [];

  async detectVersion(): Promise<string | null> {
    return null;
  }

  async *start(_request: KernelRequest): AsyncIterable<KernelEvent> {
    // Guard: the host dispatch must route in-process kernels to executeDemoRun.
    // Yielding a failed terminal keeps accidental subprocess-style usage loud.
    yield {
      type: 'terminal',
      status: 'failed',
      error: 'native kernel runs in-process; the host dispatches it directly',
    };
  }

  async stop(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async cancel(): Promise<void> {}
  onExit(): void {}
  onPermissionRequest(): void {}
  respondPermission(): void {}
  onUsage(): void {}
}

export const nativeKernelAdapter = new NativeKernelAdapter();
