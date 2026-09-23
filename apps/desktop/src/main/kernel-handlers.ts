import type {
  KernelCommand,
  KernelCommandRequest,
  KernelCommandResponse,
} from '@sync-think/protocol';

export interface KernelHost<Event> {
  handle(channel: string, listener: (event: Event) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestKernel<K extends KernelCommand>(
    command: K,
    payload: KernelCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<KernelCommandResponse<K>>;
}

export function registerKernelHandlers<Event>(host: KernelHost<Event>): void {
  host.handle('runtime:kernel-detect', async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestKernel('kernel.detect', {});
  });
}
