import type {
  ConfirmCapabilitiesPayload,
  ConfirmCapabilitiesResponse,
  DiscoverModelsPayload,
  DiscoverModelsResponse,
  ProbeCapabilitiesPayload,
  ProbeCapabilitiesResponse,
  ProbeModelsPayload,
  ProbeModelsResponse,
} from './commands.js';

/** Provider discovery and capability verification commands. */
export interface ProviderDiscoveryCommandContract {
  'provider.discoverModels': { request: DiscoverModelsPayload; response: DiscoverModelsResponse };
  'provider.probeModels': { request: ProbeModelsPayload; response: ProbeModelsResponse };
  'provider.probeCapabilities': {
    request: ProbeCapabilitiesPayload;
    response: ProbeCapabilitiesResponse;
  };
  'provider.confirmCapabilities': {
    request: ConfirmCapabilitiesPayload;
    response: ConfirmCapabilitiesResponse;
  };
}

export type ProviderDiscoveryCommand = keyof ProviderDiscoveryCommandContract;
export type ProviderDiscoveryCommandRequest<K extends ProviderDiscoveryCommand> =
  ProviderDiscoveryCommandContract[K]['request'];
export type ProviderDiscoveryCommandResponse<K extends ProviderDiscoveryCommand> =
  ProviderDiscoveryCommandContract[K]['response'];
