import type {
  GetAgentPayload,
  UpdateAgentBindingPayload,
  ImportSkillPayload,
  ImportRemoteSkillPayload,
  ListSkillsPayload,
  DeleteSkillPayload,
  GetSkillPayload,
  SetSkillEnabledPayload,
  SetMcpServerEnabledPayload,
  DeleteMcpServerPayload,
  RegisterRemoteMcpPayload,
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
    if (!Array.isArray(value.skillVersionIds))
      throw new Error('Invalid update-agent-binding payload');
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

export function parseSetSkillEnabledPayload(value: unknown): SetSkillEnabledPayload {
  if (
    !isRecord(value) ||
    typeof value.skillVersionId !== 'string' ||
    value.skillVersionId.trim().length === 0 ||
    typeof value.enabled !== 'boolean'
  ) {
    throw new Error('Invalid set-skill-enabled payload');
  }
  return { skillVersionId: value.skillVersionId.trim(), enabled: value.enabled };
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

export function parseRegisterMcpServerPayload(
  value: unknown,
): import('@sync-think/protocol').RegisterMcpServerPayload {
  if (!value || typeof value !== 'object') throw new Error('Invalid register-mcp payload');
  const rec = value as Record<string, unknown>;
  if (typeof rec.name !== 'string' || rec.name.trim().length === 0) {
    throw new Error('Invalid register-mcp payload');
  }
  for (const key of ['key', 'apiKey'] as const) {
    if (rec[key] !== undefined && (typeof rec[key] !== 'string' || rec[key].length > 8192)) {
      throw new Error('Invalid register-mcp payload');
    }
  }
  if (
    typeof rec.key === 'string' &&
    typeof rec.apiKey === 'string' &&
    rec.key.trim() &&
    rec.apiKey.trim() &&
    rec.key.trim() !== rec.apiKey.trim()
  ) {
    throw new Error('Invalid register-mcp payload');
  }
  if (
    rec.authScheme !== undefined &&
    (typeof rec.authScheme !== 'string' || !rec.authScheme.trim() || rec.authScheme.length > 64)
  ) {
    throw new Error('Invalid register-mcp payload');
  }
  let tools: import('@sync-think/protocol').McpToolSchemaSummary[] | undefined;
  if (rec.tools !== undefined) {
    if (!Array.isArray(rec.tools)) throw new Error('Invalid register-mcp payload');
    tools = [];
    for (const t of rec.tools) {
      if (!t || typeof t !== 'object') throw new Error('Invalid register-mcp payload');
      const tool = t as Record<string, unknown>;
      if (typeof tool.name !== 'string' || !tool.name.trim())
        throw new Error('Invalid register-mcp payload');
      tools.push({
        name: tool.name.trim(),
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchemaJson:
          typeof tool.inputSchemaJson === 'string' ? tool.inputSchemaJson : undefined,
      });
    }
  }
  return {
    name: rec.name.trim(),
    transport: typeof rec.transport === 'string' ? rec.transport : undefined,
    endpoint: typeof rec.endpoint === 'string' ? rec.endpoint : undefined,
    key: typeof rec.key === 'string' && rec.key.trim() ? rec.key.trim() : undefined,
    apiKey: typeof rec.apiKey === 'string' && rec.apiKey.trim() ? rec.apiKey.trim() : undefined,
    authScheme: typeof rec.authScheme === 'string' ? rec.authScheme.trim() : undefined,
    tools,
    trusted: typeof rec.trusted === 'boolean' ? rec.trusted : undefined,
    maxOutputBytes: typeof rec.maxOutputBytes === 'number' ? rec.maxOutputBytes : undefined,
    timeoutMs: typeof rec.timeoutMs === 'number' ? rec.timeoutMs : undefined,
    notes: typeof rec.notes === 'string' ? rec.notes : undefined,
  };
}

export function parseRegisterRemoteMcpPayload(value: unknown): RegisterRemoteMcpPayload {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Invalid register-remote-mcp payload');
  }
  if (typeof value.endpoint !== 'string' || !value.endpoint.trim()) {
    throw new Error('Invalid register-remote-mcp payload: endpoint required');
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint.trim());
  } catch {
    throw new Error('Invalid register-remote-mcp payload: endpoint URL required');
  }
  if (
    (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error('Invalid register-remote-mcp payload: only http(s) URLs are supported');
  }
  for (const key of ['key', 'apiKey'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 8192)) {
      throw new Error('Invalid register-remote-mcp payload');
    }
  }
  if (
    value.authScheme !== undefined &&
    (typeof value.authScheme !== 'string' ||
      !value.authScheme.trim() ||
      value.authScheme.length > 64)
  ) {
    throw new Error('Invalid register-remote-mcp payload');
  }
  if (value.discoverTools !== undefined && typeof value.discoverTools !== 'boolean') {
    throw new Error('Invalid register-remote-mcp payload');
  }
  const key =
    typeof value.key === 'string' && value.key.trim()
      ? value.key.trim()
      : typeof value.apiKey === 'string' && value.apiKey.trim()
        ? value.apiKey.trim()
        : undefined;
  if (
    value.key !== undefined &&
    value.apiKey !== undefined &&
    typeof value.key === 'string' &&
    typeof value.apiKey === 'string' &&
    value.key.trim() &&
    value.apiKey.trim() &&
    value.key.trim() !== value.apiKey.trim()
  ) {
    throw new Error('Invalid register-remote-mcp payload');
  }
  return {
    name: value.name.trim(),
    endpoint: endpoint.toString(),
    ...(key ? { key } : {}),
    ...(typeof value.apiKey === 'string' && value.apiKey.trim()
      ? { apiKey: value.apiKey.trim() }
      : {}),
    authScheme: typeof value.authScheme === 'string' ? value.authScheme.trim() : undefined,
    discoverTools: value.discoverTools as boolean | undefined,
    tools: Array.isArray(value.tools)
      ? (value.tools as RegisterRemoteMcpPayload['tools'])
      : undefined,
    trusted: typeof value.trusted === 'boolean' ? value.trusted : undefined,
    maxOutputBytes: typeof value.maxOutputBytes === 'number' ? value.maxOutputBytes : undefined,
    timeoutMs: typeof value.timeoutMs === 'number' ? value.timeoutMs : undefined,
    notes: typeof value.notes === 'string' ? value.notes : undefined,
  };
}

