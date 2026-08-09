// skill-mcp command payload parsers (extracted from command-validation.ts).
import type {
  ImportSkillPayload,
  ListSkillsPayload,
  RegisterMcpServerPayload,
  ListMcpServersPayload,
  ProbeMcpPolicyPayload,
  RequestMcpToolPayload,
  ProbeMcpSpawnPayload,
  CallMcpToolPayload,
  RefreshMcpToolsPayload,
  SetSkillEnabledPayload,
  SetMcpServerEnabledPayload,
  CapabilityWorkspaceListPayload,
  CapabilityWorkspaceSetActivePayload,
  CapabilityGovernanceListPayload,
  SaveSkillPublishDraftPayload,
  ListSkillPublishDraftsPayload,
  GetSkillPublishDraftPayload,
  SubmitSkillPublishDraftPayload,
  PreviewCapabilityOrganizePayload,
  GetLatestCapabilityOrganizePayload,
} from '@sync-think/protocol';
import { hasOnlyKeys, isRecord } from './shared.js';

const CAPABILITY_TYPES = new Set(['skill', 'mcp']);

function isCapabilityType(value: unknown): value is 'skill' | 'mcp' {
  return typeof value === 'string' && CAPABILITY_TYPES.has(value);
}

function boundedRequiredText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isOptionalIsoDate(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === 'string' &&
      value.length <= 64 &&
      value.trim().length > 0 &&
      !Number.isNaN(new Date(value).getTime()))
  );
}

export function parseImportSkillPayload(value: unknown): ImportSkillPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'skillMd',
      'originType',
      'originRef',
      'derivedFromSkillVersionId',
      'skillId',
    ])
  ) {
    return undefined;
  }
  if (typeof value.skillMd !== 'string' || value.skillMd.trim().length === 0) return undefined;
  if (value.skillMd.length > 512_000) return undefined;
  if (
    value.originType !== undefined &&
    value.originType !== 'local' &&
    value.originType !== 'market' &&
    value.originType !== 'derived'
  ) {
    return undefined;
  }
  for (const key of ['originRef', 'derivedFromSkillVersionId', 'skillId'] as const) {
    const entry = value[key];
    if (
      entry !== undefined &&
      (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 512)
    ) {
      return undefined;
    }
  }
  if (value.originType === 'derived' && value.derivedFromSkillVersionId === undefined) {
    return undefined;
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

export function parseListSkillsPayload(value: unknown): ListSkillsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.limit !== undefined) {
    if (
      typeof value.limit !== 'number' ||
      !Number.isFinite(value.limit) ||
      value.limit < 1 ||
      value.limit > 500
    ) {
      return undefined;
    }
  }
  if (
    value.workspaceId !== undefined &&
    !boundedRequiredText(value.workspaceId, 256)
  ) {
    return undefined;
  }
  let skillVersionIds: string[] | undefined;
  if (value.skillVersionIds !== undefined) {
    if (!Array.isArray(value.skillVersionIds) || value.skillVersionIds.length > 64) return undefined;
    skillVersionIds = [];
    const seen = new Set<string>();
    for (const raw of value.skillVersionIds) {
      if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 256) {
        return undefined;
      }
      const id = raw.trim();
      if (seen.has(id)) continue;
      seen.add(id);
      skillVersionIds.push(id);
    }
  }
  return {
    limit: value.limit as number | undefined,
    ...(typeof value.workspaceId === 'string'
      ? { workspaceId: value.workspaceId.trim() }
      : {}),
    skillVersionIds,
  };
}

export function parseDeleteSkillPayload(value: unknown): import('@sync-think/protocol').DeleteSkillPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.skillVersionId !== 'string' ||
    value.skillVersionId.trim().length === 0 ||
    value.skillVersionId.length > 256
  ) {
    return undefined;
  }
  return { skillVersionId: value.skillVersionId.trim() };
}

export function parseSetSkillEnabledPayload(
  value: unknown,
): SetSkillEnabledPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.skillVersionId !== 'string' ||
    value.skillVersionId.trim().length === 0 ||
    value.skillVersionId.length > 256 ||
    typeof value.enabled !== 'boolean'
  ) {
    return undefined;
  }
  return { skillVersionId: value.skillVersionId.trim(), enabled: value.enabled };
}

export function parseGetSkillPayload(value: unknown): import('@sync-think/protocol').GetSkillPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.skillVersionId !== 'string' ||
    value.skillVersionId.trim().length === 0 ||
    value.skillVersionId.length > 256
  ) {
    return undefined;
  }
  return { skillVersionId: value.skillVersionId.trim() };
}

