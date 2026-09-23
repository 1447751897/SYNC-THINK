import type {
  AddProviderCredentialPayload,
  AddProviderCredentialResponse,
  ClearProviderCredentialsPayload,
  ClearProviderCredentialsResponse,
  RemoveProviderCredentialPayload,
  RemoveProviderCredentialResponse,
  RevealProviderCredentialPayload,
  RevealProviderCredentialResponse,
  UpdateProviderCredentialPayload,
  UpdateProviderCredentialResponse,
} from './commands.js';

/** Provider credential lifecycle RPCs, excluding catalog and model management. */
export interface ProviderCredentialCommandContract {
  'provider.addCredential': {
    request: AddProviderCredentialPayload;
    response: AddProviderCredentialResponse;
  };
  'provider.removeCredential': {
    request: RemoveProviderCredentialPayload;
    response: RemoveProviderCredentialResponse;
  };
  'provider.clearCredentials': {
    request: ClearProviderCredentialsPayload;
    response: ClearProviderCredentialsResponse;
  };
  'provider.revealCredential': {
    request: RevealProviderCredentialPayload;
    response: RevealProviderCredentialResponse;
  };
  'provider.updateCredential': {
    request: UpdateProviderCredentialPayload;
    response: UpdateProviderCredentialResponse;
  };
}

export type ProviderCredentialCommand = keyof ProviderCredentialCommandContract;
export type ProviderCredentialCommandRequest<K extends ProviderCredentialCommand> =
  ProviderCredentialCommandContract[K]['request'];
export type ProviderCredentialCommandResponse<K extends ProviderCredentialCommand> =
  ProviderCredentialCommandContract[K]['response'];
