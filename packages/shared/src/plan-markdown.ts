import type { ChatPlanRisk, ChatPlanStep, ChatPlanSubmission } from './types/chat-plan.js';

/**
 * 把 Markdown 方案文本宽松解析为结构化计划草稿（ChatPlanSubmission）。
 *
 * 两个消费方共享同一份解析语义：
 *  - 桌面端 plan-review 问询卡（ask plan-review → 可编辑方案卡，§12.18）；
 *  - runtime 的 Claude 原生规划桥（ExitPlanMode 的 Markdown 方案 →
 *    conversation.plan_submitted，内核适配见 docs/engineering/06）。
 *
 * 解析是尽力而为：标题取自入参，步骤取 Markdown 三级以上标题/编号/列表项，
 * 验收取自 checkbox；解析不到步骤时生成一个兜底步骤，保证
 * conversation.plan.submit 校验可通过，用户可在方案卡上编辑补全。
 */
export function parsePlanMarkdown(title: string, markdown: string): ChatPlanSubmission {
  const resolvedTitle = title.trim() || '执行方案';
  const lines = markdown.split(/\r?\n/);
  const steps: ChatPlanStep[] = [];
  const risks: ChatPlanRisk[] = [];
  let goal = '';
  let currentStep: { title: string; description: string; checks: string[] } | null = null;
  const flushStep = () => {
    if (currentStep && currentStep.title.trim()) {
      steps.push({
        id: `step-${steps.length + 1}`,
        title: currentStep.title.trim(),
        description: currentStep.description.trim(),
        acceptanceChecks: currentStep.checks,
      });
    }
    currentStep = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const indented = /^\s+/.test(raw);
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const checkbox = line.match(/^[-*]\s*\[[ xX]\]\s*(.*)$/);
    const numbered = line.match(/^\d+[.、)．]\s*(.*)$/);
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (checkbox) {
      if (currentStep) currentStep.checks.push(checkbox[1]!);
      continue;
    }
    if (/^(目标|背景|概述|goal|风险|risk)\s*[:：]/.test(line)) {
      if (!/^(风险|risk)/i.test(line) && !goal) goal = line;
      continue;
    }
    if (heading) {
      flushStep();
      const text = heading[2]!.trim();
      if (/^(目标|背景|概述|goal)/i.test(text)) {
        goal = text;
        continue;
      }
      if (/^(风险|risk)/i.test(text)) continue;
      // 一级/二级标题是文档结构（# 方案、## 概述），不作为步骤；三级起才算步骤标题。
      if (heading[1]!.length <= 2) continue;
      currentStep = { title: text, description: '', checks: [] };
      continue;
    }
    if (numbered) {
      flushStep();
      currentStep = { title: numbered[1]!.trim(), description: '', checks: [] };
      continue;
    }
    if (bullet) {
      if (indented && currentStep) {
        currentStep.description = currentStep.description
          ? `${currentStep.description}\n${bullet[1]!.trim()}`
          : bullet[1]!.trim();
      } else {
        flushStep();
        currentStep = { title: bullet[1]!.trim(), description: '', checks: [] };
      }
      continue;
    }
    if (currentStep) {
      currentStep.description = currentStep.description
        ? `${currentStep.description}\n${line}`
        : line;
    } else if (!goal) {
      goal = line;
    }
  }
  flushStep();
  if (steps.length === 0) {
    steps.push({
      id: 'step-1',
      title: '执行计划',
      description: goal || markdown.slice(0, 2000),
      acceptanceChecks: [],
    });
  }
  return {
    title: resolvedTitle,
    goal,
    scope: [],
    assumptions: [],
    decisions: [],
    steps,
    risks,
    finalAcceptanceChecks: [],
  };
}
