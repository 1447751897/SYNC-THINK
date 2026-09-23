import type {
  MemoryCommand,
  MemoryCommandRequest,
  MemoryCommandResponse,
} from '@sync-think/protocol';
import {
  parseDecideMemoryPayload,
  parseListMemoryPayload,
  parseRollbackMemoryPayload,
} from '../memory-payloads.js';

export interface MemoryHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestMemory<K extends MemoryCommand>(
    command: K,
    payload: MemoryCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<MemoryCommandResponse<K>>;
}

export function registerMemoryHandlers<Event>(host: MemoryHost<Event>): void {
  host.handle('runtime:memory-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMemory('memory.list', parseListMemoryPayload(value));
  });

  host.handle('runtime:memory-decide', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMemory('memory.decide', parseDecideMemoryPayload(value));
  });

  host.handle('runtime:memory-rollback', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestMemory('memory.rollback', parseRollbackMemoryPayload(value));
  });
}
