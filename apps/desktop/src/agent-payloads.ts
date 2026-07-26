import type {
  GetAgentPayload,
  UpdateAgentBindingPayload,
  ImportSkillPayload,
  ListSkillsPayload,
  DeleteSkillPayload,
  GetSkillPayload,
} from '@sync-think/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseGetAgentPayload(value: unknown): GetAgentPayload {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error('Invalid get-agent payload');
  if (value.agentId !== undefined && typeof value.agentId !== 'string') {
    throw new Error('Invalid get-agent payload');
  }
  return {
    agentId: value.agentId as GetAgentPayload['agentId'],
  };
}

export function parseUpdateAgentBindingPayload(value: unknown): UpdateAgentBindingPayload {
  if (!isRecord(value)) throw new Error('Invalid update-agent-binding payload');
  if (
    typeof value.defaultModelId !== 'string' ||
    value.defaultModelId.trim().length === 0 ||
    !Array.isArray(value.fallbackModelIds)
  ) {
    throw new Error('Invalid update-agent-binding payload');
  }
  for (const id of value.fallbackModelIds) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Invalid update-agent-binding payload');
    }
  }
  if (value.pauseOnFailure !== undefined && typeof value.pauseOnFailure !== 'boolean') {
    throw new Error('Invalid update-agent-binding payload');
  }
  let skillVersionIds: string[] | undefined;
  if (value.skillVersionIds !== undefined) {
    if (!Array.isArray(value.skillVersionIds)) throw new Error('Invalid update-agent-binding payload');
    skillVersionIds = [];
    for (const id of value.skillVersionIds) {
      if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error('Invalid update-agent-binding payload');
      }
      skillVersionIds.push(id.trim());
    }
  }
  let mcpServerIds: string[] | undefined;
  if (value.mcpServerIds !== undefined) {
    if (!Array.isArray(value.mcpServerIds)) throw new Error('Invalid update-agent-binding payload');
    mcpServerIds = [];
    for (const id of value.mcpServerIds) {
      if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error('Invalid update-agent-binding payload');
      }
      mcpServerIds.push(id.trim());
    }
  }
  return {
    agentId: value.agentId as UpdateAgentBindingPayload['agentId'],
    defaultModelId: value.defaultModelId.trim() as UpdateAgentBindingPayload['defaultModelId'],
    fallbackModelIds: (value.fallbackModelIds as string[]).map(
      (id) => id.trim() as UpdateAgentBindingPayload['fallbackModelIds'][number],
    ),
    pauseOnFailure: value.pauseOnFailure as boolean | undefined,
    defaultCredentialGroupId:
      typeof value.defaultCredentialGroupId === 'string'
        ? (value.defaultCredentialGroupId.trim() as UpdateAgentBindingPayload['defaultCredentialGroupId'])
        : (value.defaultCredentialGroupId as UpdateAgentBindingPayload['defaultCredentialGroupId']),
    pinnedCredentialRefId:
      value.pinnedCredentialRefId === null
        ? null
        : typeof value.pinnedCredentialRefId === 'string'
          ? (value.pinnedCredentialRefId.trim() as UpdateAgentBindingPayload['pinnedCredentialRefId'])
          : (value.pinnedCredentialRefId as UpdateAgentBindingPayload['pinnedCredentialRefId']),
    skillVersionIds,
    mcpServerIds,
  };
}

export function parseImportSkillPayload(value: unknown): ImportSkillPayload {
  if (!isRecord(value)) throw new Error('Invalid import-skill payload');
  if (typeof value.skillMd !== 'string' || value.skillMd.trim().length === 0) {
    throw new Error('Invalid import-skill payload');
  }
  if (value.skillMd.length > 512000) throw new Error('Invalid import-skill payload');
  return { skillMd: value.skillMd };
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
  return { limit: value.limit as number | undefined };
}

export function parseDeleteSkillPayload(value: unknown): DeleteSkillPayload {
  if (
    !isRecord(value) ||
    typeof value.skillVersionId !== 'string' ||
    value.skillVersionId.trim().length === 0 ||
    value.skillVersionId.length > 256
  ) {
    throw new Error('Invalid delete-skill payload');
  }
  return { skillVersionId: value.skillVersionId.trim() };
}

