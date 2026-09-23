import type {
  ProviderCredentialCommand,
  ProviderCredentialCommandRequest,
  ProviderCredentialCommandResponse,
} from '@sync-think/protocol';
import {
  parseAddProviderCredentialMetadata,
  parseClearProviderCredentialsPayload,
  parseRemoveProviderCredentialPayload,
  parseRevealProviderCredentialPayload,
  parseUpdateProviderCredentialMetadata,
} from '../provider-credential-payloads.js';
import { PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  addProviderCredentialPayloadFromClipboard,
  updateProviderCredentialPayloadFromClipboard,
} from './provider-clipboard.js';

export interface ProviderCredentialHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  readClipboardText(): string;
  requestProviderCredential<K extends ProviderCredentialCommand>(
    command: K,
    payload: ProviderCredentialCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<ProviderCredentialCommandResponse<K>>;
}

export function registerProviderCredentialHandlers<Event>(
  host: ProviderCredentialHost<Event>,
): void {
  host.handle(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.add, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCredential(
      'provider.addCredential',
      addProviderCredentialPayloadFromClipboard(parseAddProviderCredentialMetadata(value), () =>
        host.readClipboardText(),
      ),
    );
  });

  host.handle(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.remove, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCredential(
      'provider.removeCredential',
      parseRemoveProviderCredentialPayload(value),
    );
  });

  host.handle(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.clear, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCredential(
      'provider.clearCredentials',
      parseClearProviderCredentialsPayload(value),
    );
  });

  host.handle(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.reveal, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCredential(
      'provider.revealCredential',
      parseRevealProviderCredentialPayload(value),
    );
  });

  host.handle(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.update, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestProviderCredential(
      'provider.updateCredential',
      updateProviderCredentialPayloadFromClipboard(
        parseUpdateProviderCredentialMetadata(value),
        () => host.readClipboardText(),
      ),
    );
  });
}
