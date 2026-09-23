import type {
  GatewayLogsQuery,
  GatewayLogsResponse,
  OpenGatewayStatusResponse,
} from './gateway.js';

export type GatewayEmptyPayload = Record<string, never>;
export type GatewayLogsClearResponse = Record<string, never>;

/** Open Gateway RPCs bind each command to its request and response payload. */
export interface GatewayCommandContract {
  'gateway.status': {
    request: GatewayEmptyPayload;
    response: OpenGatewayStatusResponse;
  };
  'gateway.logs': {
    request: GatewayLogsQuery;
    response: GatewayLogsResponse;
  };
  'gateway.logs.clear': {
    request: GatewayEmptyPayload;
    response: GatewayLogsClearResponse;
  };
}

export type GatewayCommand = keyof GatewayCommandContract;
export type GatewayCommandRequest<K extends GatewayCommand> = GatewayCommandContract[K]['request'];
export type GatewayCommandResponse<K extends GatewayCommand> =
  GatewayCommandContract[K]['response'];
