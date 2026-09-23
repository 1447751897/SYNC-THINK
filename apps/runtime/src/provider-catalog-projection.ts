import type {
  ProviderCredentialSummary,
  ProviderModelSummary,
  ProviderSummary,
} from '@sync-think/protocol';
import { inferProviderSurface } from '@sync-think/shared';
import type { ModelRecord, ProviderCatalogEntry } from '@sync-think/storage';

export function projectProviderModelSummary(model: ModelRecord): ProviderModelSummary {
  let contextWindow: number | undefined;
  if (model.limitsJson) {
    try {
      const limits = JSON.parse(model.limitsJson) as { contextWindow?: unknown };
      if (typeof limits.contextWindow === 'number' && limits.contextWindow > 0) {
        contextWindow = limits.contextWindow;
      }
    } catch {
      contextWindow = undefined;
    }
  }

  return {
    modelId: model.id,
    providerModelId: model.providerModelId,
    displayName: model.displayName,
    protocol: model.protocol,
    capabilities: model.capabilities,
    capabilitiesConfirmed: model.capabilitiesConfirmed,
    ...(model.visionCapability !== undefined ? { visionCapability: model.visionCapability } : {}),
    ...(model.visionProbeReason ? { visionProbeReason: model.visionProbeReason } : {}),
    visionManualOverride: model.visionManualOverride ?? null,
    priority: model.priority,
    credentialRefId: model.credentialRefId,
    contextWindow,
  };
}

export function projectProviderSummary(entry: ProviderCatalogEntry): ProviderSummary {
  const credentials: ProviderCredentialSummary[] = [];
  for (const group of entry.credentialGroups) {
    for (const credential of group.credentials) {
      credentials.push({
        credentialRefId: credential.id,
        credentialGroupId: credential.credentialGroupId,
        groupName: group.name,
        label: credential.label,
        kind: credential.kind,
        hasSecret: true,
      });
    }
  }

  return {
    providerId: entry.provider.id,
    name: entry.provider.name,
    baseUrl: entry.provider.baseUrl,
    protocol: entry.provider.protocol,
    supportsDiscovery: entry.provider.supportsDiscovery,
    surface: inferProviderSurface({
      surface: entry.provider.surface,
      protocol: entry.provider.protocol,
      name: entry.provider.name,
    }),
    importedFrom: entry.provider.importedFrom,
    enabled: entry.provider.enabled,
    sortOrder: entry.provider.sortOrder,
    unverified: entry.provider.unverified,
    credentials,
    models: entry.models.map(projectProviderModelSummary),
    createdAt: entry.provider.createdAt,
    updatedAt: entry.provider.updatedAt,
  };
}

export function projectProviderSummaryById(
  entries: readonly ProviderCatalogEntry[],
  providerId: string,
): ProviderSummary | undefined {
  const entry = entries.find((item) => item.provider.id === providerId);
  return entry ? projectProviderSummary(entry) : undefined;
}
