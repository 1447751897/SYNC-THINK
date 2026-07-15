import type { ProtocolFamily, ProviderSurface } from '@sync-think/shared';
import { surfaceFromCcSwitchAppType } from '@sync-think/shared';

/** Raw row shape from CC Switch local SQLite `providers` table (or fixtures). */
export interface CcSwitchProviderRow {
  id: string;
  app_type: string;
  name: string;
  settings_config: string | Record<string, unknown>;
  meta?: string | Record<string, unknown> | null;
  is_current?: number | boolean | null;
}

export interface CcSwitchMappedProvider {
  sourceId: string;
  appType: string;
  name: string;
  baseUrl?: string;
  protocol?: ProtocolFamily;
  surface: ProviderSurface;
  /** Present only in secret-capable map; never log/export. */
  apiKey?: string;
  models: string[];
  credentialGroupName: string;
  credentialLabel: string;
  importedFrom: string;
  warnings: string[];
  importable: boolean;
  hasSecret: boolean;
}

export interface CcSwitchPreviewItem {
  sourceId: string;
  appType: string;
  name: string;
  baseUrl?: string;
  protocol?: ProtocolFamily;
  surface: ProviderSurface;
  hasSecret: boolean;
  models: string[];
  credentialGroupName: string;
  importedFrom: string;
  warnings: string[];
  importable: boolean;
}

const IMPORTED_FROM = 'cc-switch@local-db';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonField(value: string | Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'object') return asRecord(value);
  if (typeof value !== 'string' || value.trim().length === 0) return {};
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function extractBaseUrlFromToml(config: string): string | undefined {
  const m = /base_url\s*=\s*"([^"]+)"/.exec(config);
  return m?.[1]?.trim() || undefined;
}

function extractModelFromToml(config: string): string | undefined {
  const m = /^model\s*=\s*"([^"]+)"/m.exec(config);
  return m?.[1]?.trim() || undefined;
}

function mapApiFormat(apiFormat: unknown, appType: string, hasAnthropicBase: boolean): {
  protocol?: ProtocolFamily;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (typeof apiFormat === 'string') {
    const normalized = apiFormat.trim().toLowerCase().replace(/-/g, '_');
    if (normalized === 'openai_chat') return { protocol: 'openai-chat', warnings };
    if (normalized === 'openai_responses') return { protocol: 'openai-responses', warnings };
    if (normalized === 'openai_images') return { protocol: 'openai-images', warnings };
    if (normalized === 'anthropic_messages' || normalized === 'anthropic') {
      return { protocol: 'anthropic-messages', warnings };
    }
    warnings.push(`未知 apiFormat: ${apiFormat}`);
  }

  if (appType === 'claude' || appType === 'claude-desktop') {
    if (hasAnthropicBase) return { protocol: 'anthropic-messages', warnings };
    return { protocol: 'anthropic-messages', warnings: [...warnings, '未声明 apiFormat，按 Anthropic Messages 推断'] };
  }
  if (appType === 'codex') {
    return { protocol: 'openai-responses', warnings: [...warnings, '未声明 apiFormat，按 OpenAI Responses 推断'] };
  }
  if (appType === 'gemini') {
    warnings.push('Gemini 官方配置暂不支持自动映射协议');
    return { protocol: undefined, warnings };
  }
  warnings.push(`未知 app_type: ${appType}`);
  return { protocol: undefined, warnings };
}

function collectModels(env: Record<string, unknown>, configToml?: string): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  };
  for (const [key, value] of Object.entries(env)) {
    const upper = key.toUpperCase();
    if (upper.includes('MODEL') && !upper.endsWith('_NAME')) {
      push(value);
    }
  }
  if (configToml) {
    const m = extractModelFromToml(configToml);
    if (m) out.push(m);
  }
  // Prefer unique order-preserving
  return [...new Set(out)];
}

