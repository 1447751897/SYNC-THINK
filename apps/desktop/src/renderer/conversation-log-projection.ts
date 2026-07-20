import type { Event } from '@sync-think/shared';
import { mergeEventHistory } from '../event-history.js';

export type ConversationLogState =
  'running' | 'completed' | 'failed' | 'paused' | 'cancelled' | 'waiting' | 'unknown';

export interface ConversationLogAgentIdentity {
  agentVersionId: string;
  name: string;
  role?: string;
  responsibility?: string;
  color?: string;
  avatarUrl?: string;
}

export interface ConversationLogDetail {
  label: string;
  value: string;
}

export interface ConversationLogEvent {
  id: string;
  type: string;
  summary: string;
  occurredAt: string;
  details: ConversationLogDetail[];
}

export interface ConversationLogStage {
  id: string;
  title: string;
  agentVersionId?: string;
  agentName: string;
  role?: string;
  responsibility?: string;
  color?: string;
  avatarUrl?: string;
  modelLabel?: string;
  state: ConversationLogState;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  events: ConversationLogEvent[];
}

export interface ConversationLogTurn {
  id: string;
  index: number;
  userMessage: string;
  state: Exclude<ConversationLogState, 'waiting'>;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  runIds: string[];
  modelCallCount: number;
  toolCallCount: number;
  tokensIn?: number;
  tokensOut?: number;
  artifactCount: number;
  errorCount: number;
  finalResponse?: string;
  stages: ConversationLogStage[];
}

interface TurnDraft extends ConversationLogTurn {
  userOccurredAt: string;
  runStarted: boolean;
  runTerminal: boolean;
  stages: ConversationLogStage[];
  stageByKey: Map<string, ConversationLogStage>;
  runIdsSet: Set<string>;
  modelCallEventIds: Set<string>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface ToolLogInfo {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
}

function scrubLogText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}\b/gi, '[REDACTED]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    );
}

function parseRecordJson(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function extractToolLogInfo(event: Event): ToolLogInfo | undefined {
  const toolCall = parseRecordJson(event.payload.toolCall);
  const id =
    stringValue(toolCall?.id) ??
    stringValue(event.payload.toolCallId) ??
    stringValue(event.payload.callId);
  const name =
    stringValue(toolCall?.name) ??
    stringValue(event.payload.toolName) ??
    stringValue(event.payload.name);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    arguments:
      parseRecordJson(toolCall?.argumentsJson) ??
      parseRecordJson(event.payload.argumentsJson) ??
      parseRecordJson(event.payload.arguments),
  };
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    read_file: '读取文件',
    list_files: '列出文件',
    write_file: '写入文件',
    run_command: '执行命令',
    git_status: '读取 Git 状态',
    git_diff: '读取 Git 差异',
  };
  return labels[name] ?? `调用工具 ${name}`;
}

function durationMs(startedAt?: string, endedAt?: string): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  return end - start;
}

function terminalState(type: string): ConversationLogState | undefined {
  if (type === 'run.completed' || type === 'step.completed') return 'completed';
  if (type === 'run.failed' || type === 'step.failed' || type === 'tool.failed') return 'failed';
  if (type === 'run.paused') return 'paused';
  if (type === 'run.cancelled') return 'cancelled';
  return undefined;
}

function eventState(type: string): ConversationLogState | undefined {
  return (
    terminalState(type) ??
    (type === 'run.started' || type === 'step.started' || type === 'message.delta'
      ? 'running'
      : type === 'step.ready'
        ? 'waiting'
        : undefined)
  );
}

