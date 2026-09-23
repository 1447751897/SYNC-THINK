import type {
  DiagnosticsCommand,
  DiagnosticsCommandRequest,
  DiagnosticsCommandResponse,
} from '@sync-think/protocol';
import { parseListDiagnosticsPayload } from '../memory-payloads.js';

export interface DiagnosticsHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestDiagnostics<K extends DiagnosticsCommand>(
    command: K,
    payload: DiagnosticsCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<DiagnosticsCommandResponse<K>>;
}

export function registerDiagnosticsHandlers<Event>(host: DiagnosticsHost<Event>): void {
  host.handle('runtime:diagnostics-list', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestDiagnostics('diagnostics.list', parseListDiagnosticsPayload(value));
  });
}
