/**
 * Per-provider OAuth client credentials.
 *
 * The user registers an OAuth app in each provider's console and types the
 * client id / secret here. Nothing in this file ever invents, defaults or
 * inspects a credential — an unconfigured provider simply cannot start a flow,
 * and the error says so.
 *
 * Credentials are keyed by `providerId`, not by integration: one Google client
 * backs Google Docs and Gmail, so registering it twice would be wrong.
 *
 * The secret goes to the OS keychain through SecureStore and only its handle is
 * persisted, mirroring WebSearchConfigStore.
 */
import type { OauthClientConfigSummary } from '@sync-think/protocol';
import { defaultRedirectUriFor, resolveRedirectUri } from './redirect.js';

export interface SettingStoreLike {
  get(key: string): { value: unknown } | undefined;
  set(key: string, value: unknown, now?: string): unknown;
  list?(): Array<{ key: string; value: unknown; updatedAt?: string }>;
}

export interface SecureStoreLike {
  storeSecret(value: string): Promise<string>;
  retrieveSecret(handle: string): Promise<string>;
  removeSecret(handle: string): Promise<unknown>;
}

export const OAUTH_CLIENT_CONFIG_PREFIX = 'oauth.client.';

interface PersistedClientConfig {
  providerId: string;
  clientId: string;
  secretHandle?: string;
  redirectUri?: string;
  tenant?: string;
  updatedAt?: string;
}

export interface ResolvedClientConfig {
  providerId: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  tenant?: string;
}

export interface SaveClientConfigInput {
  providerId: string;
  clientId: string;
  /** Absent on update, which keeps the previously stored secret. */
  clientSecret?: string;
  redirectUri?: string;
  tenant?: string;
}

export class OauthClientConfigStore {
  constructor(
    private readonly settings: SettingStoreLike,
    private readonly secrets: SecureStoreLike,
  ) {}

  get(providerId: string): PersistedClientConfig | undefined {
    const id = providerId.trim().toLowerCase();
    if (!id) return undefined;
    return parseConfig(this.settings.get(settingKey(id))?.value, id);
  }

  isConfigured(providerId: string): boolean {
    const config = this.get(providerId);
    return Boolean(config?.clientId && config.secretHandle);
  }

  list(providerId?: string): OauthClientConfigSummary[] {
    const wanted = providerId?.trim().toLowerCase();
    const configs = wanted
      ? [this.get(wanted)].filter((row): row is PersistedClientConfig => Boolean(row))
      : this.readAll();
    return configs.map((config) => this.toSummary(config));
  }

  /**
   * Persist credentials, returning the redirect URI the user must register.
   *
   * Omitting `clientSecret` on an update preserves the stored one: the settings
   * form never round-trips a secret back to the renderer, so a blank field means
   * "unchanged", not "clear".
   */
  async save(input: SaveClientConfigInput): Promise<OauthClientConfigSummary> {
    const providerId = input.providerId.trim().toLowerCase();
    if (!providerId) throw new Error('providerId is required');
    const clientId = input.clientId.trim();
    if (!clientId) throw new Error('clientId is required');

    const previous = this.get(providerId);
    const now = new Date().toISOString();
    let secretHandle = previous?.secretHandle;
    let createdHandle: string | undefined;
    try {
      const secret = input.clientSecret?.trim();
      if (secret) {
        createdHandle = await this.secrets.storeSecret(secret);
        secretHandle = createdHandle;
      }
      const redirectUri = resolveRedirectUri(providerId, input.redirectUri ?? previous?.redirectUri);
      const next: PersistedClientConfig = {
        providerId,
        clientId,
        ...(secretHandle ? { secretHandle } : {}),
        redirectUri,
        ...(input.tenant?.trim() || previous?.tenant
          ? { tenant: input.tenant?.trim() || previous?.tenant }
          : {}),
        updatedAt: now,
      };
      this.settings.set(settingKey(providerId), next, now);
      // Only retire the old handle once the new one is durably stored.
      if (createdHandle && previous?.secretHandle && previous.secretHandle !== createdHandle) {
        await this.secrets.removeSecret(previous.secretHandle).catch(() => undefined);
      }
      return this.toSummary(next);
    } catch (error) {
      if (createdHandle) {
        await this.secrets.removeSecret(createdHandle).catch(() => undefined);
      }
      throw error;
    }
  }

