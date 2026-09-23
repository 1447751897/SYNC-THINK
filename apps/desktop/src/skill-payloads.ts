import type {
  DeleteSkillPayload,
  GetSkillPayload,
  ImportRemoteSkillPayload,
  ImportSkillPayload,
  ListSkillsPayload,
  SetSkillEnabledPayload,
} from '@sync-think/protocol';
import { isRecord } from '@sync-think/shared/value-validation';

export function parseImportSkillPayload(value: unknown): ImportSkillPayload {
  if (!isRecord(value)) throw new Error('Invalid import-skill payload');
  if (typeof value.skillMd !== 'string' || value.skillMd.trim().length === 0) {
    throw new Error('Invalid import-skill payload');
  }
  if (value.skillMd.length > 512000) throw new Error('Invalid import-skill payload');
  if (
    value.originType !== undefined &&
    value.originType !== 'local' &&
    value.originType !== 'market' &&
    value.originType !== 'derived'
  ) {
    throw new Error('Invalid import-skill payload');
  }
  for (const key of ['originRef', 'derivedFromSkillVersionId', 'skillId'] as const) {
    const entry = value[key];
    if (
      entry !== undefined &&
      (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 512)
    ) {
      throw new Error('Invalid import-skill payload');
    }
  }
  if (value.originType === 'derived' && value.derivedFromSkillVersionId === undefined) {
    throw new Error('Invalid import-skill payload');
  }
  return {
    skillMd: value.skillMd,
    originType: value.originType as ImportSkillPayload['originType'],
    originRef: typeof value.originRef === 'string' ? value.originRef.trim() : undefined,
    derivedFromSkillVersionId:
      typeof value.derivedFromSkillVersionId === 'string'
        ? value.derivedFromSkillVersionId.trim()
        : undefined,
    skillId: typeof value.skillId === 'string' ? value.skillId.trim() : undefined,
  };
}

export function parseImportRemoteSkillPayload(value: unknown): ImportRemoteSkillPayload {
  if (!isRecord(value) || typeof value.url !== 'string' || !value.url.trim()) {
    throw new Error('Invalid import-remote-skill payload');
  }
  let url: URL;
  try {
    url = new URL(value.url.trim());
  } catch {
    throw new Error('Invalid import-remote-skill payload: URL required');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error('Invalid import-remote-skill payload: only http(s) URLs are supported');
  }
  for (const key of ['originRef', 'skillId'] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 512)
    ) {
      throw new Error('Invalid import-remote-skill payload');
    }
  }
  return {
    url: url.toString(),
    originRef: typeof value.originRef === 'string' ? value.originRef.trim() : undefined,
    skillId: typeof value.skillId === 'string' ? value.skillId.trim() : undefined,
  };
}

export function parseListSkillsPayload(value: unknown): ListSkillsPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid list-skills payload');
  if (
    value.limit !== undefined &&
    (typeof value.limit !== 'number' ||
      !Number.isFinite(value.limit) ||
      value.limit < 1 ||
      value.limit > 500)
  ) {
    throw new Error('Invalid list-skills payload');
  }
  if (
    value.workspaceId !== undefined &&
    (typeof value.workspaceId !== 'string' ||
      value.workspaceId.trim().length === 0 ||
      value.workspaceId.length > 256)
  ) {
    throw new Error('Invalid list-skills payload');
  }
  let skillVersionIds: string[] | undefined;
  if (value.skillVersionIds !== undefined) {
    if (!Array.isArray(value.skillVersionIds) || value.skillVersionIds.length > 64) {
      throw new Error('Invalid list-skills payload');
    }
    skillVersionIds = [];
    const seen = new Set<string>();
    for (const raw of value.skillVersionIds) {
      if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 256) {
        throw new Error('Invalid list-skills payload');
      }
      const id = raw.trim();
      if (seen.has(id)) continue;
      seen.add(id);
      skillVersionIds.push(id);
    }
  }
  return {
    limit: value.limit as number | undefined,
    ...(typeof value.workspaceId === 'string' ? { workspaceId: value.workspaceId.trim() } : {}),
    skillVersionIds,
  };
}

function parseSkillVersionId(value: unknown, label: string): string {
  if (
    !isRecord(value) ||
    typeof value.skillVersionId !== 'string' ||
    value.skillVersionId.trim().length === 0 ||
    value.skillVersionId.length > 256
  ) {
    throw new Error(label);
  }
  return value.skillVersionId.trim();
}

export function parseDeleteSkillPayload(value: unknown): DeleteSkillPayload {
  return { skillVersionId: parseSkillVersionId(value, 'Invalid delete-skill payload') };
}

export function parseGetSkillPayload(value: unknown): GetSkillPayload {
  return { skillVersionId: parseSkillVersionId(value, 'Invalid get-skill payload') };
}

export function parseSetSkillEnabledPayload(value: unknown): SetSkillEnabledPayload {
  if (
    !isRecord(value) ||
    typeof value.skillVersionId !== 'string' ||
    value.skillVersionId.trim().length === 0 ||
    typeof value.enabled !== 'boolean'
  ) {
    throw new Error('Invalid set-skill-enabled payload');
  }
  return {
    skillVersionId: value.skillVersionId.trim(),
    enabled: value.enabled,
  };
}
