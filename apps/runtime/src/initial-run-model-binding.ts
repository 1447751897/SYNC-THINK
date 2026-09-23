import {
  resolveCredentialRef,
  resolveModelBinding,
  type AgentModelBinding,
  type CredentialResolutionSource,
} from '@sync-think/core';
import type {
  CredentialGroupId,
  CredentialRefId,
  ModelId,
  ModelResolutionSource,
  ProtocolFamily,
  ProviderId,
} from '@sync-think/shared';

export interface RunBindingModel {
  id: ModelId;
  providerId: ProviderId;
  providerModelId: string;
  protocol: ProtocolFamily;
  limitsJson?: string;
}

export interface RunBindingProvider {
  id: ProviderId;
  baseUrl: string;
}

export interface RunBindingCredential {
  id: CredentialRefId;
  credentialGroupId: CredentialGroupId;
}

export interface RunBindingCatalog {
  getModel(id: string): RunBindingModel | undefined;
  listProviderIds(): readonly ProviderId[];
  findModelByProviderModelId(
    providerId: ProviderId,
    providerModelId: string,
  ): RunBindingModel | undefined;
  getProvider(id: ProviderId): RunBindingProvider | undefined;
  getCredentialRef(id: string): RunBindingCredential | undefined;
  getFirstCredentialInGroup(id: string): RunBindingCredential | undefined;
  getPrimaryCredentialRef(providerId: string): RunBindingCredential | undefined;
  getProviderIdForCredentialGroup(groupId: string): string | undefined;
}

export interface InitialRunModelBindingInput {
  agent: AgentModelBinding;
  requestedModelId?: string;
  runCredentialRefId?: string;
  planActRoute?: {
    applied: boolean;
    modelId?: string;
  };
}

export interface InitialRunModelBinding {
  modelId: ModelId;
  resolutionSource: ModelResolutionSource;
  model?: RunBindingModel;
  provider?: RunBindingProvider;
  credential?: RunBindingCredential;
  credentialResolutionSource: CredentialResolutionSource;
  useFakeProvider: boolean;
  modelContextWindow: number;
  contextWindowEstimated: boolean;
}

function findByProviderModelId(
  catalog: RunBindingCatalog,
  providerModelId: string,
): RunBindingModel | undefined {
  for (const providerId of catalog.listProviderIds()) {
    const model = catalog.findModelByProviderModelId(providerId, providerModelId);
    if (model) return model;
  }
  return undefined;
}

function resolveContextWindow(model: RunBindingModel | undefined): {
  modelContextWindow: number;
  contextWindowEstimated: boolean;
} {
  if (model?.limitsJson) {
    try {
      const limits = JSON.parse(model.limitsJson) as { contextWindow?: unknown };
      if (
        typeof limits.contextWindow === 'number' &&
        Number.isFinite(limits.contextWindow) &&
        limits.contextWindow > 0
      ) {
        return {
          modelContextWindow: Math.round(limits.contextWindow),
          contextWindowEstimated: false,
        };
      }
    } catch {
      // Invalid provider metadata uses the stable Runtime fallback.
    }
  }
  return { modelContextWindow: 128_000, contextWindowEstimated: true };
}

export function resolveRunCredentialBinding(
  input: {
    runCredentialRefId?: string;
    agent: AgentModelBinding;
    providerId?: string;
  },
  catalog: RunBindingCatalog | undefined,
): {
  credential?: RunBindingCredential;
  source: CredentialResolutionSource;
  credentialGroupId?: string;
} {
  if (!catalog) return { source: 'none' };
  const resolution = resolveCredentialRef({
    runCredentialRefId: input.runCredentialRefId,
    pinnedCredentialRefId: input.agent.pinnedCredentialRefId,
    defaultCredentialGroupId: input.agent.defaultCredentialGroupId,
    providerId: input.providerId,
    getCredentialRef: (id) => catalog.getCredentialRef(id),
    getFirstCredentialInGroup: (groupId) => catalog.getFirstCredentialInGroup(groupId),
    getPrimaryCredentialRef: (providerId) => catalog.getPrimaryCredentialRef(providerId),
    getProviderIdForCredentialGroup: (groupId) =>
      catalog.getProviderIdForCredentialGroup(groupId),
  });
  return {
    credential: resolution.credential,
    source: resolution.source,
    credentialGroupId: resolution.credentialGroupId,
  };
}

/** Resolve immutable model/provider/credential metadata before a run is created. */
export function resolveInitialRunModelBinding(
  input: InitialRunModelBindingInput,
  ports: {
    catalog: RunBindingCatalog | undefined;
    secureStoreAvailable: boolean;
  },
): InitialRunModelBinding {
  const requestedModelId = input.requestedModelId
    ? (input.requestedModelId as ModelId)
    : undefined;
  const resolution = resolveModelBinding({
    agent: input.agent,
    runModelId: requestedModelId,
  });
  let modelId =
    resolution.status === 'resolved' ? resolution.modelId : input.agent.defaultModelId;
  let resolutionSource: ModelResolutionSource =
    resolution.status === 'resolved' ? resolution.source : 'agentDefault';
  let model = ports.catalog?.getModel(modelId);

  if (!model && input.requestedModelId && ports.catalog) {
    const mapped = findByProviderModelId(ports.catalog, input.requestedModelId);
    if (mapped) {
      model = mapped;
      modelId = mapped.id;
      resolutionSource = 'runOverride';
    }
  }
  if (!model && modelId !== 'fake-mini' && ports.catalog) {
    model = ports.catalog.getModel(modelId);
  }

  if (input.planActRoute?.applied && input.planActRoute.modelId) {
    modelId = input.planActRoute.modelId as ModelId;
    resolutionSource = 'planAct';
    model = ports.catalog?.getModel(modelId);
    if (!model && ports.catalog) {
      const mapped = findByProviderModelId(ports.catalog, modelId);
      if (mapped) {
        model = mapped;
        modelId = mapped.id;
      }
    }
  }

  const provider = model ? ports.catalog?.getProvider(model.providerId) : undefined;
  const credentialResolution = resolveRunCredentialBinding(
    {
      runCredentialRefId: input.runCredentialRefId,
      agent: input.agent,
      providerId: provider?.id,
    },
    ports.catalog,
  );
  return {
    modelId,
    resolutionSource,
    model,
    provider,
    credential: credentialResolution.credential,
    credentialResolutionSource: credentialResolution.source,
    useFakeProvider: !model || !ports.catalog || !ports.secureStoreAvailable,
    ...resolveContextWindow(model),
  };
}
