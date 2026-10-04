import type {
  AutomationFrozenTool,
  AutomationMcpDependency,
  AutomationReadinessDependencies,
  AutomationReadinessIssue,
  AutomationReadinessIssueCode,
  AutomationReadinessResult,
  AutomationRunSnapshot,
  AutomationTaskInput,
} from './types.js';

/** Freeze only newly allocated output; never freeze or mutate caller-owned inventory. */
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Pure preflight. No storage, network, registrations, tool calls or approval requests. */
export function validateAutomationReadiness(
  task: AutomationTaskInput,
  deps: AutomationReadinessDependencies,
): AutomationReadinessResult {
  const issues: AutomationReadinessIssue[] = [];
  const error = (
    code: AutomationReadinessIssueCode,
    message: string,
    resourceId?: string,
  ): void => {
    issues.push({
      code,
      severity: 'error',
      message,
      ...(resourceId !== undefined ? { resourceId } : {}),
    });
  };
  const executionMode = task.automation?.executionMode ?? 'workspace';
  if (!['ask', 'workspace', 'full-access'].includes(executionMode))
    error('EXECUTION_MODE_INVALID', '执行模式无效。');
  const actors: Array<{ agentId?: string; modelId: string; coordinator?: boolean }> = [];
  if (!deps.firedAt || !Number.isFinite(Date.parse(deps.firedAt)))
    error('RUN_TIME_INVALID', '本轮触发时间无效。');
  const workspaceId = task.workspaceId ?? deps.defaultWorkspaceId;
  const workspace = deps.workspaces.find((item) => item.id === workspaceId);
  if (!workspaceId || !workspace)
    error('WORKSPACE_MISSING', '工作区不存在或尚未指定。', workspaceId);
  else if (!workspace.available) error('WORKSPACE_UNAVAILABLE', '工作区当前不可用。', workspaceId);

  const validateAgent = (agentId: string, coordinator?: boolean): void => {
    const agent = deps.agents.find((item) => item.id === agentId);
    if (!agent) {
      error('AGENT_MISSING', `执行智能体不存在：${agentId}。`, agentId);
      return;
    }
    if (!agent.available)
      error(
        'AGENT_UNAVAILABLE',
        `执行智能体当前不可用：${agentId}。${agent.reason ?? ''}`,
        agentId,
      );
    const modelIds = [agent.modelId, ...(agent.fallbackModelIds ?? [])];
    const model = modelIds
      .map((id) => deps.models.find((item) => item.id === id))
      .find((item) => item?.available === true);
    if (!model)
      error(
        'AGENT_MODEL_UNAVAILABLE',
        `智能体 ${agentId} 的模型与已配置备用模型均不可用：${modelIds.join(', ')}。`,
        agentId,
      );
    else
      actors.push({
        agentId,
        modelId: model.id,
        ...(coordinator !== undefined ? { coordinator } : {}),
      });
  };
  const target = task.target;
  if (target.kind === 'model') {
    const model = deps.models.find((item) => item.id === target.modelId);
    if (!model) error('MODEL_MISSING', `执行模型不存在：${target.modelId}。`, target.modelId);
    else if (!model.available)
      error(
        'MODEL_UNAVAILABLE',
        `执行模型当前不可用：${model.id}。${model.reason ?? ''}`,
        model.id,
      );
    else actors.push({ modelId: model.id });
  } else if (target.kind === 'agent') {
    validateAgent(target.agentId);
  } else {
    const team = deps.teams.find((item) => item.id === target.teamId);
    if (!team) error('TEAM_MISSING', `执行小队不存在：${target.teamId}。`, target.teamId);
    else {
      if (!team.available)
        error('TEAM_UNAVAILABLE', `执行小队当前不可用。${team.reason ?? ''}`, team.id);
      if (team.memberAgentIds.length === 0) error('TEAM_EMPTY', '执行小队尚未配置成员。', team.id);
      if (!team.coordinatorAgentId)
        error('TEAM_COORDINATOR_MISSING', '执行小队尚未配置协调员。', team.id);
      else if (!team.memberAgentIds.includes(team.coordinatorAgentId))
        error('TEAM_COORDINATOR_NOT_MEMBER', '小队协调员不在成员名单中。', team.coordinatorAgentId);
      for (const id of new Set(team.memberAgentIds))
        validateAgent(id, id === team.coordinatorAgentId);
      if (team.coordinatorAgentId && !team.memberAgentIds.includes(team.coordinatorAgentId))
        validateAgent(team.coordinatorAgentId, true);
    }
  }

  const browser = task.automation?.browser;
  const pending = (deps.pendingInputs ?? []).filter(
    (item) =>
      (item.taskId === undefined || item.taskId === task.id) &&
      (item.profileId === undefined || item.profileId === browser?.profileId) &&
      (item.workflowTaskId === undefined || item.workflowTaskId === browser?.workflowTaskId),
  );
  const waiting = (
    kind: 'login' | 'approval',
    message: string,
    resourceId: string,
    key?: string,
  ): void => {
    const existing = pending.find((item) => item.kind === kind);
    const dedupeKey = key ?? existing?.key ?? `${task.id}:${kind}:${resourceId}`;
    if (issues.some((item) => item.dedupeKey === dedupeKey)) return;
    issues.push({
      code: kind === 'login' ? 'LOGIN_REQUIRED' : 'APPROVAL_REQUIRED',
      severity: 'waiting_input',
      message: existing?.reason ?? message,
      resourceId,
      dedupeKey,
    });
  };
  for (const item of pending)
    waiting(item.kind, item.reason, item.workflowTaskId ?? item.profileId ?? task.id, item.key);

  let frozenBrowser: AutomationRunSnapshot['browser'];
  if (browser) {
    if (deps.browserAvailable !== true)
      error('BROWSER_UNAVAILABLE', '本执行者尚未配置可用浏览器工具。', browser.profileId);
    const profile = deps.browserProfiles?.find((item) => item.id === browser.profileId);
    if (!profile)
      error('BROWSER_PROFILE_MISSING', '绑定的 Browser Profile 不存在。', browser.profileId);
    else {
      if (!profile.available)
        error('BROWSER_PROFILE_UNAVAILABLE', '绑定的 Browser Profile 当前不可用。', profile.id);
      if (profile.loginState === 'required')
        waiting(
          'login',
          'Browser Profile 等待用户登录；本轮 yield，复用既有登录交接。',
          profile.id,
        );
      if (profile.approvalState === 'required' || profile.approvalState === 'pending')
        waiting(
          'approval',
          'Browser Profile 权限待配置或审批；本轮 yield，复用已有审批。',
          profile.id,
        );
    }
    const variables = { ...(browser.variables ?? {}) };
    for (const [name, value] of Object.entries(variables)) {
      if (typeof value !== 'string')
        error('BROWSER_VARIABLE_INVALID', `浏览器变量 ${name} 必须是字符串。`, name);
    }
    let workflowVersionId: string | undefined;
    if (browser.workflowTaskId !== undefined) {
      const workflow = deps.browserWorkflows?.find((item) => item.id === browser.workflowTaskId);
      if (deps.browserWorkflowReplayAvailable !== true)
        error(
          'BROWSER_WORKFLOW_REPLAY_UNAVAILABLE',
          '当前执行者没有可用的 Browserflow 回放工具。',
          browser.workflowTaskId,
        );
      if (!workflow)
        error('BROWSER_WORKFLOW_MISSING', '绑定的 Browserflow 不存在。', browser.workflowTaskId);
      else {
        if (!workflow.enabled)
          error('BROWSER_WORKFLOW_DISABLED', '绑定的 Browserflow 尚未启用。', workflow.id);
        if (
          !workflow.publishedVersionId ||
          !workflow.publishedVersion ||
          workflow.publishedVersion.id !== workflow.publishedVersionId
        ) {
          error(
            'BROWSER_WORKFLOW_UNPUBLISHED',
            '绑定的 Browserflow 缺少已发布版本或版本记录不匹配。',
            workflow.id,
          );
        } else {
          workflowVersionId = workflow.publishedVersion.id;
          for (const name of new Set(workflow.publishedVersion.requiredVariables)) {
            const value = Object.hasOwn(variables, name) ? variables[name] : undefined;
            if (typeof value !== 'string' || value.trim() === '')
              error('BROWSER_VARIABLE_MISSING', `Browserflow 必要变量缺失或为空：${name}。`, name);
          }
        }
        if (workflow.workspaceId && workflow.workspaceId !== workspaceId)
          error(
            'BROWSER_WORKFLOW_WORKSPACE_MISMATCH',
            'Browserflow 与本轮工作区不匹配。',
            workflow.id,
          );
        if (workflow.profileId !== browser.profileId)
          error(
            'BROWSER_WORKFLOW_PROFILE_MISMATCH',
            'Browserflow 与本轮 Browser Profile 不匹配。',
            workflow.id,
          );
        if (workflow.approvalState === 'required' || workflow.approvalState === 'pending')
          waiting(
            'approval',
            'Browserflow 权限待配置或审批；本轮 yield，复用已有审批。',
            workflow.id,
          );
      }
    }
    frozenBrowser = {
      profileId: browser.profileId,
      ...(browser.workflowTaskId !== undefined ? { workflowTaskId: browser.workflowTaskId } : {}),
      ...(workflowVersionId ? { workflowVersionId } : {}),
      variables,
    };
  }

  const frozenServers: Array<{ id: string; tools: AutomationFrozenTool[] }> = [];
  const requiredIds = new Set(task.automation?.requiredMcpServerIds ?? []);
  const delivery = task.automation?.delivery;
  if (delivery?.mcpServerId?.trim()) requiredIds.add(delivery.mcpServerId);
  for (const id of requiredIds) {
    const server = deps.mcpServers?.find((item) => item.id === id);
    if (!server || !server.registered) {
      error('MCP_UNREGISTERED', `必需 MCP 未注册：${id}；请先在配置中完成注册。`, id);
      continue;
    }
    if (!server.connected) {
      error('MCP_DISCONNECTED', `必需 MCP 未连接：${id}。${server.reason ?? ''}`, id);
      continue;
    }
    if (server.available === false) {
      error('MCP_UNAVAILABLE', `本执行者没有该 MCP 的可用权限：${id}。${server.reason ?? ''}`, id);
      continue;
    }
    const tools = server.tools
      .filter((tool) => tool.available && tool.name.trim())
      .map((tool) => ({
        name: tool.name,
        mcpServerId: id,
        capabilities: [...(tool.capabilities ?? [])],
      }));
    if (tools.length === 0)
      error('MCP_TOOLS_MISSING', `必需 MCP 没有当前执行者可调用的工具：${id}。`, id);
    else frozenServers.push({ id, tools });
  }
  const availableTools: AutomationFrozenTool[] = [
    ...(deps.tools ?? [])
      .filter((tool) => tool.available && tool.name.trim())
      .map((tool) => ({ name: tool.name, capabilities: [...(tool.capabilities ?? [])] })),
    ...frozenServers.flatMap((server) => server.tools),
  ];
  const skillVersionIds = [...new Set(task.skillVersionIds ?? [])];
  const availableSkills = skillVersionIds.flatMap((id) => {
    const skill = deps.skills?.find((item) => item.id === id);
    if (!skill?.available) {
      error(
        'SKILL_UNAVAILABLE',
        `本轮指定 skill 不存在、未启用或未批准：${id}。${skill?.reason ?? ''}`,
        id,
      );
      return [];
    }
    const missingTools = (skill.requiredToolNames ?? []).filter(
      (name) => !availableTools.some((tool) => tool.name === name),
    );
    if (missingTools.length > 0) {
      error('SKILL_TOOL_MISSING', `Skill ${id} 缺少实际执行工具：${missingTools.join(', ')}。`, id);
      return [];
    }
    return [skill];
  });
  const outputs = [...new Set(task.automation?.outputs ?? [])].map((kind) => {
    const tools = availableTools.filter((tool) => tool.capabilities.includes(kind));
    const skills = availableSkills.filter((skill) => skill.outputs?.includes(kind));
    if (tools.length === 0 && skills.length === 0)
      error(
        'OUTPUT_CAPABILITY_MISSING',
        `缺少生成 ${kind} 的实际工具或已启用并注入本轮的 skill；产物尚未生成。`,
        kind,
      );
    return { kind, tools, skillVersionIds: skills.map((skill) => skill.id) };
  });

  let frozenDelivery: AutomationRunSnapshot['delivery'];
  if (delivery) {
    if (!delivery.mcpServerId?.trim())
      error('GMAIL_SERVER_REQUIRED', 'Gmail 发送必须明确指定 MCP server id。');
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(delivery.recipient ?? ''))
      error(
        'GMAIL_RECIPIENT_INVALID',
        'Gmail 收件地址缺失或格式无效；每轮只采用冻结的明确收件地址。',
      );
    const server: AutomationMcpDependency | undefined = deps.mcpServers?.find(
      (item) => item.id === delivery.mcpServerId,
    );
    if (server && server.connector !== 'gmail')
      error('GMAIL_CONNECTOR_REQUIRED', '指定 MCP 未被确认是 Gmail connector。', server.id);
    const sendToolNames =
      frozenServers
        .find((item) => item.id === delivery.mcpServerId)
        ?.tools.filter(
          (tool) =>
            tool.capabilities.includes('gmail.send') &&
            (delivery.toolName === undefined || tool.name === delivery.toolName),
        )
        .map((tool) => tool.name) ?? [];
    if (sendToolNames.length === 0)
      error(
        'GMAIL_SEND_TOOL_MISSING',
        delivery.toolName !== undefined
          ? '声明的 Gmail 发件工具未在该 connector 的真实可用 send 工具中：' +
              delivery.toolName +
              '；邮件尚未发送。'
          : '指定 Gmail connector 缺少已连接且可调用的 send 工具；邮件尚未发送。',
        delivery.mcpServerId,
      );
    frozenDelivery = {
      kind: 'gmail',
      mcpServerId: delivery.mcpServerId,
      ...(delivery.toolName !== undefined ? { toolName: delivery.toolName } : {}),
      recipient: delivery.recipient,
      sendToolNames,
    };
  }
  if (issues.length > 0)
    return freeze({
      status: issues.some((item) => item.severity === 'error') ? 'blocked' : 'waiting_input',
      ready: false,
      reasons: issues.map((issue) => issue.message),
      issues,
    });
  const snapshot: AutomationRunSnapshot = {
    executionMode,
    taskId: task.id,
    taskName: task.name,
    instruction: task.instruction,
    target: { ...task.target },
    firedAt: deps.firedAt,
    ...(task.timeZone ? { timeZone: task.timeZone } : {}),
    ...(deps.runId ? { runId: deps.runId } : {}),
    workspaceId: workspaceId!,
    actors,
    skillVersionIds,
    tools: availableTools,
    ...(frozenBrowser ? { browser: frozenBrowser } : {}),
    mcpServers: frozenServers,
    outputs,
    ...(frozenDelivery ? { delivery: frozenDelivery } : {}),
    ...(task.automation?.acceptanceChecks
      ? { acceptanceChecks: structuredClone(task.automation.acceptanceChecks) }
      : {}),
    ...(task.automation?.acceptance !== undefined
      ? { acceptance: task.automation.acceptance }
      : {}),
  };
  return freeze({ status: 'ready', ready: true, issues: [], reasons: [], snapshot });
}