export function parseRegisterMcpServerPayload(
  value: unknown,
): RegisterMcpServerPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > 128) {
    return undefined;
  }
  if (value.transport !== undefined) {
    if (typeof value.transport !== 'string' || value.transport.length > 64) return undefined;
  }
  if (value.endpoint !== undefined) {
    if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) return undefined;
  }
  if (value.trusted !== undefined && typeof value.trusted !== 'boolean') return undefined;
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  if (value.notes !== undefined) {
    if (typeof value.notes !== 'string' || value.notes.length > 2000) return undefined;
  }
  let tools: RegisterMcpServerPayload['tools'] | undefined;
  if (value.tools !== undefined) {
    if (!Array.isArray(value.tools) || value.tools.length > 64) return undefined;
    const cleaned: NonNullable<RegisterMcpServerPayload['tools']> = [];
    for (const t of value.tools) {
      if (!isRecord(t)) return undefined;
      if (typeof t.name !== 'string' || t.name.trim().length === 0 || t.name.length > 128)
        return undefined;
      if (
        t.description !== undefined &&
        (typeof t.description !== 'string' || t.description.length > 1000)
      ) {
        return undefined;
      }
      if (
        t.inputSchemaJson !== undefined &&
        (typeof t.inputSchemaJson !== 'string' || t.inputSchemaJson.length > 16_000)
      ) {
        return undefined;
      }
      cleaned.push({
        name: t.name.trim(),
        description: typeof t.description === 'string' ? t.description : '',
        inputSchemaJson: typeof t.inputSchemaJson === 'string' ? t.inputSchemaJson : undefined,
      });
    }
    tools = cleaned;
  }
  return {
    name: value.name.trim(),
    transport: typeof value.transport === 'string' ? value.transport : undefined,
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : undefined,
    tools,
    trusted: typeof value.trusted === 'boolean' ? value.trusted : undefined,
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  };
}

export function parseListMcpServersPayload(value: unknown): ListMcpServersPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.limit !== undefined) {
    if (
      typeof value.limit !== 'number' ||
      !Number.isFinite(value.limit) ||
      value.limit < 1 ||
      value.limit > 500
    ) {
      return undefined;
    }
  }
  return {
    limit: value.limit as number | undefined,
  };
}

export function parseSetMcpServerEnabledPayload(
  value: unknown,
): SetMcpServerEnabledPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.mcpServerId !== 'string' ||
    value.mcpServerId.trim().length === 0 ||
    value.mcpServerId.length > 256 ||
    typeof value.enabled !== 'boolean'
  ) {
    return undefined;
  }
  return { mcpServerId: value.mcpServerId.trim(), enabled: value.enabled };
}

export function parseCapabilityWorkspaceListPayload(
  value: unknown,
): CapabilityWorkspaceListPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'capabilityType']) ||
    !boundedRequiredText(value.workspaceId, 256) ||
    (value.capabilityType !== undefined && !isCapabilityType(value.capabilityType))
  ) {
    return undefined;
  }
  return {
    workspaceId: value.workspaceId.trim(),
    ...(value.capabilityType === undefined ? {} : { capabilityType: value.capabilityType }),
  };
}

export function parseCapabilityWorkspaceSetActivePayload(
  value: unknown,
): CapabilityWorkspaceSetActivePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'capabilityType', 'capabilityId', 'active']) ||
    !boundedRequiredText(value.workspaceId, 256) ||
    !isCapabilityType(value.capabilityType) ||
    !boundedRequiredText(value.capabilityId, 256) ||
    typeof value.active !== 'boolean'
  ) {
    return undefined;
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
): CapabilityGovernanceListPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'now']) ||
    !boundedRequiredText(value.workspaceId, 256) ||
    !isOptionalIsoDate(value.now)
  ) {
    return undefined;
  }
  return {
    workspaceId: value.workspaceId.trim(),
    ...(value.now === undefined ? {} : { now: value.now }),
  };
}