export function parseGetSkillPayload(value: unknown): GetSkillPayload {
  if (
    !isRecord(value) ||
    typeof value.skillVersionId !== 'string' ||
    value.skillVersionId.trim().length === 0 ||
    value.skillVersionId.length > 256
  ) {
    throw new Error('Invalid get-skill payload');
  }
  return { skillVersionId: value.skillVersionId.trim() };
}

export function parseRegisterMcpServerPayload(value: unknown): import('@sync-think/protocol').RegisterMcpServerPayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid register-mcp payload');
  const rec = value as Record<string, unknown>;
  if (typeof rec.name !== 'string' || rec.name.trim().length === 0) {
    throw new Error('Invalid register-mcp payload');
  }
  let tools: import('@sync-think/protocol').McpToolSchemaSummary[] | undefined;
  if (rec.tools !== undefined) {
    if (!Array.isArray(rec.tools)) throw new Error('Invalid register-mcp payload');
    tools = [];
    for (const t of rec.tools) {
      if (!t || typeof t !== 'object') throw new Error('Invalid register-mcp payload');
      const tool = t as Record<string, unknown>;
      if (typeof tool.name !== 'string' || !tool.name.trim()) throw new Error('Invalid register-mcp payload');
      tools.push({
        name: tool.name.trim(),
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchemaJson: typeof tool.inputSchemaJson === 'string' ? tool.inputSchemaJson : undefined,
      });
    }
  }
  return {
    name: rec.name.trim(),
    transport: typeof rec.transport === 'string' ? rec.transport : undefined,
    endpoint: typeof rec.endpoint === 'string' ? rec.endpoint : undefined,
    tools,
    trusted: typeof rec.trusted === 'boolean' ? rec.trusted : undefined,
    maxOutputBytes: typeof rec.maxOutputBytes === 'number' ? rec.maxOutputBytes : undefined,
    timeoutMs: typeof rec.timeoutMs === 'number' ? rec.timeoutMs : undefined,
    notes: typeof rec.notes === 'string' ? rec.notes : undefined,
  };
}

export function parseListMcpServersPayload(value: unknown): import('@sync-think/protocol').ListMcpServersPayload {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new Error('Invalid list-mcp payload');
  const rec = value as Record<string, unknown>;
  if (rec.limit !== undefined && (typeof rec.limit !== 'number' || !Number.isFinite(rec.limit))) {
    throw new Error('Invalid list-mcp payload');
  }
  return { limit: rec.limit as number | undefined };
}

