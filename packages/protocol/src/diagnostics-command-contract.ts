import type { ListDiagnosticsPayload, ListDiagnosticsResponse } from './commands.js';

/** Diagnostics RPCs bind each command to its request and response payload. */
export interface DiagnosticsCommandContract {
  'diagnostics.list': {
    request: ListDiagnosticsPayload;
    response: ListDiagnosticsResponse;
  };
}

export type DiagnosticsCommand = keyof DiagnosticsCommandContract;
export type DiagnosticsCommandRequest<K extends DiagnosticsCommand> =
  DiagnosticsCommandContract[K]['request'];
export type DiagnosticsCommandResponse<K extends DiagnosticsCommand> =
  DiagnosticsCommandContract[K]['response'];