export function parseSaveSkillPublishDraftPayload(
  value: unknown,
): SaveSkillPublishDraftPayload | undefined {
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
    (value.id !== undefined && !boundedRequiredText(value.id, 256)) ||
    !boundedRequiredText(value.skillVersionId, 256) ||
    !boundedRequiredText(value.skillId, 256) ||
    !boundedRequiredText(value.displayName, 128) ||
    typeof value.description !== 'string' ||
    value.description.length > 20_000 ||
    typeof value.skillMd !== 'string' ||
    value.skillMd.length === 0 ||
    value.skillMd.length > 512_000 ||
    !boundedRequiredText(value.category, 128) ||
    !boundedRequiredText(value.version, 64) ||
    typeof value.icon !== 'string' ||
    value.icon.length > 256
  ) {
    return undefined;
  }
  let attachments: SaveSkillPublishDraftPayload['attachments'];
  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments) || value.attachments.length > 32) return undefined;
    attachments = [];
    for (const attachment of value.attachments) {
      if (
        !isRecord(attachment) ||
        !hasOnlyKeys(attachment, ['name', 'size']) ||
        !boundedRequiredText(attachment.name, 256) ||
        !Number.isSafeInteger(attachment.size) ||
        (attachment.size as number) < 0 ||
        (attachment.size as number) > 1_000_000_000
      ) {
        return undefined;
      }
      attachments.push({
        name: attachment.name.trim(),
        size: attachment.size as number,
      });
    }
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
): ListSkillPublishDraftsPayload | undefined {
  if (value === undefined || value === null) return {};
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['skillId', 'limit']) ||
    (value.skillId !== undefined && !boundedRequiredText(value.skillId, 256)) ||
    (value.limit !== undefined &&
      (!Number.isSafeInteger(value.limit) ||
        (value.limit as number) < 1 ||
        (value.limit as number) > 500))
  ) {
    return undefined;
  }
  return {
    ...(value.skillId === undefined ? {} : { skillId: value.skillId.trim() }),
    ...(value.limit === undefined ? {} : { limit: value.limit as number }),
  };
}

function parsePublishDraftIdPayload(
  value: unknown,
): GetSkillPublishDraftPayload | SubmitSkillPublishDraftPayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id']) ||
    !boundedRequiredText(value.id, 256)
  ) {
    return undefined;
  }
  return { id: value.id.trim() };
}

export function parseGetSkillPublishDraftPayload(
  value: unknown,
): GetSkillPublishDraftPayload | undefined {
  return parsePublishDraftIdPayload(value);
}

export function parseSubmitSkillPublishDraftPayload(
  value: unknown,
): SubmitSkillPublishDraftPayload | undefined {
  return parsePublishDraftIdPayload(value);
}

export function parsePreviewCapabilityOrganizePayload(
  value: unknown,
): PreviewCapabilityOrganizePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId', 'contextBudgetTokens', 'now']) ||
    !boundedRequiredText(value.workspaceId, 256) ||
    !Number.isSafeInteger(value.contextBudgetTokens) ||
    (value.contextBudgetTokens as number) < 1 ||
    !isOptionalIsoDate(value.now)
  ) {
    return undefined;
  }
  return {
    workspaceId: value.workspaceId.trim(),
    contextBudgetTokens: value.contextBudgetTokens as number,
    ...(value.now === undefined ? {} : { now: value.now }),
  };
}

export function parseGetLatestCapabilityOrganizePayload(
  value: unknown,
): GetLatestCapabilityOrganizePayload | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['workspaceId']) ||
    !boundedRequiredText(value.workspaceId, 256)
  ) {
    return undefined;
  }
  return { workspaceId: value.workspaceId.trim() };
}