export function parseProbeMcpPolicyPayload(value: unknown): import('@sync-think/protocol').ProbeMcpPolicyPayload {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new Error('Invalid mcp-policy-probe payload');
  const rec = value as Record<string, unknown>;
  if (rec.mcpServerId !== undefined && (typeof rec.mcpServerId !== 'string' || !rec.mcpServerId.trim())) {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  if (rec.maxOutputBytes !== undefined && (typeof rec.maxOutputBytes !== 'number' || !Number.isFinite(rec.maxOutputBytes))) {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  if (rec.timeoutMs !== undefined && (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs))) {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  if (rec.trusted !== undefined && typeof rec.trusted !== 'boolean') {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  if (rec.toolName !== undefined && typeof rec.toolName !== 'string') {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  if (rec.simulatedOutput !== undefined && typeof rec.simulatedOutput !== 'string') {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  if (rec.simulatedElapsedMs !== undefined && (typeof rec.simulatedElapsedMs !== 'number' || !Number.isFinite(rec.simulatedElapsedMs))) {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  if (rec.transport !== undefined && typeof rec.transport !== 'string') {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  return {
    mcpServerId: typeof rec.mcpServerId === 'string' ? rec.mcpServerId.trim() : undefined,
    maxOutputBytes: typeof rec.maxOutputBytes === 'number' ? rec.maxOutputBytes : undefined,
    timeoutMs: typeof rec.timeoutMs === 'number' ? rec.timeoutMs : undefined,
    trusted: typeof rec.trusted === 'boolean' ? rec.trusted : undefined,
    toolName: typeof rec.toolName === 'string' ? rec.toolName : undefined,
    simulatedOutput: typeof rec.simulatedOutput === 'string' ? rec.simulatedOutput : undefined,
    simulatedElapsedMs: typeof rec.simulatedElapsedMs === 'number' ? rec.simulatedElapsedMs : undefined,
    transport: typeof rec.transport === 'string' ? rec.transport : undefined,
  };
}

export function parseRequestMcpToolPayload(value: unknown): import('@sync-think/protocol').RequestMcpToolPayload {
  if (value === undefined || value === null || typeof value !== 'object') {
    throw new Error('Invalid mcp-tool-request payload');
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.toolName !== 'string' || !rec.toolName.trim()) {
    throw new Error('Invalid mcp-tool-request payload: toolName required');
  }
  if (rec.mcpServerId !== undefined && (typeof rec.mcpServerId !== 'string' || !rec.mcpServerId.trim())) {
    throw new Error('Invalid mcp-tool-request payload');
  }
  if (rec.argumentsJson !== undefined && typeof rec.argumentsJson !== 'string') {
    throw new Error('Invalid mcp-tool-request payload');
  }
  if (rec.mode !== undefined && typeof rec.mode !== 'string') {
    throw new Error('Invalid mcp-tool-request payload');
  }
  if (rec.forceSensitive !== undefined && typeof rec.forceSensitive !== 'boolean') {
    throw new Error('Invalid mcp-tool-request payload');
  }
  if (rec.forceEnqueue !== undefined && typeof rec.forceEnqueue !== 'boolean') {
    throw new Error('Invalid mcp-tool-request payload');
  }
  return {
    toolName: rec.toolName.trim(),
    mcpServerId: typeof rec.mcpServerId === 'string' ? rec.mcpServerId.trim() : undefined,
    argumentsJson: typeof rec.argumentsJson === 'string' ? rec.argumentsJson : undefined,
    mode: typeof rec.mode === 'string' ? rec.mode : undefined,
    forceSensitive: typeof rec.forceSensitive === 'boolean' ? rec.forceSensitive : undefined,
    forceEnqueue: typeof rec.forceEnqueue === 'boolean' ? rec.forceEnqueue : undefined,
    workspaceId: typeof rec.workspaceId === 'string' ? (rec.workspaceId as never) : undefined,
    taskId: typeof rec.taskId === 'string' ? (rec.taskId as never) : undefined,
  };
}

export function parseProbeMcpSpawnPayload(value: unknown): import('@sync-think/protocol').ProbeMcpSpawnPayload {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new Error('Invalid mcp-spawn-probe payload');
  const rec = value as Record<string, unknown>;
  if (rec.mcpServerId !== undefined && (typeof rec.mcpServerId !== 'string' || !rec.mcpServerId.trim())) {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (rec.endpoint !== undefined && typeof rec.endpoint !== 'string') {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (rec.transport !== undefined && typeof rec.transport !== 'string') {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (rec.maxOutputBytes !== undefined && (typeof rec.maxOutputBytes !== 'number' || !Number.isFinite(rec.maxOutputBytes))) {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (rec.timeoutMs !== undefined && (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs))) {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (rec.trusted !== undefined && typeof rec.trusted !== 'boolean') {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (rec.stdinText !== undefined && typeof rec.stdinText !== 'string') {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  return {
    mcpServerId: typeof rec.mcpServerId === 'string' ? rec.mcpServerId.trim() : undefined,
    endpoint: typeof rec.endpoint === 'string' ? rec.endpoint : undefined,
    transport: typeof rec.transport === 'string' ? rec.transport : undefined,
    maxOutputBytes: typeof rec.maxOutputBytes === 'number' ? rec.maxOutputBytes : undefined,
    timeoutMs: typeof rec.timeoutMs === 'number' ? rec.timeoutMs : undefined,
    trusted: typeof rec.trusted === 'boolean' ? rec.trusted : undefined,
    stdinText: typeof rec.stdinText === 'string' ? rec.stdinText : undefined,
  };
}

export function parseCallMcpToolPayload(value: unknown): import('@sync-think/protocol').CallMcpToolPayload {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid mcp-tool-call payload');
  const rec = value as Record<string, unknown>;
  if (typeof rec.mcpServerId !== 'string' || !rec.mcpServerId.trim()) {
    throw new Error('Invalid mcp-tool-call payload: mcpServerId required');
  }
  if (typeof rec.toolName !== 'string' || !rec.toolName.trim()) {
    throw new Error('Invalid mcp-tool-call payload: toolName required');
  }
  if (rec.argumentsJson !== undefined && typeof rec.argumentsJson !== 'string') {
    throw new Error('Invalid mcp-tool-call payload');
  }
  if (rec.mode !== undefined && typeof rec.mode !== 'string') {
    throw new Error('Invalid mcp-tool-call payload');
  }
  if (rec.forceSensitive !== undefined && typeof rec.forceSensitive !== 'boolean') {
    throw new Error('Invalid mcp-tool-call payload');
  }
  if (rec.forceEnqueue !== undefined && typeof rec.forceEnqueue !== 'boolean') {
    throw new Error('Invalid mcp-tool-call payload');
  }
  if (rec.executeIfAutoApproved !== undefined && typeof rec.executeIfAutoApproved !== 'boolean') {
    throw new Error('Invalid mcp-tool-call payload');
  }
  if (rec.priorApprovalId !== undefined && typeof rec.priorApprovalId !== 'string') {
    throw new Error('Invalid mcp-tool-call payload');
  }
  if (rec.maxOutputBytes !== undefined && (typeof rec.maxOutputBytes !== 'number' || !Number.isFinite(rec.maxOutputBytes))) {
    throw new Error('Invalid mcp-tool-call payload');
  }
  if (rec.timeoutMs !== undefined && (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs))) {
    throw new Error('Invalid mcp-tool-call payload');
  }
  for (const field of ['workspaceId', 'taskId', 'runId', 'stepId', 'agentVersionId'] as const) {
    if (typeof rec[field] !== 'string' || !rec[field].trim()) {
      throw new Error(`Invalid mcp-tool-call payload: ${field} required`);
    }
  }
  return {
    mcpServerId: rec.mcpServerId.trim(),
    toolName: rec.toolName.trim(),
    argumentsJson: typeof rec.argumentsJson === 'string' ? rec.argumentsJson : undefined,
    mode: typeof rec.mode === 'string' ? rec.mode : undefined,
    forceSensitive: typeof rec.forceSensitive === 'boolean' ? rec.forceSensitive : undefined,
    forceEnqueue: typeof rec.forceEnqueue === 'boolean' ? rec.forceEnqueue : undefined,
    executeIfAutoApproved:
      typeof rec.executeIfAutoApproved === 'boolean' ? rec.executeIfAutoApproved : undefined,
    priorApprovalId: typeof rec.priorApprovalId === 'string' ? rec.priorApprovalId.trim() : undefined,
    workspaceId: rec.workspaceId as never,
    taskId: rec.taskId as never,
    runId: rec.runId as never,
    stepId: rec.stepId as never,
    agentVersionId: rec.agentVersionId as never,
    maxOutputBytes: typeof rec.maxOutputBytes === 'number' ? rec.maxOutputBytes : undefined,
    timeoutMs: typeof rec.timeoutMs === 'number' ? rec.timeoutMs : undefined,
  };
}

export function parseRefreshMcpToolsPayload(
  value: unknown,
): import('@sync-think/protocol').RefreshMcpToolsPayload {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid mcp-tools-refresh payload');
  const rec = value as Record<string, unknown>;
  if (typeof rec.mcpServerId !== 'string' || !rec.mcpServerId.trim()) {
    throw new Error('Invalid mcp-tools-refresh payload: mcpServerId required');
  }
  if (rec.maxOutputBytes !== undefined && (typeof rec.maxOutputBytes !== 'number' || !Number.isFinite(rec.maxOutputBytes))) {
    throw new Error('Invalid mcp-tools-refresh payload');
  }
  if (rec.timeoutMs !== undefined && (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs))) {
    throw new Error('Invalid mcp-tools-refresh payload');
  }
  if (
    rec.maxTools !== undefined &&
    (typeof rec.maxTools !== 'number' ||
      !Number.isFinite(rec.maxTools) ||
      rec.maxTools < 1 ||
      rec.maxTools > 200)
  ) {
    throw new Error('Invalid mcp-tools-refresh payload');
  }
  return {
    mcpServerId: rec.mcpServerId.trim(),
    maxOutputBytes: typeof rec.maxOutputBytes === 'number' ? rec.maxOutputBytes : undefined,
    timeoutMs: typeof rec.timeoutMs === 'number' ? rec.timeoutMs : undefined,
    maxTools: typeof rec.maxTools === 'number' ? rec.maxTools : undefined,
  };
}
