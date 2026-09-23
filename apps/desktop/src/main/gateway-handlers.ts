import type {
  GatewayCommand,
  GatewayCommandRequest,
  GatewayCommandResponse,
  GatewayLogsQuery,
} from '@sync-think/protocol';

export interface GatewayHost<Event> {
  handle(channel: string, listener: (event: Event, value?: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestGateway<K extends GatewayCommand>(
    command: K,
    payload: GatewayCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<GatewayCommandResponse<K>>;
}

export function registerGatewayHandlers<Event>(host: GatewayHost<Event>): void {
  host.handle('runtime:gateway-status', async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGateway('gateway.status', {});
  });

  host.handle('runtime:gateway-logs', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGateway('gateway.logs', (value ?? {}) as GatewayLogsQuery);
  });

  host.handle('runtime:gateway-logs-clear', async (event) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGateway('gateway.logs.clear', {});
  });
}
