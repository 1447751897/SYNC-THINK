import type {
  CallMcpToolPayload,
  ProbeMcpPolicyPayload,
  ProbeMcpSpawnPayload,
  RefreshMcpToolsPayload,
  RequestMcpToolPayload,
} from '@sync-think/protocol';

export function parseProbeMcpPolicyPayload(value: unknown): ProbeMcpPolicyPayload {
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

export function parseRequestMcpToolPayload(value: unknown): RequestMcpToolPayload {
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

export function parseProbeMcpSpawnPayload(value: unknown): ProbeMcpSpawnPayload {
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

export function parseCallMcpToolPayload(value: unknown): CallMcpToolPayload {
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

export function parseRefreshMcpToolsPayload(value: unknown): RefreshMcpToolsPayload {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid mcp-tools-refresh payload');
  }
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
