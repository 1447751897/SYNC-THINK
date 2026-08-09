import type {
  CapabilityGovernanceListPayload,
  CapabilityWorkspaceListPayload,
  CapabilityWorkspaceSetActivePayload,
  GetLatestCapabilityOrganizePayload,
  GetSkillPublishDraftPayload,
  ListSkillPublishDraftsPayload,
  PreviewCapabilityOrganizePayload,
  SaveSkillPublishDraftPayload,
  SubmitSkillPublishDraftPayload,
} from '@sync-think/protocol';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function requiredText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function optionalIsoDate(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= 64 &&
      !Number.isNaN(new Date(value).getTime()))
  );
}

function capabilityType(value: unknown): value is 'skill' | 'mcp' {
  return value === 'skill' || value === 'mcp';
}

export function parseCapabilityWorkspaceListPayload(
  value: unknown,
): CapabilityWorkspaceListPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'capabilityType']) ||
    !requiredText(value.workspaceId, 256) ||
    (value.capabilityType !== undefined && !capabilityType(value.capabilityType))
  ) {
    throw new Error('Invalid capability.workspace.list payload');
  }
  return {
    workspaceId: value.workspaceId.trim(),
    ...(value.capabilityType === undefined ? {} : { capabilityType: value.capabilityType }),
  };
}

export function parseCapabilityWorkspaceSetActivePayload(
  value: unknown,
): CapabilityWorkspaceSetActivePayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'capabilityType', 'capabilityId', 'active']) ||
    !requiredText(value.workspaceId, 256) ||
    !capabilityType(value.capabilityType) ||
    !requiredText(value.capabilityId, 256) ||
    typeof value.active !== 'boolean'
  ) {
    throw new Error('Invalid capability.workspace.setActive payload');
  }
  return {
    workspaceId: value.workspaceId.trim(),
    capabilityType: value.capabilityType,
    capabilityId: value.capabilityId.trim(),
    active: value.active,
  };
}

export function parseCapabilityGovernanceListPayload(
  value: unknown,
): CapabilityGovernanceListPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'now']) ||
    !requiredText(value.workspaceId, 256) ||
    !optionalIsoDate(value.now)
  ) {
    throw new Error('Invalid capability.governance.list payload');
  }
  return {
    workspaceId: value.workspaceId.trim(),
    ...(value.now === undefined ? {} : { now: value.now }),
  };
}

export function parseSaveSkillPublishDraftPayload(
  value: unknown,
): SaveSkillPublishDraftPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'id',
      'skillVersionId',
      'skillId',
      'displayName',
      'description',
      'skillMd',
      'category',
      'version',
      'icon',
      'attachments',
    ]) ||
    (value.id !== undefined && !requiredText(value.id, 256)) ||
    !requiredText(value.skillVersionId, 256) ||
    !requiredText(value.skillId, 256) ||
    !requiredText(value.displayName, 128) ||
    typeof value.description !== 'string' ||
    value.description.length > 20_000 ||
    typeof value.skillMd !== 'string' ||
    value.skillMd.length === 0 ||
    value.skillMd.length > 512_000 ||
    !requiredText(value.category, 128) ||
    !requiredText(value.version, 64) ||
    typeof value.icon !== 'string' ||
    value.icon.length > 256
  ) {
    throw new Error('Invalid capability.publishDraft.save payload');
  }

  let attachments: SaveSkillPublishDraftPayload['attachments'];
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments) || value.attachments.length > 32) {
      throw new Error('Invalid capability.publishDraft.save payload');
    }
    attachments = value.attachments.map((attachment) => {
      if (
        !isRecord(attachment) ||
        !hasOnlyKeys(attachment, ['name', 'size']) ||
        !requiredText(attachment.name, 256) ||
        !Number.isSafeInteger(attachment.size) ||
        (attachment.size as number) < 0 ||
        (attachment.size as number) > 1_000_000_000
      ) {
        throw new Error('Invalid capability.publishDraft.save payload');
      }
      return { name: attachment.name.trim(), size: attachment.size as number };
    });
  }

  return {
    ...(value.id === undefined ? {} : { id: value.id.trim() }),
    skillVersionId: value.skillVersionId.trim(),
    skillId: value.skillId.trim(),
    displayName: value.displayName.trim(),
    description: value.description,
    skillMd: value.skillMd,
    category: value.category.trim(),
    version: value.version.trim(),
    icon: value.icon.trim(),
    ...(attachments === undefined ? {} : { attachments }),
  };
}

export function parseListSkillPublishDraftsPayload(
  value: unknown,
): ListSkillPublishDraftsPayload {
  if (value === undefined || value === null) return {};
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['skillId', 'limit']) ||
    (value.skillId !== undefined && !requiredText(value.skillId, 256)) ||
    (value.limit !== undefined &&
      (!Number.isSafeInteger(value.limit) ||
        (value.limit as number) < 1 ||
        (value.limit as number) > 500))
  ) {
    throw new Error('Invalid capability.publishDraft.list payload');
  }
  return {
    ...(value.skillId === undefined ? {} : { skillId: value.skillId.trim() }),
    ...(value.limit === undefined ? {} : { limit: value.limit as number }),
  };
}

function parseDraftId(
  value: unknown,
  command: 'get' | 'submit',
): GetSkillPublishDraftPayload | SubmitSkillPublishDraftPayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id']) ||
    !requiredText(value.id, 256)
  ) {
    throw new Error(`Invalid capability.publishDraft.${command} payload`);
  }
  return { id: value.id.trim() };
}

export function parseGetSkillPublishDraftPayload(value: unknown): GetSkillPublishDraftPayload {
  return parseDraftId(value, 'get');
}

export function parseSubmitSkillPublishDraftPayload(
  value: unknown,
): SubmitSkillPublishDraftPayload {
  return parseDraftId(value, 'submit');
}

export function parsePreviewCapabilityOrganizePayload(
  value: unknown,
): PreviewCapabilityOrganizePayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'contextBudgetTokens', 'now']) ||
    !requiredText(value.workspaceId, 256) ||
    !Number.isSafeInteger(value.contextBudgetTokens) ||
    (value.contextBudgetTokens as number) < 1 ||
    !optionalIsoDate(value.now)
  ) {
    throw new Error('Invalid capability.organize.preview payload');
  }
  return {
    workspaceId: value.workspaceId.trim(),
    contextBudgetTokens: value.contextBudgetTokens as number,
    ...(value.now === undefined ? {} : { now: value.now }),
  };
}

export function parseGetLatestCapabilityOrganizePayload(
  value: unknown,
): GetLatestCapabilityOrganizePayload {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId']) ||
    !requiredText(value.workspaceId, 256)
  ) {
    throw new Error('Invalid capability.organize.getLatest payload');
  }
  return { workspaceId: value.workspaceId.trim() };
}
