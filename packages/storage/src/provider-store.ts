import type {
  CapabilityTag,
  CredentialGroupId,
  CredentialRefId,
  ModelId,
  ProtocolFamily,
  ProviderId,
  ProviderSurface,
} from '@sync-think/shared';
import { normalizeProviderSurface, ulid } from '@sync-think/shared';
import type { BetterSQLite3Raw } from './connection.js';

export type CredentialKind = 'api-key' | 'bearer-token' | 'oauth-token-ref';

export interface CreateProviderInput {
  name: string;
  baseUrl: string;
  protocol: ProtocolFamily;
  /** CC Switch-style surface; defaults to 'generic' when omitted. */
  surface?: ProviderSurface;
  supportsDiscovery?: boolean;
  importedFrom?: string;
  credentialGroupName?: string;
  credentialLabel?: string;
  credentialKind?: CredentialKind;
  /** Opaque secure-store handle only — never plaintext. */
  storeHandle: string;
  id?: ProviderId;
  credentialGroupId?: CredentialGroupId;
  credentialRefId?: CredentialRefId;
  now?: string;
}

export interface ProviderRecord {
  id: ProviderId;
  name: string;
  baseUrl: string;
  supportsDiscovery: boolean;
  /** Default protocol for discovery / empty-catalog manual models. */
  protocol: ProtocolFamily;
  /** CC Switch-style surface for hierarchical model picking. */
  surface: ProviderSurface;
  /** 0026: entry toggle — disabled entries hide from pickers but keep config. */
  enabled: boolean;
  /** 0026: manual ordering; first enabled provider is the default entry. */
  sortOrder: number;
  importedFrom?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialGroupRecord {
  id: CredentialGroupId;
  providerId: ProviderId;
  name: string;
  createdAt: string;
}

export interface CredentialRefRecord {
  id: CredentialRefId;
  credentialGroupId: CredentialGroupId;
  label: string;
  kind: CredentialKind;
  storeHandle: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRecord {
  id: ModelId;
  providerId: ProviderId;
  providerModelId: string;
  displayName: string;
  protocol: ProtocolFamily;
  capabilities: CapabilityTag[];
  limitsJson?: string;
  capabilitiesConfirmed: boolean;
  /** 0026: priority chain inside a provider — 0 is the primary model. */
  priority: number;
  /** 0026: optional pinned credential ref for this model (relay-station groups). */
  credentialRefId?: CredentialRefId;
  createdAt: string;
}

export interface UpsertModelsInput {
  providerId: ProviderId;
  protocol: ProtocolFamily;
  models: Array<{
    providerModelId: string;
    displayName?: string;
    capabilities?: CapabilityTag[];
    limitsJson?: string;
  }>;
  capabilitiesConfirmed?: boolean;
  now?: string;
}

export interface ProviderCatalogEntry {
  provider: ProviderRecord;
  credentialGroups: Array<
    CredentialGroupRecord & {
      credentials: Array<Omit<CredentialRefRecord, 'storeHandle'> & { hasSecret: true }>;
    }
  >;
  models: ModelRecord[];
}

export interface CreateProviderResult {
  provider: ProviderRecord;
  credentialGroup: CredentialGroupRecord;
  credentialRef: CredentialRefRecord;
  models: ModelRecord[];
}

export interface UpdateProviderInput {
  providerId: ProviderId | string;
  name?: string;
  baseUrl?: string;
  protocol?: ProtocolFamily;
  surface?: ProviderSurface;
  supportsDiscovery?: boolean;
  /** 0026: toggle the entry on/off (disabled hides from pickers). */
  enabled?: boolean;
  credentialLabel?: string;
  /** Optional new secure-store handle when rotating the secret. */
  storeHandle?: string;
  now?: string;
}

export interface UpdateProviderResult {
  provider: ProviderRecord;
  /** Previous store handle when a secret was rotated (caller may remove it). */
  previousStoreHandle?: string;
  credentialRef?: CredentialRefRecord;
}

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  supports_discovery: number;
  protocol: string;
  surface: string | null;
  enabled: number;
  sort_order: number;
  imported_from: string | null;
  created_at: string;
  updated_at: string;
}

interface CredentialGroupRow {
  id: string;
  provider_id: string;
  name: string;
  created_at: string;
}

interface CredentialRefRow {
  id: string;
  credential_group_id: string;
  label: string;
  kind: string;
  store_handle: string;
  created_at: string;
  updated_at: string;
}

interface ModelRow {
  id: string;
  provider_id: string;
  provider_model_id: string;
  display_name: string;
  protocol: string;
  capabilities_json: string;
  limits_json: string | null;
  capabilities_confirmed: number;
  priority: number;
  credential_ref_id: string | null;
  created_at: string;
}

const PROTOCOLS = new Set<ProtocolFamily>([
  'openai-responses',
  'openai-chat',
  'openai-images',
  'anthropic-messages',
]);

export class SqliteProviderStore {
  constructor(private readonly raw: BetterSQLite3Raw) {}