export function parseListMcpServersPayload(
  value: unknown,
): import('@sync-think/protocol').ListMcpServersPayload {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new Error('Invalid list-mcp payload');
  const rec = value as Record<string, unknown>;
  if (rec.limit !== undefined && (typeof rec.limit !== 'number' || !Number.isFinite(rec.limit))) {
    throw new Error('Invalid list-mcp payload');
  }
  return { limit: rec.limit as number | undefined };
}

export function parseSetMcpServerEnabledPayload(value: unknown): SetMcpServerEnabledPayload {
  if (
    !isRecord(value) ||
    typeof value.mcpServerId !== 'string' ||
    value.mcpServerId.trim().length === 0 ||
    typeof value.enabled !== 'boolean'
  ) {
    throw new Error('Invalid set-mcp-enabled payload');
  }
  return { mcpServerId: value.mcpServerId.trim(), enabled: value.enabled };
}

export function parseDeleteMcpServerPayload(value: unknown): DeleteMcpServerPayload {
  if (
    !isRecord(value) ||
    typeof value.mcpServerId !== 'string' ||
    value.mcpServerId.trim().length === 0
  ) {
    throw new Error('Invalid delete-mcp-server payload');
  }
  return { mcpServerId: value.mcpServerId.trim() };
}

export function parseProbeMcpPolicyPayload(
  value: unknown,
): import('@sync-think/protocol').ProbeMcpPolicyPayload {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new Error('Invalid mcp-policy-probe payload');
  const rec = value as Record<string, unknown>;
  if (
    rec.mcpServerId !== undefined &&
    (typeof rec.mcpServerId !== 'string' || !rec.mcpServerId.trim())
  ) {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  if (
    rec.maxOutputBytes !== undefined &&
    (typeof rec.maxOutputBytes !== 'number' || !Number.isFinite(rec.maxOutputBytes))
  ) {
    throw new Error('Invalid mcp-policy-probe payload');
  }
  if (
    rec.timeoutMs !== undefined &&
    (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs))
  ) {
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
  if (
    rec.simulatedElapsedMs !== undefined &&
    (typeof rec.simulatedElapsedMs !== 'number' || !Number.isFinite(rec.simulatedElapsedMs))
  ) {
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
    simulatedElapsedMs:
      typeof rec.simulatedElapsedMs === 'number' ? rec.simulatedElapsedMs : undefined,
    transport: typeof rec.transport === 'string' ? rec.transport : undefined,
  };
}

export function parseRequestMcpToolPayload(
  value: unknown,
): import('@sync-think/protocol').RequestMcpToolPayload {
  if (value === undefined || value === null || typeof value !== 'object') {
    throw new Error('Invalid mcp-tool-request payload');
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.toolName !== 'string' || !rec.toolName.trim()) {
    throw new Error('Invalid mcp-tool-request payload: toolName required');
  }
  if (
    rec.mcpServerId !== undefined &&
    (typeof rec.mcpServerId !== 'string' || !rec.mcpServerId.trim())
  ) {
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

export function parseProbeMcpSpawnPayload(
  value: unknown,
): import('@sync-think/protocol').ProbeMcpSpawnPayload {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') throw new Error('Invalid mcp-spawn-probe payload');
  const rec = value as Record<string, unknown>;
  if (
    rec.mcpServerId !== undefined &&
    (typeof rec.mcpServerId !== 'string' || !rec.mcpServerId.trim())
  ) {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (rec.endpoint !== undefined && typeof rec.endpoint !== 'string') {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (rec.transport !== undefined && typeof rec.transport !== 'string') {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (
    rec.maxOutputBytes !== undefined &&
    (typeof rec.maxOutputBytes !== 'number' || !Number.isFinite(rec.maxOutputBytes))
  ) {
    throw new Error('Invalid mcp-spawn-probe payload');
  }
  if (
    rec.timeoutMs !== undefined &&
    (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs))
  ) {
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

export function parseCallMcpToolPayload(
  value: unknown,
): import('@sync-think/protocol').CallMcpToolPayload {
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
  if (
    rec.maxOutputBytes !== undefined &&
    (typeof rec.maxOutputBytes !== 'number' || !Number.isFinite(rec.maxOutputBytes))
  ) {
    throw new Error('Invalid mcp-tool-call payload');
  }
  if (
    rec.timeoutMs !== undefined &&
    (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs))
  ) {
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
    priorApprovalId:
      typeof rec.priorApprovalId === 'string' ? rec.priorApprovalId.trim() : undefined,
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
  if (typeof value !== 'object' || value === null)
    throw new Error('Invalid mcp-tools-refresh payload');
  const rec = value as Record<string, unknown>;
  if (typeof rec.mcpServerId !== 'string' || !rec.mcpServerId.trim()) {
    throw new Error('Invalid mcp-tools-refresh payload: mcpServerId required');
  }
  if (
    rec.maxOutputBytes !== undefined &&
    (typeof rec.maxOutputBytes !== 'number' || !Number.isFinite(rec.maxOutputBytes))
  ) {
    throw new Error('Invalid mcp-tools-refresh payload');
  }
  if (
    rec.timeoutMs !== undefined &&
    (typeof rec.timeoutMs !== 'number' || !Number.isFinite(rec.timeoutMs))
  ) {
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

function parseBotChannelPlatform(
  value: unknown,
): import('@sync-think/protocol').BotChannelPlatform {
  if (
    value !== 'telegram' &&
    value !== 'feishu' &&
    value !== 'wecom' &&
    value !== 'wechat' &&
    value !== 'discord' &&
    value !== 'dingtalk' &&
    value !== 'qq'
  ) {
    throw new Error('Invalid bot channel platform');
  }
  return value;
}

export function parseGetBotChannelConfigPayload(
  value: unknown,
): import('@sync-think/protocol').GetBotChannelConfigPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-get payload');
  }
  return { platform: parseBotChannelPlatform((value as Record<string, unknown>).platform) };
}

export function parseSaveBotChannelConfigPayload(
  value: unknown,
): import('@sync-think/protocol').SaveBotChannelConfigPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-save payload');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean') throw new Error('Invalid bot-channel-save payload');
  if (record.testConnection !== undefined && typeof record.testConnection !== 'boolean') {
    throw new Error('Invalid bot-channel-save payload');
  }
  const platform = parseBotChannelPlatform(record.platform);
  return parseBotChannelFields(record, platform, {
    platform,
    enabled: record.enabled,
    ...(typeof record.testConnection === 'boolean'
      ? { testConnection: record.testConnection }
      : {}),
  }) as unknown as import('@sync-think/protocol').SaveBotChannelConfigPayload;
}

export function parseTestBotChannelPayload(
  value: unknown,
): import('@sync-think/protocol').TestBotChannelPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-test payload');
  }
  const record = value as Record<string, unknown>;
  const platform = parseBotChannelPlatform(record.platform);
  return parseBotChannelFields(record, platform, {
    platform,
  }) as unknown as import('@sync-think/protocol').TestBotChannelPayload;
}

export function parseRequestWechatBotQrPayload(
  value: unknown,
): import('@sync-think/protocol').RequestWechatBotQrPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-wechat-qr-request payload');
  }
  const record = value as Record<string, unknown>;
  const baseUrl = optionalBotText(record.baseUrl, 2_048, 'baseUrl');
  return baseUrl === undefined ? {} : { baseUrl };
}

export function parseCheckWechatBotQrPayload(
  value: unknown,
): import('@sync-think/protocol').CheckWechatBotQrPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid bot-channel-wechat-qr-check payload');
  }
  const record = value as Record<string, unknown>;
  const qrcode = optionalBotText(record.qrcode, 8_192, 'qrcode');
  const baseUrl = optionalBotText(record.baseUrl, 2_048, 'baseUrl');
  if (!qrcode) throw new Error('Invalid bot-channel-wechat-qr-check payload');
  return { qrcode, ...(baseUrl === undefined ? {} : { baseUrl }) };
}

