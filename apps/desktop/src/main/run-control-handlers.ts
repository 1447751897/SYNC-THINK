import type {
  RunControlCommand,
  RunControlCommandRequest,
  RunControlCommandResponse,
} from '@sync-think/protocol';
import {
  parseConversationRunCancelPayload,
  parseRunGraphPayload,
  parseRunMutationPayload,
} from '../run-control-payloads.js';
import { RUN_CONTROL_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface RunControlHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestRunControl<K extends RunControlCommand>(
    command: K,
    payload: RunControlCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<RunControlCommandResponse<K>>;
}

export function registerRunControlHandlers<Event>(host: RunControlHost<Event>): void {
  host.handle(RUN_CONTROL_RUNTIME_IPC_CHANNELS.cancelConversation, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestRunControl('run.cancel', parseConversationRunCancelPayload(value));
  });

  host.handle(RUN_CONTROL_RUNTIME_IPC_CHANNELS.getGraph, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestRunControl('run.getGraph', parseRunGraphPayload(value));
  });

  host.handle(RUN_CONTROL_RUNTIME_IPC_CHANNELS.pause, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestRunControl('run.pause', parseRunMutationPayload(value));
  });

  host.handle(RUN_CONTROL_RUNTIME_IPC_CHANNELS.resume, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestRunControl('run.resume', parseRunMutationPayload(value));
  });

  host.handle(RUN_CONTROL_RUNTIME_IPC_CHANNELS.cancelOrchestration, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestRunControl('run.cancel', parseRunMutationPayload(value));
  });
}
