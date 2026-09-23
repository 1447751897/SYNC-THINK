import type {
  ParticipationModeCommand,
  ParticipationModeCommandRequest,
  ParticipationModeCommandResponse,
} from '@sync-think/protocol';
import { parseModeSetPayload } from '../participation-mode-payloads.js';
import { PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface ParticipationModeHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestParticipationMode<K extends ParticipationModeCommand>(
    command: K,
    payload: ParticipationModeCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ParticipationModeCommandResponse<K>>;
}

export function registerParticipationModeHandlers<Event>(
  host: ParticipationModeHost<Event>,
): void {
  host.handle(PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS.set, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestParticipationMode(
      'task.setParticipationMode',
      parseModeSetPayload(value),
    );
  });
}