function summarizeEvent(event: Event, tool?: ToolLogInfo): string {
  const payload = event.payload;
  const title = stringValue(payload.title);
  switch (event.type) {
    case 'run.started':
      return `Run 启动${stringValue(payload.providerModelId) ? ` · ${String(payload.providerModelId)}` : ''}`;
    case 'run.completed':
      return 'Run 完成';
    case 'run.failed':
      return `Run 失败${stringValue(payload.failureClass) ? ` · ${String(payload.failureClass)}` : ''}`;
    case 'run.paused':
      return `Run 暂停${stringValue(payload.reason) ? ` · ${String(payload.reason)}` : ''}`;
    case 'run.cancelled':
      return 'Run 已取消';
    case 'run.recovered':
      return 'Runtime 恢复执行';
    case 'run.fallback.selected': {
      const from = stringValue(payload.fromProviderModelId) ?? stringValue(payload.fromModelId);
      const to = stringValue(payload.toProviderModelId) ?? stringValue(payload.toModelId);
      return `Fallback${from || to ? ` · ${from ?? '上游'} → ${to ?? '备用模型'}` : ''}`;
    }
    case 'context.packet.built':
      return `上下文已准备${stringValue(payload.providerModelId) ? ` · ${String(payload.providerModelId)}` : ''}`;
    case 'provider.usage':
      return `模型用量 · in ${numberValue(payload.tokensIn) ?? '--'} / out ${numberValue(payload.tokensOut) ?? '--'}`;
    case 'run.retry.scheduled':
      return `模型重试 · 第 ${numberValue(payload.attempt) ?? '--'} 次`;
    case 'application.tool_started':
    case 'tool.requested':
      return tool ? toolLabel(tool.name) : '开始调用工具';
    case 'application.tool_completed':
    case 'tool.completed':
      return `${tool ? toolLabel(tool.name) : '工具调用'}完成`;
    case 'mcp.tool_requested':
      return `请求 MCP 工具 · ${stringValue(payload.toolName) ?? '未知工具'}`;
    case 'mcp.tool_called':
      return `MCP 工具完成 · ${stringValue(payload.toolName) ?? '未知工具'}`;
    case 'step.ready':
      return `等待执行${title ? ` · ${title}` : ''}`;
    case 'step.started':
      return `开始执行${title ? ` · ${title}` : ''}`;
    case 'step.completed':
      return `执行完成${title ? ` · ${title}` : ''}`;
    case 'step.failed':
      return `执行失败${title ? ` · ${title}` : ''}`;
    case 'artifact.version-created':
      return `生成产物${stringValue(payload.artifactName) ? ` · ${String(payload.artifactName)}` : ''}`;
    case 'message.appended':
      return payload.role === 'assistant' ? 'Agent 回复已写入' : '消息已写入';
    case 'message.delta':
      return 'Agent 输出中';
    default:
      if (event.type.startsWith('tool.') || event.type.startsWith('mcp.')) {
        return `工具事件 · ${event.type}`;
      }
      if (event.type.startsWith('review.')) return `审查事件 · ${event.type}`;
      if (event.type.startsWith('handoff.') || event.type.startsWith('subtask.')) {
        return `协作交接 · ${event.type}`;
      }
      return event.type;
  }
}