function pickSecret(env: Record<string, unknown>, auth: Record<string, unknown>): string | undefined {
  const candidates = [
    auth.OPENAI_API_KEY,
    env.ANTHROPIC_AUTH_TOKEN,
    env.ANTHROPIC_API_KEY,
    env.OPENAI_API_KEY,
    auth.ANTHROPIC_AUTH_TOKEN,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

/**
 * Map one CC Switch provider row into SYNC-THINK create shape.
 * Never logs secrets. Callers must scrub apiKey after secure-store write.
 */
export function mapCcSwitchProviderRow(row: CcSwitchProviderRow): CcSwitchMappedProvider {
  const settings = parseJsonField(row.settings_config);
  const meta = parseJsonField(row.meta ?? undefined);
  const env = asRecord(settings.env);
  const auth = asRecord(settings.auth);
  const configToml = typeof settings.config === 'string' ? settings.config : undefined;

  const baseUrl =
    (typeof env.ANTHROPIC_BASE_URL === 'string' && env.ANTHROPIC_BASE_URL.trim()) ||
    (configToml ? extractBaseUrlFromToml(configToml) : undefined) ||
    undefined;

  const apiKey = pickSecret(env, auth);
  const models = collectModels(env, configToml);
  const { protocol, warnings: protocolWarnings } = mapApiFormat(
    meta.apiFormat,
    String(row.app_type ?? ''),
    Boolean(baseUrl && String(env.ANTHROPIC_BASE_URL ?? '').length > 0),
  );

  const warnings = [...protocolWarnings];
  const name = String(row.name ?? '').trim() || String(row.id);
  const official =
    /official/i.test(String(row.id)) ||
    /official/i.test(name) ||
    String(row.id).endsWith('-official');

  if (official && !baseUrl) {
    warnings.push('官方配置缺少自定义 base URL，跳过自动导入');
  }
  if (!baseUrl) {
    warnings.push('缺少 base URL');
  }
  if (!apiKey) {
    warnings.push('缺少可导入密钥');
  }
  if (!protocol) {
    warnings.push('无法映射协议');
  }

  // Official empty profiles are not importable even if they have a key without base.
  const importable = Boolean(baseUrl && apiKey && protocol && !(!baseUrl && official));

  // If official has no usable gateway, force not importable
  const finalImportable = official && !baseUrl ? false : importable;

  if (String(row.app_type) === 'gemini') {
    warnings.push('Gemini 导入为非目标（M1 soft 范围外）');
  }

  return {
    sourceId: String(row.id),
    appType: String(row.app_type ?? ''),
    name,
    baseUrl,
    protocol,
    surface: surfaceFromCcSwitchAppType(row.app_type),
    apiKey,
    models,
    credentialGroupName: `cc-switch:${row.app_type}`,
    credentialLabel: 'imported',
    importedFrom: IMPORTED_FROM,
    warnings: [...new Set(warnings)],
    importable: finalImportable && String(row.app_type) !== 'gemini',
    hasSecret: Boolean(apiKey),
  };
}

/** Preview DTO — never includes apiKey. */
export function toCcSwitchPreviewItem(mapped: CcSwitchMappedProvider): CcSwitchPreviewItem {
  return {
    sourceId: mapped.sourceId,
    appType: mapped.appType,
    name: mapped.name,
    baseUrl: mapped.baseUrl,
    protocol: mapped.protocol,
    surface: mapped.surface,
    hasSecret: mapped.hasSecret,
    models: mapped.models,
    credentialGroupName: mapped.credentialGroupName,
    importedFrom: mapped.importedFrom,
    warnings: mapped.warnings,
    importable: mapped.importable,
  };
}

export function mapCcSwitchProviderRows(rows: readonly CcSwitchProviderRow[]): CcSwitchMappedProvider[] {
  return rows.map((row) => mapCcSwitchProviderRow(row));
}

export function previewCcSwitchProviderRows(rows: readonly CcSwitchProviderRow[]): CcSwitchPreviewItem[] {
  return mapCcSwitchProviderRows(rows).map(toCcSwitchPreviewItem);
}
