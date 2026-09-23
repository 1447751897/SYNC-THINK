import type {
  GetSettingsPayload,
  GetSettingsResponse,
  SetSettingPayload,
  SetSettingResponse,
} from './commands.js';

/** Application setting RPCs bind each command to its request and response payload. */
export interface SettingsCommandContract {
  'settings.get': {
    request: GetSettingsPayload;
    response: GetSettingsResponse;
  };
  'settings.set': {
    request: SetSettingPayload;
    response: SetSettingResponse;
  };
}

export type SettingsCommand = keyof SettingsCommandContract;
export type SettingsCommandRequest<K extends SettingsCommand> =
  SettingsCommandContract[K]['request'];
export type SettingsCommandResponse<K extends SettingsCommand> =
  SettingsCommandContract[K]['response'];
