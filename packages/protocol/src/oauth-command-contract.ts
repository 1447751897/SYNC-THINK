import type {
  OauthCancelPayload,
  OauthCancelResponse,
  OauthClientConfigListPayload,
  OauthClientConfigListResponse,
  OauthClientConfigSavePayload,
  OauthClientConfigSaveResponse,
  OauthDisconnectPayload,
  OauthDisconnectResponse,
  OauthStartPayload,
  OauthStartResponse,
  OauthStatusPayload,
  OauthStatusResponse,
} from './commands.js';

/**
 * OAuth broker RPCs.
 *
 * `start`/`status`/`cancel` drive one authorization flow; `disconnect` tears the
 * result down. Client credentials are the user's own and are registered per
 * provider through `clientConfig.*` — never per catalog entry, because one
 * Google client backs Docs, Gmail, Drive and Calendar.
 */
export interface OauthCommandContract {
  'oauth.start': { request: OauthStartPayload; response: OauthStartResponse };
  'oauth.status': { request: OauthStatusPayload; response: OauthStatusResponse };
  'oauth.cancel': { request: OauthCancelPayload; response: OauthCancelResponse };
  'oauth.disconnect': { request: OauthDisconnectPayload; response: OauthDisconnectResponse };
  'oauth.clientConfig.save': {
    request: OauthClientConfigSavePayload;
    response: OauthClientConfigSaveResponse;
  };
  'oauth.clientConfig.list': {
    request: OauthClientConfigListPayload;
    response: OauthClientConfigListResponse;
  };
}

export type OauthCommand = keyof OauthCommandContract;
export type OauthCommandRequest<K extends OauthCommand> = OauthCommandContract[K]['request'];
export type OauthCommandResponse<K extends OauthCommand> = OauthCommandContract[K]['response'];
