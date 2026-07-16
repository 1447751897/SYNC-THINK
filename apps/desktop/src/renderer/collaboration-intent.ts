import type { AgentVersionId, PlanStepDraft } from '@sync-think/shared';

export interface ConversationCollaborationIntent {
  shouldUpgrade: boolean;
  reason: 'explicit' | 'complex' | 'conversation';
}

export interface ConversationCollaborationAgent {
  agentVersionId: string;
  name: string;
  role: string;
  selected?: boolean;
}

export function inferConversationCollaborationIntent(
  text: string,
): ConversationCollaborationIntent {
  const normalized = text.trim();
  const explicit =
    /(?:多\s*(?:agent|智能体)|multi[-\s]?agent|小队|团队协作|协作完成|并行(?:处理|执行|推进)|分工(?:完成|处理|执行)|调度.{0,8}(?:agent|智能体))/iu.test(
      normalized,
    );
  if (explicit) return { shouldUpgrade: true, reason: 'explicit' };

  const listItems = normalized
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:\d+[.)、]|[-*+])\s*/.test(line)).length;
  const phaseWords = [
    /分析|调研|梳理/u,
    /设计|规划|方案/u,
    /实现|开发|修改/u,
    /测试|验证|验收/u,
    /审查|评审|复盘/u,
  ].filter((pattern) => pattern.test(normalized)).length;
  const scopeSignal = /端到端|全流程|完整(?:完成|实现|交付)|从.+到.+/u.test(normalized);
  const complexScore = Number(listItems >= 3) + Number(phaseWords >= 3) + Number(scopeSignal);
  return complexScore >= 3
    ? { shouldUpgrade: true, reason: 'complex' }
    : { shouldUpgrade: false, reason: 'conversation' };
}

function reviewerLike(agent: ConversationCollaborationAgent): boolean {
  return /review|reviewer|qa|test|审查|评审|测试|验收/iu.test(`${agent.role} ${agent.name}`);
}

export function buildConversationCollaborationPlan(input: {
  prompt: string;
  agents: readonly ConversationCollaborationAgent[];
  createStepId: () => string;
}): PlanStepDraft[] {
  const uniqueAgents = Array.from(
    new Map(input.agents.map((agent) => [agent.agentVersionId, agent])).values(),
  );
  if (uniqueAgents.length === 0) return [];

  const lead = uniqueAgents.find((agent) => agent.selected) ??
    uniqueAgents.find((agent) => !reviewerLike(agent)) ??
    uniqueAgents[0]!;
  const reviewer = uniqueAgents.find(
    (agent) => agent.agentVersionId !== lead.agentVersionId && reviewerLike(agent),
  );
  const workers = uniqueAgents
    .filter(
      (agent) =>
        agent.agentVersionId !== lead.agentVersionId &&
        agent.agentVersionId !== reviewer?.agentVersionId,
    )
    .slice(0, 2);
  const prompt = input.prompt.trim().slice(0, 4000);
  const leadId = input.createStepId() as PlanStepDraft['id'];
  const steps: PlanStepDraft[] = [
    {
      id: leadId,
      title: uniqueAgents.length > 1 ? '分析需求并拆分工作' : '执行并验证任务',
      instructions:
        uniqueAgents.length > 1
          ? `分析需求，明确约束、验收标准和 Agent 分工。原始需求：${prompt}`
          : `完成需求并提供可验证结果。原始需求：${prompt}`,
      agentVersionId: lead.agentVersionId as AgentVersionId,
      dependsOn: [],
    },
  ];

  for (const worker of workers) {
    steps.push({
      id: input.createStepId() as PlanStepDraft['id'],
      title: `执行分工：${worker.name}`,
      instructions: `按已批准分工完成实现并提交验证证据。原始需求：${prompt}`,
      agentVersionId: worker.agentVersionId as AgentVersionId,
      dependsOn: [leadId],
    });
  }

  if (reviewer) {
    const dependencies = workers.length > 0 ? steps.slice(1).map((step) => step.id) : [leadId];
    steps.push({
      id: input.createStepId() as PlanStepDraft['id'],
      title: `审查与收敛：${reviewer.name}`,
      instructions: `检查结果是否满足原始需求和验收标准，给出通过或返工证据。原始需求：${prompt}`,
      agentVersionId: reviewer.agentVersionId as AgentVersionId,
      dependsOn: dependencies,
    });
  }

  return steps;
}
