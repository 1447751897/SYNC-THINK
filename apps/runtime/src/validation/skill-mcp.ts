// skill-mcp command payload parsers (extracted from command-validation.ts).
import type { ImportSkillPayload, ListSkillsPayload, RegisterMcpServerPayload, ListMcpServersPayload, ProbeMcpPolicyPayload, RequestMcpToolPayload, ProbeMcpSpawnPayload, CallMcpToolPayload, RefreshMcpToolsPayload } from '@sync-think/protocol';
import { hasOnlyKeys, isRecord } from './shared.js';

export function parseImportSkillPayload(value: unknown): ImportSkillPayload | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.skillMd !== 'string' || value.skillMd.trim().length === 0) return undefined;
  if (value.skillMd.length > 512_000) return undefined;
  return { skillMd: value.skillMd };
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
  return {
    limit: value.limit as number | undefined,
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
