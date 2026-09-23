import type {
  DesktopCommand,
  DesktopCommandRequest,
  DesktopCommandResponse,
} from '@sync-think/protocol';
import {
  parseCancelDesktopCommandPayload,
  parseContinueDesktopCommandPayload,
  parseListWaitingDesktopCommandsPayload,
} from '../desktop-command-payloads.js';

export interface DesktopCommandHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestDesktopCommand<K extends DesktopCommand>(
    command: K,
    payload: DesktopCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<DesktopCommandResponse<K>>;
}

export function registerDesktopCommandHandlers<Event>(host: DesktopCommandHost<Event>): void {
  host.handle('runtime:desktop-command-list-waiting', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestDesktopCommand(
      'desktop.command.listWaiting',
      parseListWaitingDesktopCommandsPayload(value),
    );
  });

  host.handle('runtime:desktop-command-continue', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestDesktopCommand(
      'desktop.command.continue',
      parseContinueDesktopCommandPayload(value),
    );
  });

  host.handle('runtime:desktop-command-cancel', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestDesktopCommand(
      'desktop.command.cancel',
      parseCancelDesktopCommandPayload(value),
    );
  });
}