export function parseProbeMcpPolicyPayload(value: unknown): ProbeMcpPolicyPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.mcpServerId !== undefined) {
    if (
      typeof value.mcpServerId !== 'string' ||
      value.mcpServerId.trim().length === 0 ||
      value.mcpServerId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  if (value.trusted !== undefined && typeof value.trusted !== 'boolean') return undefined;
  if (value.toolName !== undefined) {
    if (typeof value.toolName !== 'string' || value.toolName.length > 128) return undefined;
  }
  if (value.simulatedOutput !== undefined) {
    if (typeof value.simulatedOutput !== 'string' || value.simulatedOutput.length > 200000)
      return undefined;
  }
  if (value.simulatedElapsedMs !== undefined) {
    if (typeof value.simulatedElapsedMs !== 'number' || !Number.isFinite(value.simulatedElapsedMs))
      return undefined;
  }
  if (value.transport !== undefined) {
    if (typeof value.transport !== 'string' || value.transport.length > 64) return undefined;
  }
  return {
    mcpServerId: typeof value.mcpServerId === 'string' ? value.mcpServerId.trim() : undefined,
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    trusted: typeof value.trusted === 'boolean' ? value.trusted : undefined,
    toolName: typeof value.toolName === 'string' ? value.toolName : undefined,
    simulatedOutput: typeof value.simulatedOutput === 'string' ? value.simulatedOutput : undefined,
    simulatedElapsedMs:
      typeof value.simulatedElapsedMs === 'number' ? value.simulatedElapsedMs : undefined,
    transport: typeof value.transport === 'string' ? value.transport : undefined,
  };
}

export function parseRequestMcpToolPayload(value: unknown): RequestMcpToolPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      'mcpServerId',
      'toolName',
      'argumentsJson',
      'mode',
      'forceSensitive',
      'workspaceId',
      'taskId',
      'runId',
      'stepId',
      'agentVersionId',
      'forceEnqueue',
    ])
  ) {
    return undefined;
  }
  if (
    typeof value.toolName !== 'string' ||
    value.toolName.trim().length === 0 ||
    value.toolName.length > 128
  ) {
    return undefined;
  }
  if (value.mcpServerId !== undefined) {
    if (
      typeof value.mcpServerId !== 'string' ||
      value.mcpServerId.trim().length === 0 ||
      value.mcpServerId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.argumentsJson !== undefined) {
    if (typeof value.argumentsJson !== 'string' || value.argumentsJson.length > 32_000)
      return undefined;
  }
  if (value.mode !== undefined && typeof value.mode !== 'string') return undefined;
  if (value.forceSensitive !== undefined && typeof value.forceSensitive !== 'boolean')
    return undefined;
  if (value.forceEnqueue !== undefined && typeof value.forceEnqueue !== 'boolean') return undefined;
  if (value.workspaceId !== undefined && typeof value.workspaceId !== 'string') return undefined;
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return undefined;
  const orchestrationScope = [value.runId, value.stepId, value.agentVersionId];
  const orchestrationFieldCount = orchestrationScope.filter((entry) => entry !== undefined).length;
  if (
    orchestrationFieldCount !== 0 &&
    (orchestrationFieldCount !== orchestrationScope.length ||
      value.workspaceId === undefined ||
      value.taskId === undefined)
  ) {
    return undefined;
  }
  if (
    orchestrationScope.some(
      (entry) =>
        entry !== undefined &&
        (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 128),
    )
  ) {
    return undefined;
  }
  return {
    toolName: value.toolName.trim(),
    mcpServerId: typeof value.mcpServerId === 'string' ? value.mcpServerId.trim() : undefined,
    argumentsJson: typeof value.argumentsJson === 'string' ? value.argumentsJson : undefined,
    mode: typeof value.mode === 'string' ? value.mode : undefined,
    forceSensitive: typeof value.forceSensitive === 'boolean' ? value.forceSensitive : undefined,
    forceEnqueue: typeof value.forceEnqueue === 'boolean' ? value.forceEnqueue : undefined,
    workspaceId:
      typeof value.workspaceId === 'string'
        ? (value.workspaceId as RequestMcpToolPayload['workspaceId'])
        : undefined,
    taskId:
      typeof value.taskId === 'string'
        ? (value.taskId as RequestMcpToolPayload['taskId'])
        : undefined,
    runId:
      typeof value.runId === 'string'
        ? (value.runId.trim() as RequestMcpToolPayload['runId'])
        : undefined,
    stepId:
      typeof value.stepId === 'string'
        ? (value.stepId.trim() as RequestMcpToolPayload['stepId'])
        : undefined,
    agentVersionId:
      typeof value.agentVersionId === 'string'
        ? (value.agentVersionId.trim() as RequestMcpToolPayload['agentVersionId'])
        : undefined,
  };
}

export function parseProbeMcpSpawnPayload(value: unknown): ProbeMcpSpawnPayload | undefined {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) return undefined;
  if (value.mcpServerId !== undefined) {
    if (
      typeof value.mcpServerId !== 'string' ||
      value.mcpServerId.trim().length === 0 ||
      value.mcpServerId.length > 128
    ) {
      return undefined;
    }
  }
  if (value.endpoint !== undefined) {
    if (typeof value.endpoint !== 'string' || value.endpoint.length > 2048) return undefined;
  }
  if (value.transport !== undefined) {
    if (typeof value.transport !== 'string' || value.transport.length > 64) return undefined;
  }
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  if (value.trusted !== undefined && typeof value.trusted !== 'boolean') return undefined;
  if (value.stdinText !== undefined) {
    if (typeof value.stdinText !== 'string' || value.stdinText.length > 32_000) return undefined;
  }
  return {
    mcpServerId: typeof value.mcpServerId === 'string' ? value.mcpServerId.trim() : undefined,
    endpoint: typeof value.endpoint === 'string' ? value.endpoint : undefined,
    transport: typeof value.transport === 'string' ? value.transport : undefined,
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    trusted: typeof value.trusted === 'boolean' ? value.trusted : undefined,
    stdinText: typeof value.stdinText === 'string' ? value.stdinText : undefined,
  };
}