function knownDetails(event: Event, tool?: ToolLogInfo): ConversationLogDetail[] {
  const payload = event.payload;
  const details: ConversationLogDetail[] = [{ label: '事件', value: event.type }];
  if (event.runId) details.push({ label: 'Run', value: String(event.runId) });
  if (event.stepId) details.push({ label: 'Step', value: String(event.stepId) });
  if (tool) {
    details.push({ label: '工具', value: tool.name });
    const command = stringValue(tool.arguments?.command);
    const commandArgs = Array.isArray(tool.arguments?.args)
      ? tool.arguments.args.filter((entry): entry is string => typeof entry === 'string')
      : [];
    if (command)
      details.push({ label: '命令', value: scrubLogText([command, ...commandArgs].join(' ')) });
    const cwd = stringValue(tool.arguments?.cwd);
    if (cwd) details.push({ label: '工作目录', value: cwd });
    const filePath = stringValue(tool.arguments?.path);
    if (filePath) details.push({ label: '路径', value: filePath });
    if (!command && !filePath && tool.arguments && Object.keys(tool.arguments).length > 0) {
      details.push({ label: '参数', value: scrubLogText(JSON.stringify(tool.arguments, null, 2)) });
    }
  }

  const result = parseRecordJson(event.payload.result);
  if (result) {
    const exitCode = numberValue(result.exitCode);
    if (exitCode !== undefined) details.push({ label: '退出码', value: String(exitCode) });
    const stdout = stringValue(result.stdout);
    const stderr = stringValue(result.stderr);
    const content = stringValue(result.content);
    if (stdout) details.push({ label: '标准输出', value: scrubLogText(stdout) });
    if (stderr) details.push({ label: '错误输出', value: scrubLogText(stderr) });
    if (content) details.push({ label: '读取内容', value: scrubLogText(content) });
    const resultPath = stringValue(result.path);
    if (resultPath) details.push({ label: '结果路径', value: resultPath });
    const bytes = numberValue(result.bytes);
    if (bytes !== undefined) details.push({ label: '字节数', value: String(bytes) });
    if (!stdout && !stderr && !content && exitCode === undefined) {
      details.push({ label: '结果', value: scrubLogText(JSON.stringify(result, null, 2)) });
    }
  } else if (typeof event.payload.result === 'string' && event.payload.result.trim()) {
    details.push({ label: '结果', value: scrubLogText(event.payload.result) });
  }
  const elapsed = numberValue(event.payload.durationMs);
  if (elapsed !== undefined) details.push({ label: '耗时', value: `${elapsed} ms` });
  const reasoningSummary =
    stringValue(event.payload.reasoningSummary) ??
    stringValue(event.payload.stepIntent) ??
    stringValue(event.payload.intent);
  if (reasoningSummary) details.push({ label: '执行意图', value: scrubLogText(reasoningSummary) });

  const known: Array<[string, string, (value: unknown) => string | undefined]> = [
    ['Agent', 'agentVersionId', stringValue],
    ['模型', 'providerModelId', stringValue],
    ['模型', 'modelId', stringValue],
    ['标题', 'title', stringValue],
    ['状态', 'state', stringValue],
    ['失败类型', 'failureClass', stringValue],
    ['原因', 'reason', stringValue],
    [
      '错误',
      'errorMessage',
      (value) => {
        const text = stringValue(value);
        return text ? scrubLogText(text) : undefined;
      },
    ],
    ['产物', 'artifactName', stringValue],
    ['来源模型', 'fromProviderModelId', stringValue],
    ['备用模型', 'toProviderModelId', stringValue],
    [
      'Token 估算',
      'tokenEstimate',
      (value) => {
        const number = numberValue(value);
        return number === undefined ? undefined : String(number);
      },
    ],
    [
      '输入 Token',
      'tokensIn',
      (value) => {
        const number = numberValue(value);
        return number === undefined ? undefined : String(number);
      },
    ],
    [
      '输出 Token',
      'tokensOut',
      (value) => {
        const number = numberValue(value);
        return number === undefined ? undefined : String(number);
      },
    ],
  ];

  const seen = new Set<string>();
  for (const [label, key, project] of known) {
    const value = project(payload[key]);
    if (!value) continue;
    const identity = `${label}:${value}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    details.push({ label, value });
  }
  return details;
}

function stageTitle(event: Event, identity?: ConversationLogAgentIdentity): string {
  return (
    stringValue(event.payload.title) ??
    identity?.responsibility ??
    identity?.role ??
    identity?.name ??
    'Runtime 事件'
  );
}

function finalizeTurn(turn: TurnDraft): ConversationLogTurn {
  for (const stage of turn.stages) {
    stage.durationMs = durationMs(stage.startedAt, stage.endedAt);
  }
  let state = turn.state;
  if (!turn.runStarted && !turn.runTerminal) {
    const stageStates = turn.stages.map((stage) => stage.state);
    if (stageStates.includes('running')) state = 'running';
    else if (stageStates.includes('failed')) state = 'failed';
    else if (stageStates.length > 0 && stageStates.every((item) => item === 'completed')) {
      state = 'completed';
    }
  }
  const startedAt = turn.startedAt ?? turn.userOccurredAt;
  return {
    id: turn.id,
    index: turn.index,
    userMessage: turn.userMessage,
    state,
    startedAt,
    endedAt: turn.endedAt,
    durationMs: durationMs(startedAt, turn.endedAt),
    runIds: [...turn.runIdsSet],
    modelCallCount: turn.modelCallEventIds.size,
    toolCallCount: turn.toolCallCount,
    tokensIn: turn.tokensIn,
    tokensOut: turn.tokensOut,
    artifactCount: turn.artifactCount,
    errorCount: turn.errorCount,
    finalResponse: turn.finalResponse,
    stages: turn.stages,
  };
}

export function projectConversationLogs(input: {
  events: readonly Event[];
  threadId: string;
  taskId?: string;
  agents: ReadonlyMap<string, ConversationLogAgentIdentity>;
}): ConversationLogTurn[] {
  const merged = mergeEventHistory([], input.events);
  const relevantRunIds = new Set<string>();
  for (const event of merged) {
    const threadId = stringValue(event.payload.threadId);
    const taskMatches = Boolean(
      input.taskId && event.taskId && String(event.taskId) === input.taskId,
    );
    if (event.runId && (threadId === input.threadId || taskMatches)) {
      relevantRunIds.add(String(event.runId));
    }
  }
  const ordered = merged.filter((event) => {
    const eventThreadId = stringValue(event.payload.threadId);
    if (eventThreadId && eventThreadId !== input.threadId) return false;
    if (input.taskId && event.taskId && String(event.taskId) !== input.taskId) return false;
    if (event.type === 'message.appended') return eventThreadId === input.threadId;
    if (eventThreadId === input.threadId) return true;
    if (input.taskId && event.taskId && String(event.taskId) === input.taskId) return true;
    return Boolean(event.runId && relevantRunIds.has(String(event.runId)));
  });
  const turns: ConversationLogTurn[] = [];
  const runAgent = new Map<string, string>();
  const runModel = new Map<string, string>();
  const stepAgent = new Map<string, string>();
  const stepModel = new Map<string, string>();
  const toolCalls = new Map<string, ToolLogInfo>();
  let current: TurnDraft | null = null;

  for (const event of ordered) {
    const role = stringValue(event.payload.role);
    const text = stringValue(event.payload.text);
    if (event.type === 'message.appended' && role === 'user' && text) {
      if (current) turns.push(finalizeTurn(current));
      current = {
        id: String(event.id),
        index: turns.length + 1,
        userMessage: text,
        userOccurredAt: event.occurredAt,
        runStarted: false,
        runTerminal: false,
        state: 'unknown',
        runIds: [],
        runIdsSet: new Set(),
        modelCallCount: 0,
        toolCallCount: 0,
        modelCallEventIds: new Set(),
        artifactCount: 0,
        errorCount: 0,
        stages: [],
        stageByKey: new Map(),
      };
      continue;
    }
    if (!current) continue;

    const runId = event.runId ? String(event.runId) : undefined;
    const stepId = event.stepId ? String(event.stepId) : undefined;
    const payloadAgent = stringValue(event.payload.agentVersionId);
    const payloadModel =
      stringValue(event.payload.providerModelId) ?? stringValue(event.payload.modelId);
    const extractedTool = extractToolLogInfo(event);
    if (extractedTool) toolCalls.set(extractedTool.id, extractedTool);
    const toolCallId =
      stringValue(event.payload.toolCallId) ??
      stringValue(event.payload.callId) ??
      extractedTool?.id;
    const tool = extractedTool ?? (toolCallId ? toolCalls.get(toolCallId) : undefined);

    if (runId) current.runIdsSet.add(runId);
    if (event.type === 'run.started' && runId && payloadAgent) runAgent.set(runId, payloadAgent);
    if (event.type === 'run.started' && runId && payloadModel) runModel.set(runId, payloadModel);
    if (stepId && payloadAgent) stepAgent.set(stepId, payloadAgent);
    if (stepId && payloadModel) stepModel.set(stepId, payloadModel);

    const fallbackModel =
      stringValue(event.payload.toProviderModelId) ?? stringValue(event.payload.toModelId);
    if (fallbackModel && stepId) stepModel.set(stepId, fallbackModel);
    else if (fallbackModel && runId) runModel.set(runId, fallbackModel);

    const runtimeOnly = event.type === 'run.recovered' || event.type.startsWith('runtime.');
    const agentVersionId = runtimeOnly
      ? undefined
      : (payloadAgent ??
        (stepId ? stepAgent.get(stepId) : undefined) ??
        (runId ? runAgent.get(runId) : undefined));
    const identity = agentVersionId ? input.agents.get(agentVersionId) : undefined;
    const stageKey = stepId
      ? `step:${stepId}`
      : agentVersionId
        ? `run:${runId ?? 'none'}:agent:${agentVersionId}`
        : 'runtime';
    let stage = current.stageByKey.get(stageKey);
    if (!stage) {
      stage = {
        id: stageKey,
        title: agentVersionId ? stageTitle(event, identity) : 'SYNC-THINK Runtime',
        agentVersionId,
        agentName: identity?.name ?? (agentVersionId ? agentVersionId : 'SYNC-THINK Runtime'),
        role: identity?.role,
        responsibility: identity?.responsibility,
        color: identity?.color,
        avatarUrl: identity?.avatarUrl,
        modelLabel:
          payloadModel ??
          (stepId ? stepModel.get(stepId) : undefined) ??
          (runId ? runModel.get(runId) : undefined),
        state: 'unknown',
        events: [],
      };
      current.stageByKey.set(stageKey, stage);
      current.stages.push(stage);
    } else if (agentVersionId && !stage.agentVersionId) {
      stage.agentVersionId = agentVersionId;
      stage.agentName = identity?.name ?? agentVersionId;
      stage.role = identity?.role;
      stage.responsibility = identity?.responsibility;
      stage.color = identity?.color;
      stage.avatarUrl = identity?.avatarUrl;
      if (stage.title === 'SYNC-THINK Runtime') stage.title = stageTitle(event, identity);
    }

    if (stepId && stringValue(event.payload.title)) stage.title = String(event.payload.title);
    const effectiveModel =
      fallbackModel ??
      payloadModel ??
      (stepId ? stepModel.get(stepId) : undefined) ??
      (runId ? runModel.get(runId) : undefined);
    if (effectiveModel) stage.modelLabel = effectiveModel;

    const nextState = eventState(event.type);
    if (nextState) {
      stage.state = nextState;
      if (nextState === 'running' && !stage.startedAt) stage.startedAt = event.occurredAt;
      if (terminalState(event.type)) stage.endedAt = event.occurredAt;
    }
    stage.events.push({
      id: String(event.id),
      type: event.type,
      summary: summarizeEvent(event, tool),
      occurredAt: event.occurredAt,
      details: knownDetails(event, tool),
    });

    if (!current.startedAt && (event.type === 'run.started' || event.type === 'step.started')) {
      current.startedAt = event.occurredAt;
    }
    const turnState = event.type.startsWith('run.') ? terminalState(event.type) : undefined;
    if (turnState) {
      current.state = turnState === 'waiting' ? 'unknown' : turnState;
      current.runTerminal = true;
      current.endedAt = event.occurredAt;
    } else if (
      current.state === 'unknown' &&
      (event.type === 'run.started' ||
        event.type === 'step.started' ||
        event.type === 'message.delta')
    ) {
      current.state = 'running';
    }
    if (event.type === 'run.started') current.runStarted = true;

    if (
      event.type === 'run.started' ||
      event.type === 'run.retry.scheduled' ||
      event.type === 'run.fallback.selected' ||
      event.type === 'application.tool_turn_completed'
    ) {
      current.modelCallEventIds.add(String(event.id));
    }
    if (event.type === 'tool.requested' || event.type === 'mcp.tool_requested') {
      current.toolCallCount += 1;
    }
    if (event.type === 'provider.usage') {
      const tokensIn = numberValue(event.payload.tokensIn);
      const tokensOut = numberValue(event.payload.tokensOut);
      if (tokensIn !== undefined) current.tokensIn = (current.tokensIn ?? 0) + tokensIn;
      if (tokensOut !== undefined) current.tokensOut = (current.tokensOut ?? 0) + tokensOut;
    }
    if (event.type === 'artifact.version-created') current.artifactCount += 1;
    if (event.type.endsWith('.failed')) current.errorCount += 1;
    if (event.type === 'message.appended' && role === 'assistant' && text) {
      current.finalResponse = text;
    }
  }

  if (current) turns.push(finalizeTurn(current));
  return turns;
}
