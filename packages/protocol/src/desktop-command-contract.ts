import type {
  CancelDesktopCommandPayload,
  CancelDesktopCommandResponse,
  ContinueDesktopCommandPayload,
  ContinueDesktopCommandResponse,
  ListWaitingDesktopCommandsPayload,
  ListWaitingDesktopCommandsResponse,
} from './commands.js';

/** Desktop waiting RPCs bind each command to its request and response payload. */
export interface DesktopCommandContract {
  'desktop.command.listWaiting': {
    request: ListWaitingDesktopCommandsPayload;
    response: ListWaitingDesktopCommandsResponse;
  };
  'desktop.command.continue': {
    request: ContinueDesktopCommandPayload;
    response: ContinueDesktopCommandResponse;
  };
  'desktop.command.cancel': {
    request: CancelDesktopCommandPayload;
    response: CancelDesktopCommandResponse;
  };
}

export type DesktopCommand = keyof DesktopCommandContract;
export type DesktopCommandRequest<K extends DesktopCommand> = DesktopCommandContract[K]['request'];
export type DesktopCommandResponse<K extends DesktopCommand> =
  DesktopCommandContract[K]['response'];