export function parseCallMcpToolPayload(value: unknown): CallMcpToolPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !hasOnlyKeys(value, [
      'mcpServerId',
      'toolName',
      'argumentsJson',
      'mode',
      'forceSensitive',
      'forceEnqueue',
      'priorApprovalId',
      'executeIfAutoApproved',
      'workspaceId',
      'taskId',
      'runId',
      'stepId',
      'agentVersionId',
      'maxOutputBytes',
      'timeoutMs',
    ])
  ) {
    return undefined;
  }
  if (
    typeof value.mcpServerId !== 'string' ||
    value.mcpServerId.trim().length === 0 ||
    value.mcpServerId.length > 128
  ) {
    return undefined;
  }
  if (
    typeof value.toolName !== 'string' ||
    value.toolName.trim().length === 0 ||
    value.toolName.length > 256
  ) {
    return undefined;
  }
  if (value.argumentsJson !== undefined) {
    if (typeof value.argumentsJson !== 'string' || value.argumentsJson.length > 32_000)
      return undefined;
  }
  if (value.mode !== undefined && typeof value.mode !== 'string') return undefined;
  if (value.forceSensitive !== undefined && typeof value.forceSensitive !== 'boolean')
    return undefined;
  if (value.forceEnqueue !== undefined && typeof value.forceEnqueue !== 'boolean') return undefined;
  if (value.executeIfAutoApproved !== undefined && typeof value.executeIfAutoApproved !== 'boolean')
    return undefined;
  if (value.priorApprovalId !== undefined) {
    if (
      typeof value.priorApprovalId !== 'string' ||
      value.priorApprovalId.trim().length === 0 ||
      value.priorApprovalId.length > 128
    ) {
      return undefined;
    }
  }
  const exactScope = [
    value.workspaceId,
    value.taskId,
    value.runId,
    value.stepId,
    value.agentVersionId,
  ];
  if (
    exactScope.some(
      (entry) => typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 128,
    )
  )
    return undefined;
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  return {
    mcpServerId: value.mcpServerId.trim(),
    toolName: value.toolName.trim(),
    argumentsJson: typeof value.argumentsJson === 'string' ? value.argumentsJson : undefined,
    mode: typeof value.mode === 'string' ? value.mode : undefined,
    forceSensitive: typeof value.forceSensitive === 'boolean' ? value.forceSensitive : undefined,
    forceEnqueue: typeof value.forceEnqueue === 'boolean' ? value.forceEnqueue : undefined,
    executeIfAutoApproved:
      typeof value.executeIfAutoApproved === 'boolean' ? value.executeIfAutoApproved : undefined,
    priorApprovalId:
      typeof value.priorApprovalId === 'string' ? value.priorApprovalId.trim() : undefined,
    workspaceId: (value.workspaceId as string).trim() as CallMcpToolPayload['workspaceId'],
    taskId: (value.taskId as string).trim() as CallMcpToolPayload['taskId'],
    runId: (value.runId as string).trim() as CallMcpToolPayload['runId'],
    stepId: (value.stepId as string).trim() as CallMcpToolPayload['stepId'],
    agentVersionId: (value.agentVersionId as string).trim() as CallMcpToolPayload['agentVersionId'],
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
  };
}

export function parseRefreshMcpToolsPayload(value: unknown): RefreshMcpToolsPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.mcpServerId !== 'string' ||
    value.mcpServerId.trim().length === 0 ||
    value.mcpServerId.length > 128
  ) {
    return undefined;
  }
  if (value.maxOutputBytes !== undefined) {
    if (typeof value.maxOutputBytes !== 'number' || !Number.isFinite(value.maxOutputBytes))
      return undefined;
  }
  if (value.timeoutMs !== undefined) {
    if (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs)) return undefined;
  }
  if (value.maxTools !== undefined) {
    if (
      typeof value.maxTools !== 'number' ||
      !Number.isFinite(value.maxTools) ||
      value.maxTools < 1 ||
      value.maxTools > 200
    ) {
      return undefined;
    }
  }
  return {
    mcpServerId: value.mcpServerId.trim(),
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    maxTools: typeof value.maxTools === 'number' ? value.maxTools : undefined,
  };
}
