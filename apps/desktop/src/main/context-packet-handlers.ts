import type {
  ContextPacketCommand,
  ContextPacketCommandRequest,
  ContextPacketCommandResponse,
} from '@sync-think/protocol';
import {
  parseAmendContextPacketPayload,
  parsePeekContextPacketPayload,
} from '../context-payloads.js';

export interface ContextPacketHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestContextPacket<K extends ContextPacketCommand>(
    command: K,
    payload: ContextPacketCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ContextPacketCommandResponse<K>>;
}

export function registerContextPacketHandlers<Event>(host: ContextPacketHost<Event>): void {
  host.handle('runtime:context-packet-peek', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestContextPacket('context.packet.peek', parsePeekContextPacketPayload(value));
  });

  host.handle('runtime:context-packet-amend', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestContextPacket('context.packet.amend', parseAmendContextPacketPayload(value));
  });
}
