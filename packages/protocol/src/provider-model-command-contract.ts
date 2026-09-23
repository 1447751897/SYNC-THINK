import type {
  AddModelsPayload,
  AddModelsResponse,
  RemoveModelPayload,
  RemoveModelResponse,
  SetModelPrioritiesPayload,
  SetModelPrioritiesResponse,
  UpdateModelPayload,
  UpdateModelResponse,
} from './commands.js';

/** Provider model catalog mutations, excluding discovery and capability probes. */
export interface ProviderModelCommandContract {
  'provider.addModels': { request: AddModelsPayload; response: AddModelsResponse };
  'provider.setModelPriorities': {
    request: SetModelPrioritiesPayload;
    response: SetModelPrioritiesResponse;
  };
  'provider.updateModel': { request: UpdateModelPayload; response: UpdateModelResponse };
  'provider.removeModel': { request: RemoveModelPayload; response: RemoveModelResponse };
}

export type ProviderModelCommand = keyof ProviderModelCommandContract;
export type ProviderModelCommandRequest<K extends ProviderModelCommand> =
  ProviderModelCommandContract[K]['request'];
export type ProviderModelCommandResponse<K extends ProviderModelCommand> =
  ProviderModelCommandContract[K]['response'];