function parseBotChannelFields(
  record: Record<string, unknown>,
  platform: import('@sync-think/protocol').BotChannelPlatform,
  common: Record<string, unknown>,
): Record<string, unknown> {
  if (platform === 'telegram' || platform === 'discord') {
    return {
      ...common,
      ...optionalSecretField(record, 'token'),
      ...optionalPublicField(record, 'proxyUrl', 2_048),
    };
  }
  if (platform === 'feishu') {
    if (record.domain !== undefined && record.domain !== 'feishu' && record.domain !== 'lark') {
      throw new Error('Invalid bot channel domain');
    }
    if (
      record.renderMode !== undefined &&
      record.renderMode !== 'card' &&
      record.renderMode !== 'text'
    ) {
      throw new Error('Invalid bot channel render mode');
    }
    return {
      ...common,
      ...optionalPublicField(record, 'appId', 512),
      ...optionalSecretField(record, 'appSecret'),
      ...(record.domain ? { domain: record.domain } : {}),
      ...(record.renderMode ? { renderMode: record.renderMode } : {}),
    };
  }
  if (platform === 'wecom') {
    return {
      ...common,
      ...optionalPublicField(record, 'botId', 512),
      ...optionalSecretField(record, 'secret'),
    };
  }
  if (platform === 'dingtalk') {
    return {
      ...common,
      ...optionalPublicField(record, 'clientId', 512),
      ...optionalSecretField(record, 'clientSecret'),
    };
  }
  if (platform === 'qq') {
    return {
      ...common,
      ...optionalPublicField(record, 'appId', 512),
      ...optionalSecretField(record, 'appSecret'),
    };
  }
  return {
    ...common,
    ...optionalSecretField(record, 'botToken'),
    ...optionalPublicField(record, 'baseUrl', 2_048),
  };
}

function optionalBotText(
  value: unknown,
  max: number,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`Invalid bot channel ${field}`);
  }
  return value.trim();
}

function optionalSecretField(
  record: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = optionalBotText(record[field], 8_192, field);
  return value ? { [field]: value } : {};
}

function optionalPublicField(
  record: Record<string, unknown>,
  field: string,
  max: number,
): Record<string, string> {
  const value = optionalBotText(record[field], max, field);
  return value === undefined ? {} : { [field]: value };
}