  createProvider(input: CreateProviderInput): CreateProviderResult {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new Error('Provider name must not be empty');
    }
    const baseUrl = canonicalizeBaseUrl(input.baseUrl);
    if (!PROTOCOLS.has(input.protocol)) {
      throw new Error(`Unsupported protocol: ${input.protocol}`);
    }
    const storeHandle = input.storeHandle.trim();
    if (storeHandle.length === 0) {
      throw new Error('Credential store handle must not be empty');
    }

    const now = input.now ?? new Date().toISOString();
    const providerId = (input.id ?? ulid()) as ProviderId;
    const groupId = (input.credentialGroupId ?? ulid()) as CredentialGroupId;
    const refId = (input.credentialRefId ?? ulid()) as CredentialRefId;
    const groupName = (input.credentialGroupName ?? 'default').trim() || 'default';
    const credentialLabel = (input.credentialLabel ?? 'primary').trim() || 'primary';
    const credentialKind: CredentialKind = input.credentialKind ?? 'api-key';
    const supportsDiscovery = input.supportsDiscovery ?? true;
    const surface = normalizeProviderSurface(input.surface, 'generic');

    const tx = this.raw.transaction(() => {
      const maxOrder = (this.raw
        .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM provider`)
        .get() as { max_order: number }).max_order;
      this.raw
        .prepare(
          `INSERT INTO provider (id, name, base_url, supports_discovery, protocol, surface, enabled, sort_order, imported_from, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        )
        .run(
          providerId,
          name,
          baseUrl,
          supportsDiscovery ? 1 : 0,
          input.protocol,
          surface,
          maxOrder + 1,
          input.importedFrom ?? null,
          now,
          now,
        );

      this.raw
        .prepare(
          `INSERT INTO credential_group (id, provider_id, name, created_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(groupId, providerId, groupName, now);

      this.raw
        .prepare(
          `INSERT INTO credential_ref (id, credential_group_id, label, kind, store_handle, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(refId, groupId, credentialLabel, credentialKind, storeHandle, now, now);
    });
    tx();

    return {
      provider: {
        id: providerId,
        name,
        baseUrl,
        supportsDiscovery,
        protocol: input.protocol,
        surface,
        enabled: true,
        sortOrder: this.getProvider(providerId)?.sortOrder ?? 0,
        importedFrom: input.importedFrom,
        createdAt: now,
        updatedAt: now,
      },
      credentialGroup: {
        id: groupId,
        providerId,
        name: groupName,
        createdAt: now,
      },
      credentialRef: {
        id: refId,
        credentialGroupId: groupId,
        label: credentialLabel,
        kind: credentialKind,
        storeHandle,
        createdAt: now,
        updatedAt: now,
      },
      models: [],
    };
  }

  listProviders(): ProviderCatalogEntry[] {
    const providers = this.raw
      .prepare(
        `SELECT id, name, base_url, supports_discovery, protocol, surface, enabled, sort_order, imported_from, created_at, updated_at
         FROM provider
         ORDER BY sort_order ASC, created_at ASC, id ASC`,
      )
      .all() as ProviderRow[];

    return providers.map((row) => {
      const provider = mapProvider(row);
      const groups = this.raw
        .prepare(
          `SELECT id, provider_id, name, created_at
           FROM credential_group
           WHERE provider_id = ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(provider.id) as CredentialGroupRow[];

      const credentialGroups = groups.map((group) => {
        const creds = this.raw
          .prepare(
            `SELECT id, credential_group_id, label, kind, store_handle, created_at, updated_at
             FROM credential_ref
             WHERE credential_group_id = ?
             ORDER BY created_at ASC, id ASC`,
          )
          .all(group.id) as CredentialRefRow[];
        return {
          ...mapGroup(group),
          credentials: creds.map((cred) => ({
            id: cred.id as CredentialRefId,
            credentialGroupId: cred.credential_group_id as CredentialGroupId,
            label: cred.label,
            kind: cred.kind as CredentialKind,
            createdAt: cred.created_at,
            updatedAt: cred.updated_at,
            hasSecret: true as const,
          })),
        };
      });

      return {
        provider,
        credentialGroups,
        models: this.listModels(provider.id),
      };
    });
  }

  getProvider(providerId: ProviderId): ProviderRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, name, base_url, supports_discovery, protocol, surface, enabled, sort_order, imported_from, created_at, updated_at
         FROM provider WHERE id = ?`,
      )
      .get(providerId) as ProviderRow | undefined;
    return row ? mapProvider(row) : undefined;
  }

  getCredentialStoreHandle(credentialRefId: CredentialRefId | string): string | undefined {
    const row = this.raw
      .prepare(`SELECT store_handle FROM credential_ref WHERE id = ?`)
      .get(credentialRefId) as { store_handle: string } | undefined;
    return row?.store_handle;
  }

  getCredentialRef(credentialRefId: CredentialRefId | string): CredentialRefRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, credential_group_id, label, kind, store_handle, created_at, updated_at
         FROM credential_ref WHERE id = ?`,
      )
      .get(credentialRefId) as CredentialRefRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id as CredentialRefId,
      credentialGroupId: row.credential_group_id as CredentialGroupId,
      label: row.label,
      kind: row.kind as CredentialKind,
      storeHandle: row.store_handle,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }


  getModel(modelId: ModelId | string): ModelRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, provider_id, provider_model_id, display_name, protocol, capabilities_json,
                limits_json, capabilities_confirmed, priority, credential_ref_id, created_at
         FROM model WHERE id = ?`,
      )
      .get(modelId) as ModelRow | undefined;
    return row ? mapModel(row) : undefined;
  }

  findModelByProviderModelId(
    providerId: ProviderId | string,
    providerModelId: string,
  ): ModelRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT id, provider_id, provider_model_id, display_name, protocol, capabilities_json,
                limits_json, capabilities_confirmed, priority, credential_ref_id, created_at
         FROM model WHERE provider_id = ? AND provider_model_id = ?`,
      )
      .get(providerId, providerModelId) as ModelRow | undefined;
    return row ? mapModel(row) : undefined;
  }


  /** All credential refs in a group, oldest first (no secret leakage beyond storeHandle for runtime). */
  listCredentialsByGroup(groupId: CredentialGroupId | string): CredentialRefRecord[] {
    const id = String(groupId ?? '').trim();
    if (!id) return [];
    const rows = this.raw
      .prepare(
        `SELECT id, credential_group_id, label, kind, store_handle, created_at, updated_at
         FROM credential_ref
         WHERE credential_group_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(id) as CredentialRefRow[];
    return rows.map((row) => ({
      id: row.id as CredentialRefId,
      credentialGroupId: row.credential_group_id as CredentialGroupId,
      label: row.label,
      kind: row.kind as CredentialKind,
      storeHandle: row.store_handle,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** First usable credential in a group (operational routing §5.4). */
  getFirstCredentialInGroup(groupId: CredentialGroupId | string): CredentialRefRecord | undefined {
    return this.listCredentialsByGroup(groupId)[0];
  }


  /** Resolve which provider owns a credential group (for §5.4 affinity). */
  getProviderIdForCredentialGroup(
    groupId: CredentialGroupId | string,
  ): ProviderId | undefined {
    const id = String(groupId ?? "").trim();
    if (!id) return undefined;
    const row = this.raw
      .prepare(`SELECT provider_id FROM credential_group WHERE id = ?`)
      .get(id) as { provider_id: string } | undefined;
    if (!row?.provider_id) return undefined;
    return row.provider_id as ProviderId;
  }

  /**
   * Add another credential ref to an existing group (multi-key groups for pin routing).
   * storeHandle is opaque secure-store handle only.
   */
  addCredentialRef(input: {
    credentialGroupId: CredentialGroupId | string;
    label?: string;
    kind?: CredentialKind;
    storeHandle: string;
    id?: CredentialRefId;
    now?: string;
  }): CredentialRefRecord {
    const groupId = String(input.credentialGroupId ?? '').trim();
    if (!groupId) throw new Error('credentialGroupId must not be empty');
    const storeHandle = input.storeHandle.trim();
    if (!storeHandle) throw new Error('Credential store handle must not be empty');
    const group = this.raw
      .prepare(`SELECT id FROM credential_group WHERE id = ?`)
      .get(groupId) as { id: string } | undefined;
    if (!group) throw new Error(`Credential group not found: ${groupId}`);

    const now = input.now ?? new Date().toISOString();
    const refId = (input.id ?? ulid()) as CredentialRefId;
    const label = (input.label ?? 'secondary').trim() || 'secondary';
    const kind: CredentialKind = input.kind ?? 'api-key';

    this.raw
      .prepare(
        `INSERT INTO credential_ref (id, credential_group_id, label, kind, store_handle, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(refId, groupId, label, kind, storeHandle, now, now);

    const created = this.getCredentialRef(refId);
    if (!created) throw new Error('Failed to create credential ref');
    return created;
  }

  /** First credential ref for a provider (default group order). */
  getPrimaryCredentialRef(providerId: ProviderId | string): CredentialRefRecord | undefined {
    const row = this.raw
      .prepare(
        `SELECT cr.id, cr.credential_group_id, cr.label, cr.kind, cr.store_handle, cr.created_at, cr.updated_at
         FROM credential_ref cr
         INNER JOIN credential_group cg ON cg.id = cr.credential_group_id
         WHERE cg.provider_id = ?
         ORDER BY cg.created_at ASC, cr.created_at ASC
         LIMIT 1`,
      )
      .get(providerId) as CredentialRefRow | undefined;
    if (!row) return undefined;
    return {
      id: row.id as CredentialRefId,
      credentialGroupId: row.credential_group_id as CredentialGroupId,
      label: row.label,
      kind: row.kind as CredentialKind,
      storeHandle: row.store_handle,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listAllModels(): ModelRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT id, provider_id, provider_model_id, display_name, protocol, capabilities_json,
                limits_json, capabilities_confirmed, priority, credential_ref_id, created_at
         FROM model
         ORDER BY created_at ASC, provider_model_id ASC`,
      )
      .all() as ModelRow[];
    return rows.map(mapModel);
  }

  listModels(providerId: ProviderId): ModelRecord[] {
    const rows = this.raw
      .prepare(
        `SELECT id, provider_id, provider_model_id, display_name, protocol, capabilities_json,
                limits_json, capabilities_confirmed, priority, credential_ref_id, created_at
         FROM model
         WHERE provider_id = ?
         ORDER BY priority ASC, created_at ASC, provider_model_id ASC`,
      )
      .all(providerId) as ModelRow[];
    return rows.map(mapModel);
  }

  upsertModels(input: UpsertModelsInput): ModelRecord[] {
    if (!this.getProvider(input.providerId)) {
      throw new Error(`Provider not found: ${input.providerId}`);
    }
    if (!PROTOCOLS.has(input.protocol)) {
      throw new Error(`Unsupported protocol: ${input.protocol}`);
    }
    const now = input.now ?? new Date().toISOString();
    const confirmed = input.capabilitiesConfirmed ?? false;
    const results: ModelRecord[] = [];

    const tx = this.raw.transaction(() => {
      let nextPriority =
        ((this.raw
          .prepare(`SELECT COALESCE(MAX(priority), -1) AS max_priority FROM model WHERE provider_id = ?`)
          .get(input.providerId) as { max_priority: number }).max_priority) + 1;
      for (const model of input.models) {
        const providerModelId = model.providerModelId.trim();
        if (!providerModelId) continue;
        const displayName = (model.displayName ?? providerModelId).trim() || providerModelId;
        const capabilities = model.capabilities ?? ['text'];
        const existing = this.raw
          .prepare(
            `SELECT id FROM model WHERE provider_id = ? AND provider_model_id = ?`,
          )
          .get(input.providerId, providerModelId) as { id: string } | undefined;

        if (existing) {
          this.raw
            .prepare(
              `UPDATE model
               SET display_name = ?, protocol = ?, capabilities_json = ?, limits_json = ?,
                   capabilities_confirmed = ?
               WHERE id = ?`,
            )
            .run(
              displayName,
              input.protocol,
              JSON.stringify(capabilities),
              model.limitsJson ?? null,
              confirmed ? 1 : 0,
              existing.id,
            );
          const row = this.raw
            .prepare(
              `SELECT id, provider_id, provider_model_id, display_name, protocol, capabilities_json,
                      limits_json, capabilities_confirmed, priority, credential_ref_id, created_at
               FROM model WHERE id = ?`,
            )
            .get(existing.id) as ModelRow;
          results.push(mapModel(row));
        } else {
          const id = ulid() as ModelId;
          const priority = nextPriority;
          nextPriority += 1;
          this.raw
            .prepare(
              `INSERT INTO model (
                 id, provider_id, provider_model_id, display_name, protocol,
                 capabilities_json, limits_json, capabilities_confirmed, priority, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              input.providerId,
              providerModelId,
              displayName,
              input.protocol,
              JSON.stringify(capabilities),
              model.limitsJson ?? null,
              confirmed ? 1 : 0,
              priority,
              now,
            );
          results.push({
            id,
            providerId: input.providerId,
            providerModelId,
            displayName,
            protocol: input.protocol,
            capabilities,
            limitsJson: model.limitsJson,
            capabilitiesConfirmed: confirmed,
            priority,
            credentialRefId: undefined,
            createdAt: now,
          });
        }
      }
    });
    tx();
    return results;
  }

  /**
   * Update capability tags for a model. When confirmed=true, user has accepted
   * or edited the suggestion (§7.2). Never auto-confirms from probes alone.
   */
  updateModelCapabilities(input: {
    modelId: ModelId | string;
    capabilities: CapabilityTag[];
    capabilitiesConfirmed: boolean;
  }): ModelRecord {
    const modelId = String(input.modelId).trim();
    if (!modelId) throw new Error('Model id must not be empty');
    const existing = this.getModel(modelId as ModelId);
    if (!existing) throw new Error(`Model not found: ${modelId}`);

    const known = new Set<CapabilityTag>([
      'text',
      'vision',
      'tool-calling',
      'web-search',
      'image-generation',
      'embeddings',
    ]);
    const ordered: CapabilityTag[] = [
      'text',
      'vision',
      'tool-calling',
      'web-search',
      'image-generation',
      'embeddings',
    ];
    const seen = new Set<CapabilityTag>();
    for (const raw of input.capabilities) {
      if (typeof raw !== 'string') continue;
      const tag = raw.trim() as CapabilityTag;
      if (!known.has(tag)) continue;
      seen.add(tag);
    }
    const capabilities = ordered.filter((t) => seen.has(t));

    this.raw
      .prepare(
        `UPDATE model
         SET capabilities_json = ?, capabilities_confirmed = ?
         WHERE id = ?`,
      )
      .run(JSON.stringify(capabilities), input.capabilitiesConfirmed ? 1 : 0, modelId);

    const row = this.raw
      .prepare(
        `SELECT id, provider_id, provider_model_id, display_name, protocol, capabilities_json,
                limits_json, capabilities_confirmed, priority, credential_ref_id, created_at
         FROM model WHERE id = ?`,
      )
      .get(modelId) as ModelRow;
    return mapModel(row);
  }

  /**
   * Update display name and/or context window (limitsJson.contextWindow) for one model.
   * contextWindow: number > 0 sets; null clears; undefined keeps current.
   */
  updateModel(input: {
    providerId: ProviderId | string;
    modelId: ModelId | string;
    displayName?: string;
    contextWindow?: number | null;
  }): ModelRecord {
    const providerId = String(input.providerId ?? '').trim();
    const modelId = String(input.modelId ?? '').trim();
    if (!providerId) throw new Error('Provider id must not be empty');
    if (!modelId) throw new Error('Model id must not be empty');
    const existing = this.getModel(modelId as ModelId);
    if (!existing) throw new Error(`Model not found: ${modelId}`);
    if (String(existing.providerId) !== providerId) {
      throw new Error(`Model ${modelId} does not belong to provider ${providerId}`);
    }

    let displayName = existing.displayName;
    if (input.displayName !== undefined) {
      displayName = input.displayName.trim() || existing.providerModelId;
    }

    let limitsJson = existing.limitsJson;
    if (input.contextWindow !== undefined) {
      let limits: Record<string, unknown> = {};
      if (existing.limitsJson) {
        try {
          const parsed = JSON.parse(existing.limitsJson) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            limits = { ...(parsed as Record<string, unknown>) };
          }
        } catch {
          limits = {};
        }
      }
      if (input.contextWindow === null) {
        delete limits.contextWindow;
      } else if (
        typeof input.contextWindow === 'number' &&
        Number.isFinite(input.contextWindow) &&
        input.contextWindow > 0
      ) {
        limits.contextWindow = Math.round(input.contextWindow);
      } else {
        throw new Error('contextWindow must be a positive number or null');
      }
      limitsJson = Object.keys(limits).length > 0 ? JSON.stringify(limits) : undefined;
    }

    this.raw
      .prepare(`UPDATE model SET display_name = ?, limits_json = ? WHERE id = ? AND provider_id = ?`)
      .run(displayName, limitsJson ?? null, modelId, providerId);

    const updated = this.getModel(modelId as ModelId);
    if (!updated) throw new Error(`Model not found after update: ${modelId}`);
    return updated;
  }

  /**
   * Update provider metadata and optionally rotate the primary credential secret.
   * Secrets are never accepted as plaintext here — only secure-store handles.
   */
  updateProvider(input: UpdateProviderInput): UpdateProviderResult {
    const providerId = String(input.providerId ?? '').trim();
    if (!providerId) throw new Error('Provider id must not be empty');
    const existing = this.getProvider(providerId as ProviderId);
    if (!existing) throw new Error(`Provider not found: ${providerId}`);

    const now = input.now ?? new Date().toISOString();
    let name = existing.name;
    if (input.name !== undefined) {
      name = input.name.trim();
      if (name.length === 0) throw new Error('Provider name must not be empty');
    }
    let baseUrl = existing.baseUrl;
    if (input.baseUrl !== undefined) {
      baseUrl = canonicalizeBaseUrl(input.baseUrl);
    }
    let protocol = existing.protocol;
    if (input.protocol !== undefined) {
      if (!PROTOCOLS.has(input.protocol)) {
        throw new Error(`Unsupported protocol: ${input.protocol}`);
      }
      protocol = input.protocol;
    }
    let supportsDiscovery = existing.supportsDiscovery;
    if (input.supportsDiscovery !== undefined) {
      supportsDiscovery = input.supportsDiscovery;
    }
    let surface = existing.surface;
    if (input.surface !== undefined) {
      surface = normalizeProviderSurface(input.surface, existing.surface);
    }
    let enabled = existing.enabled;
    if (input.enabled !== undefined) {
      enabled = input.enabled;
    }

    const primary = this.getPrimaryCredentialRef(providerId);
    let previousStoreHandle: string | undefined;
    let credentialRef = primary;

    const tx = this.raw.transaction(() => {
      this.raw
        .prepare(
          `UPDATE provider
           SET name = ?, base_url = ?, supports_discovery = ?, protocol = ?, surface = ?, enabled = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          name,
          baseUrl,
          supportsDiscovery ? 1 : 0,
          protocol,
          surface,
          enabled ? 1 : 0,
          now,
          providerId,
        );

      // A provider's API format applies to its whole model source. Runtime routes
      // live calls by model.protocol, so keep existing catalog rows in sync when
      // the user switches Chat Completions / Responses / Anthropic formats.
      if (input.protocol !== undefined && protocol !== existing.protocol) {
        this.raw.prepare(`UPDATE model SET protocol = ? WHERE provider_id = ?`).run(protocol, providerId);
      }

      if (primary && (input.storeHandle !== undefined || input.credentialLabel !== undefined)) {
        const nextHandle =
          input.storeHandle !== undefined
            ? input.storeHandle.trim()
            : primary.storeHandle;
        if (!nextHandle) throw new Error('Credential store handle must not be empty');
        const nextLabel =
          input.credentialLabel !== undefined
            ? input.credentialLabel.trim() || primary.label
            : primary.label;
        if (input.storeHandle !== undefined && nextHandle !== primary.storeHandle) {
          previousStoreHandle = primary.storeHandle;
        }
        this.raw
          .prepare(
            `UPDATE credential_ref
             SET label = ?, store_handle = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(nextLabel, nextHandle, now, primary.id);
        credentialRef = {
          ...primary,
          label: nextLabel,
          storeHandle: nextHandle,
          updatedAt: now,
        };
      } else if (!primary && input.storeHandle) {
        throw new Error('Provider has no credential to rotate');
      }
    });
    tx();

    const provider = this.getProvider(providerId as ProviderId)!;
    return {
      provider,
      previousStoreHandle,
      credentialRef: credentialRef
        ? {
            id: credentialRef.id,
            credentialGroupId: credentialRef.credentialGroupId,
            label: credentialRef.label,
            kind: credentialRef.kind,
            storeHandle: credentialRef.storeHandle,
            createdAt: credentialRef.createdAt,
            updatedAt: credentialRef.updatedAt,
          }
        : undefined,
    };
  }

  /**
   * 0026: persist a manual provider ordering (drag & drop; first enabled entry
   * is the default). Ids not present keep their relative order after the given ones.
   */
  reorderProviders(orderedProviderIds: Array<ProviderId | string>, now?: string): void {
    const ids = orderedProviderIds.map((id) => String(id ?? '').trim()).filter(Boolean);
    if (ids.length === 0) return;
    const ts = now ?? new Date().toISOString();
    const tx = this.raw.transaction(() => {
      const stmt = this.raw.prepare(
        `UPDATE provider SET sort_order = ?, updated_at = ? WHERE id = ?`,
      );
      ids.forEach((id, index) => {
        stmt.run(index, ts, id);
      });
      // Push providers missing from the list after the explicit ones, keeping order.
      const rest = this.raw
        .prepare(
          `SELECT id FROM provider WHERE id NOT IN (${ids.map(() => '?').join(',')})
           ORDER BY sort_order ASC, created_at ASC, id ASC`,
        )
        .all(...ids) as Array<{ id: string }>;
      rest.forEach((row, index) => {
        stmt.run(ids.length + index, ts, row.id);
      });
    });
    tx();
  }

  /**
   * 0026: persist the model priority chain of one provider (0 = primary), with
   * an optional pinned credential per model (relay-station key groups).
   */
  setModelPriorities(input: {
    providerId: ProviderId | string;
    entries: Array<{ modelId: ModelId | string; credentialRefId?: CredentialRefId | string | null }>;
  }): ModelRecord[] {
    const providerId = String(input.providerId ?? '').trim();
    if (!providerId) throw new Error('Provider id must not be empty');
    if (!this.getProvider(providerId as ProviderId)) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    const tx = this.raw.transaction(() => {
      const stmt = this.raw.prepare(
        `UPDATE model SET priority = ?, credential_ref_id = ? WHERE id = ? AND provider_id = ?`,
      );
      input.entries.forEach((entry, index) => {
        const modelId = String(entry.modelId ?? '').trim();
        if (!modelId) return;
        const credentialRefId =
          entry.credentialRefId === undefined
            ? (this.getModel(modelId)?.credentialRefId ?? null)
            : entry.credentialRefId
              ? String(entry.credentialRefId).trim() || null
              : null;
        stmt.run(index, credentialRefId, modelId, providerId);
      });
    });
    tx();
    return this.listModels(providerId as ProviderId);
  }

  /** 0026: remove a model from a provider's priority chain. */
  removeModel(modelId: ModelId | string): boolean {
    const id = String(modelId ?? '').trim();
    if (!id) return false;
    const result = this.raw.prepare(`DELETE FROM model WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  /**
   * Resolve a credential that belongs to the given provider.
   * Returns undefined when the credential is missing or belongs to another provider.
   */
  getCredentialRefForProvider(
    providerId: ProviderId | string,
    credentialRefId: CredentialRefId | string,
  ): CredentialRefRecord | undefined {
    const pid = String(providerId ?? '').trim();
    const cid = String(credentialRefId ?? '').trim();
    if (!pid || !cid) return undefined;
    const ref = this.getCredentialRef(cid);
    if (!ref) return undefined;
    const owner = this.getProviderIdForCredentialGroup(ref.credentialGroupId);
    if (!owner || owner !== pid) return undefined;
    return ref;
  }

  /**
   * Update one credential by id: optional label and/or storeHandle rotation.
   * Secrets are never accepted as plaintext here — only secure-store handles.
   */
  updateCredentialRef(input: {
    providerId: ProviderId | string;
    credentialRefId: CredentialRefId | string;
    label?: string;
    storeHandle?: string;
    now?: string;
  }): { credential: CredentialRefRecord; previousStoreHandle?: string } {
    const providerId = String(input.providerId ?? '').trim();
    const credentialRefId = String(input.credentialRefId ?? '').trim();
    if (!providerId) throw new Error('Provider id must not be empty');
    if (!credentialRefId) throw new Error('Credential ref id must not be empty');
    const existing = this.getCredentialRefForProvider(providerId, credentialRefId);
    if (!existing) {
      throw new Error(`Credential ref not found for provider: ${credentialRefId}`);
    }
    const now = input.now ?? new Date().toISOString();
    const nextLabel =
      input.label !== undefined ? input.label.trim() || existing.label : existing.label;
    let nextHandle = existing.storeHandle;
    let previousStoreHandle: string | undefined;
    if (input.storeHandle !== undefined) {
      nextHandle = input.storeHandle.trim();
      if (!nextHandle) throw new Error('Credential store handle must not be empty');
      if (nextHandle !== existing.storeHandle) {
        previousStoreHandle = existing.storeHandle;
      }
    }
    this.raw
      .prepare(
        `UPDATE credential_ref
         SET label = ?, store_handle = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(nextLabel, nextHandle, now, credentialRefId);
    const updated = this.getCredentialRef(credentialRefId);
    if (!updated) throw new Error(`Credential ref not found after update: ${credentialRefId}`);
    return { credential: updated, previousStoreHandle };
  }

  /**
   * 0026: remove a credential ref (multi-key management). Refuses to delete the
   * last remaining credential of a provider. Returns the removed storeHandle so
   * the caller can purge the secret from the secure store.
   */
  removeCredentialRef(credentialRefId: CredentialRefId | string): { storeHandle: string } {
    const id = String(credentialRefId ?? '').trim();
    if (!id) throw new Error('Credential ref id must not be empty');
    const ref = this.getCredentialRef(id);
    if (!ref) throw new Error(`Credential ref not found: ${id}`);
    const providerId = this.getProviderIdForCredentialGroup(ref.credentialGroupId);
    if (providerId) {
      const count = (this.raw
        .prepare(
          `SELECT COUNT(*) AS n FROM credential_ref cr
           INNER JOIN credential_group cg ON cg.id = cr.credential_group_id
           WHERE cg.provider_id = ?`,
        )
        .get(providerId) as { n: number }).n;
      if (count <= 1) {
        throw new Error('Cannot remove the last credential of a provider');
      }
    }
    const tx = this.raw.transaction(() => {
      // Unpin models that referenced this credential.
      this.raw.prepare(`UPDATE model SET credential_ref_id = NULL WHERE credential_ref_id = ?`).run(id);
      this.raw.prepare(`DELETE FROM credential_ref WHERE id = ?`).run(id);
    });
    tx();
    return { storeHandle: ref.storeHandle };
  }
}

function canonicalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    throw new Error('Base URL must not be empty');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Base URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Base URL must use http or https');
  }
  // Normalize trailing slash away except bare origin paths.
  const path = url.pathname.replace(/\/+$/, '') || '';
  return `${url.protocol}//${url.host}${path}${url.search}`;
}

function mapProvider(row: ProviderRow): ProviderRecord {
  const rawProtocol = typeof row.protocol === 'string' ? row.protocol : 'openai-chat';
  const protocol = (PROTOCOLS.has(rawProtocol as ProtocolFamily)
    ? (rawProtocol as ProtocolFamily)
    : 'openai-chat') as ProtocolFamily;
  return {
    id: row.id as ProviderId,
    name: row.name,
    baseUrl: row.base_url,
    supportsDiscovery: row.supports_discovery === 1,
    protocol,
    surface: normalizeProviderSurface(row.surface, 'generic'),
    enabled: row.enabled !== 0,
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
    importedFrom: row.imported_from ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGroup(row: CredentialGroupRow): CredentialGroupRecord {
  return {
    id: row.id as CredentialGroupId,
    providerId: row.provider_id as ProviderId,
    name: row.name,
    createdAt: row.created_at,
  };
}

function mapModel(row: ModelRow): ModelRecord {
  let capabilities: CapabilityTag[] = [];
  try {
    const parsed = JSON.parse(row.capabilities_json) as unknown;
    if (Array.isArray(parsed)) {
      capabilities = parsed.filter((item): item is CapabilityTag => typeof item === 'string') as CapabilityTag[];
    }
  } catch {
    capabilities = [];
  }
  return {
    id: row.id as ModelId,
    providerId: row.provider_id as ProviderId,
    providerModelId: row.provider_model_id,
    displayName: row.display_name,
    protocol: row.protocol as ProtocolFamily,
    capabilities,
    limitsJson: row.limits_json ?? undefined,
    capabilitiesConfirmed: row.capabilities_confirmed === 1,
    priority: typeof row.priority === 'number' ? row.priority : 0,
    credentialRefId: (row.credential_ref_id ?? undefined) as CredentialRefId | undefined,
    createdAt: row.created_at,
  };
}
