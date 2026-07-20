import type { Event, GroupDefinition, PlanStepDraft, RunId } from '@sync-think/shared';

export const GROUP_DELEGATION_DECISION_STEP_TITLE = '主智能体分析并分解任务';
export const GROUP_FINAL_SUMMARY_STEP_TITLE = '主智能体检查并总结结果';

export interface GroupDelegationAssignment {
  agentVersionId: string;
  goal: string;
  requiredEvidence: string[];
  acceptanceConditions: string[];
  allowedTools: string[];
}

export interface GroupDelegationDecision {
  mode: 'single' | 'delegate';
  reason: string;
  assignments: GroupDelegationAssignment[];
}

export interface BuildGroupCollaborationPlanInput {
  group: GroupDefinition;
  taskTitle: string;
  taskGoal: string;
  userMessage: string;
  createStepId: () => string;
}

export function buildGroupCollaborationPlan(
  input: BuildGroupCollaborationPlanInput,
): PlanStepDraft[] {
  const ordered = [...input.group.members].sort((left, right) => left.sortOrder - right.sortOrder);
  const lead = ordered.find((member) => member.agentVersionId === input.group.leadAgentVersionId);
  if (!lead) throw new Error('group.lead_member_missing');

  const workers = ordered.filter(
    (member) => member.agentVersionId !== input.group.leadAgentVersionId,
  );
  const decisionStepId = input.createStepId() as PlanStepDraft['id'];
  const workerCatalog = workers.map((member) => ({
    agentVersionId: member.agentVersionId,
    responsibility: member.responsibility,
  }));
  const steps: PlanStepDraft[] = [
    {
      id: decisionStepId,
      kind: 'execution',
      title: GROUP_DELEGATION_DECISION_STEP_TITLE,
      instructions: [
        `群聊：${input.group.name}`,
        `任务：${input.taskTitle}`,
        `任务目标：${input.taskGoal}`,
        `用户最新要求：${input.userMessage}`,
        `你的固定职责：${lead.responsibility}`,
        '先判断你应当直接完成任务，还是只委派确有必要的成员。不要为了使用群聊而强制拆分。',
        '可委派成员（只能使用这些精确 AgentVersion ID）：',
        JSON.stringify(workerCatalog),
        '只返回一个 JSON 对象，不要 Markdown：',
        '{"mode":"single|delegate","reason":"...","assignments":[{"agentVersionId":"exact id","goal":"isolated goal","requiredEvidence":["..."],"acceptanceConditions":["..."],"allowedTools":["..."]}]}',
        'mode=single 时 assignments 必须为空；mode=delegate 时每个成员最多出现一次。',
      ].join('\n'),
      agentVersionId: input.group.leadAgentVersionId,
      dependsOn: [],
    },
  ];
  let previousStepId: string = decisionStepId;
  for (const member of workers) {
    const id = input.createStepId() as PlanStepDraft['id'];
    const dependsOn =
      input.group.collaborationMode === 'sequential'
        ? [previousStepId as PlanStepDraft['id']]
        : [decisionStepId];
    steps.push({
      id,
      kind: 'execution',
      title: member.responsibility,
      instructions: [
        `群聊：${input.group.name}`,
        `你的精确 AgentVersion ID：${member.agentVersionId}`,
        `你的固定职责：${member.responsibility}`,
        '只读取主智能体给你的独立子任务包和显式交接历史。',
        '只完成明确分配给你的目标；给出结论、所需证据和需要交接给主智能体的事项。',
      ].join('\n'),
      agentVersionId: member.agentVersionId,
      dependsOn,
    });
    previousStepId = id;
  }

  const leadStepId = input.createStepId() as PlanStepDraft['id'];
  const workerStepIds = steps.slice(1).map((step) => step.id);
  const leadDependencies = [decisionStepId, ...workerStepIds];
  steps.push({
    id: leadStepId,
    kind: 'execution',
    title: GROUP_FINAL_SUMMARY_STEP_TITLE,
    instructions: [
      `群聊：${input.group.name}`,
      `任务：${input.taskTitle}`,
      `任务目标：${input.taskGoal}`,
      `用户最新要求：${input.userMessage}`,
      `你的固定职责：${lead.responsibility}`,
      '阅读所有依赖成员的真实产物，统一总结最终结果。不要虚构成员未完成的工作；存在冲突或缺口时明确指出。',
    ].join('\n'),
    agentVersionId: input.group.leadAgentVersionId,
    dependsOn: leadDependencies,
  });
  return steps;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  const unwrapped = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  try {
    const parsed = JSON.parse(unwrapped) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 64) return undefined;
  const items = value.map((item) => (typeof item === 'string' ? item.trim() : ''));
  return items.every(Boolean) ? items : undefined;
}

export function parseGroupDelegationDecision(
  value: string,
  group: GroupDefinition,
): GroupDelegationDecision | undefined {
  const parsed = parseJsonObject(value);
  if (!parsed || (parsed.mode !== 'single' && parsed.mode !== 'delegate')) return undefined;
  const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
  if (!reason || !Array.isArray(parsed.assignments)) return undefined;
  if (parsed.mode === 'single') {
    return parsed.assignments.length === 0
      ? { mode: 'single', reason, assignments: [] }
      : undefined;
  }

  const allowed = new Set(
    group.members
      .map((member) => String(member.agentVersionId))
      .filter((id) => id !== String(group.leadAgentVersionId)),
  );
  const seen = new Set<string>();
  const assignments: GroupDelegationAssignment[] = [];
  for (const raw of parsed.assignments) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    const agentVersionId =
      typeof record.agentVersionId === 'string' ? record.agentVersionId.trim() : '';
    const goal = typeof record.goal === 'string' ? record.goal.trim() : '';
    const requiredEvidence = stringList(record.requiredEvidence);
    const acceptanceConditions = stringList(record.acceptanceConditions);
    const allowedTools = stringList(record.allowedTools);
    if (
      !agentVersionId ||
      !allowed.has(agentVersionId) ||
      seen.has(agentVersionId) ||
      !goal ||
      !requiredEvidence ||
      !acceptanceConditions ||
      !allowedTools
    ) {
      return undefined;
    }
    seen.add(agentVersionId);
    assignments.push({
      agentVersionId,
      goal,
      requiredEvidence,
      acceptanceConditions,
      allowedTools,
    });
  }
  return assignments.length > 0 ? { mode: 'delegate', reason, assignments } : undefined;
}

export function isGroupDelegationDecisionStep(step: Pick<PlanStepDraft, 'title'>): boolean {
  return step.title === GROUP_DELEGATION_DECISION_STEP_TITLE;
}

export function isGroupFinalSummaryStep(step: Pick<PlanStepDraft, 'title'>): boolean {
  return step.title === GROUP_FINAL_SUMMARY_STEP_TITLE;
}

export function collectGroupCollaborationRunIds(events: readonly Event[]): RunId[] {
  const runIds = new Set<RunId>();
  for (const event of events) {
    if (event.type === 'group.collaboration.started' && event.runId) {
      runIds.add(event.runId);
    }
  }
  return [...runIds];
}
