import type { ProviderSurface } from '@sync-think/shared';
import {
  PROVIDER_SURFACE_LABELS,
  PROVIDER_SURFACE_ORDER,
  inferProviderSurface,
} from '@sync-think/shared';

/** Minimal model node for hierarchical path picker. */
export interface ModelPathModelNode {
  modelId: string;
  label: string;
  providerModelId?: string;
  providerName?: string;
  providerId?: string;
  surface: ProviderSurface;
}

export interface ModelPathGroupNode {
  providerId: string;
  name: string;
  surface: ProviderSurface;
  models: ModelPathModelNode[];
}

export interface ModelPathSurfaceNode {
  surface: ProviderSurface;
  label: string;
  groups: ModelPathGroupNode[];
  modelCount: number;
}

export interface ModelPathTreeInput {
  modelId: string;
  label: string;
  providerName?: string;
  providerModelId?: string;
  providerId?: string;
  surface?: ProviderSurface | string | null;
  protocol?: string | null;
}

/**
 * Build Surface → Group(Provider) → Model tree for CC Switch–style picker.
 * Empty surfaces are omitted so tabs only show populated apps.
 */
export function buildSurfaceTree(
  models: readonly ModelPathTreeInput[],
): ModelPathSurfaceNode[] {
  const bySurface = new Map<ProviderSurface, Map<string, ModelPathGroupNode>>();

  for (const m of models) {
    if (!m.modelId) continue;
    const surface = inferProviderSurface({
      surface: m.surface,
      protocol: m.protocol,
      name: m.providerName ?? m.label,
    });
    const providerId = (m.providerId ?? m.providerName ?? 'unknown').trim() || 'unknown';
    const providerName = (m.providerName ?? '未命名分组').trim() || '未命名分组';

    let groups = bySurface.get(surface);
    if (!groups) {
      groups = new Map();
      bySurface.set(surface, groups);
    }
    let group = groups.get(providerId);
    if (!group) {
      group = {
        providerId,
        name: providerName,
        surface,
        models: [],
      };
      groups.set(providerId, group);
    }
    group.models.push({
      modelId: m.modelId,
      label: m.label,
      providerModelId: m.providerModelId,
      providerName,
      providerId,
      surface,
    });
  }

  const tree: ModelPathSurfaceNode[] = [];
  for (const surface of PROVIDER_SURFACE_ORDER) {
    const groupsMap = bySurface.get(surface);
    if (!groupsMap || groupsMap.size === 0) continue;
    const groups = [...groupsMap.values()]
      .map((g) => ({
        ...g,
        models: [...g.models].sort((a, b) =>
          (a.providerModelId ?? a.label).localeCompare(b.providerModelId ?? b.label, 'zh-CN'),
        ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const modelCount = groups.reduce((n, g) => n + g.models.length, 0);
    tree.push({
      surface,
      label: PROVIDER_SURFACE_LABELS[surface],
      groups,
      modelCount,
    });
  }
  return tree;
}

export function findModelPath(
  tree: readonly ModelPathSurfaceNode[],
  modelId: string | null | undefined,
): { surface: ProviderSurface; providerId: string; modelId: string } | null {
  if (!modelId) return null;
  for (const s of tree) {
    for (const g of s.groups) {
      if (g.models.some((m) => m.modelId === modelId)) {
        return { surface: s.surface, providerId: g.providerId, modelId };
      }
    }
  }
  return null;
}
