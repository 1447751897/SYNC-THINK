import type {
  ImportCcSwitchPayload,
  ImportCcSwitchResponse,
  PreviewCcSwitchImportPayload,
  PreviewCcSwitchImportResponse,
} from './commands.js';

/** Preview and import providers from a local CC Switch database. */
export interface ProviderCcSwitchCommandContract {
  'provider.previewCcSwitchImport': {
    request: PreviewCcSwitchImportPayload;
    response: PreviewCcSwitchImportResponse;
  };
  'provider.importCcSwitch': {
    request: ImportCcSwitchPayload;
    response: ImportCcSwitchResponse;
  };
}

export type ProviderCcSwitchCommand = keyof ProviderCcSwitchCommandContract;
export type ProviderCcSwitchCommandRequest<K extends ProviderCcSwitchCommand> =
  ProviderCcSwitchCommandContract[K]['request'];
export type ProviderCcSwitchCommandResponse<K extends ProviderCcSwitchCommand> =
  ProviderCcSwitchCommandContract[K]['response'];