  /** Drop credentials for one provider. Tokens already issued stay valid until revoked. */
  async clear(providerId: string): Promise<void> {
    const id = providerId.trim().toLowerCase();
    if (!id) return;
    const previous = this.get(id);
    // The settings store has no delete; an empty record reads back as absent.
    this.settings.set(settingKey(id), { providerId: id, clientId: '' });
    if (previous?.secretHandle) {
      await this.secrets.removeSecret(previous.secretHandle).catch(() => undefined);
    }
  }

  /** The redirect URI to show in the settings dialog before anything is saved. */
  redirectUriFor(providerId: string): string {
    const configured = this.get(providerId)?.redirectUri;
    return resolveRedirectUri(providerId, configured ?? defaultRedirectUriFor(providerId));
  }

  /**
   * Credentials plus the plaintext secret, for the flow broker only.
   *
   * Throws a message the UI can show verbatim when the provider has not been
   * configured — that is the single most common failure and it needs to name the
   * provider so the user knows which card to fill in.
   */
  async resolve(providerId: string, label: string): Promise<ResolvedClientConfig> {
    const config = this.get(providerId);
    if (!config?.clientId || !config.secretHandle) {
      throw new Error(`${label} 尚未配置 OAuth 客户端，请先在连接器设置里填写 Client ID 与 Client Secret。`);
    }
    const clientSecret = (await this.secrets.retrieveSecret(config.secretHandle)).trim();
    if (!clientSecret) {
      throw new Error(`${label} 的 Client Secret 无法从系统密钥库读取，请重新填写。`);
    }
    return {
      providerId,
      clientId: config.clientId,
      clientSecret,
      redirectUri: this.redirectUriFor(providerId),
      ...(config.tenant ? { tenant: config.tenant } : {}),
    };
  }

  private toSummary(config: PersistedClientConfig): OauthClientConfigSummary {
    const redirectUri = resolveRedirectUri(config.providerId, config.redirectUri);
    const updatedAt = config.updatedAt ? Date.parse(config.updatedAt) : 0;
    return {
      providerId: config.providerId,
      clientId: config.clientId,
      configured: Boolean(config.clientId && config.secretHandle),
      redirectUri,
      ...(config.tenant ? { tenant: config.tenant } : {}),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    };
  }

  private readAll(): PersistedClientConfig[] {
    // Prefer the indexed prefix; without a list() the caller must ask per provider.
    const rows = this.settings.list?.() ?? [];
    const configs: PersistedClientConfig[] = [];
    for (const row of rows) {
      if (!row.key.startsWith(OAUTH_CLIENT_CONFIG_PREFIX)) continue;
      const id = row.key.slice(OAUTH_CLIENT_CONFIG_PREFIX.length);
      const config = parseConfig(row.value, id);
      if (config) configs.push(config);
    }
    return configs.sort((left, right) => left.providerId.localeCompare(right.providerId));
  }
}

function settingKey(providerId: string): string {
  return `${OAUTH_CLIENT_CONFIG_PREFIX}${providerId}`;
}

function parseConfig(value: unknown, providerId: string): PersistedClientConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const clientId = typeof record.clientId === 'string' ? record.clientId.trim() : '';
  // A record without a client id is the tombstone written by clear().
  if (!clientId) return undefined;
  return {
    providerId,
    clientId,
    ...(stringValue(record.secretHandle) ? { secretHandle: stringValue(record.secretHandle) } : {}),
    ...(stringValue(record.redirectUri) ? { redirectUri: stringValue(record.redirectUri) } : {}),
    ...(stringValue(record.tenant) ? { tenant: stringValue(record.tenant) } : {}),
    ...(stringValue(record.updatedAt) ? { updatedAt: stringValue(record.updatedAt) } : {}),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
