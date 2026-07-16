import { describe, expect, it } from 'vitest';
import {
  buildConversationCollaborationPlan,
  inferConversationCollaborationIntent,
} from '../src/renderer/collaboration-intent.js';

describe('conversation collaboration intent', () => {
  it('keeps ordinary conversation in one-Agent mode', () => {
    expect(inferConversationCollaborationIntent('你好，解释一下这个函数').shouldUpgrade).toBe(
      false,
    );
  });

  it('recognizes explicit multi-Agent and team requests', () => {
    expect(
      inferConversationCollaborationIntent('请组一个多 Agent 小队，分工完成实现和审查')
        .shouldUpgrade,
    ).toBe(true);
  });

  it('recognizes substantial end-to-end work without requiring a mode keyword', () => {
    expect(
      inferConversationCollaborationIntent(
        '请端到端完成：\n1. 分析现状\n2. 实现功能\n3. 补齐测试\n4. 做最终审查',
      ).shouldUpgrade,
    ).toBe(true);
  });
});

describe('conversation collaboration plan', () => {
  const agents = [
    { agentVersionId: 'av-plan', name: '规划', role: 'planner', selected: true },
    { agentVersionId: 'av-build', name: '执行', role: 'executor' },
    { agentVersionId: 'av-review', name: '审查', role: 'reviewer' },
  ];

  it('uses configured Agent versions and makes review depend on execution', () => {
    let id = 0;
    const steps = buildConversationCollaborationPlan({
      prompt: '完成工作区交互改版并验证',
      agents,
      createStepId: () => `step-${++id}`,
    });

    expect(steps.map((step) => step.agentVersionId)).toEqual([
      'av-plan',
      'av-build',
      'av-review',
    ]);
    expect(steps[1]?.dependsOn).toEqual(['step-1']);
    expect(steps[2]?.dependsOn).toEqual(['step-2']);
  });

  it('still creates an editable plan when only one Agent is configured', () => {
    const steps = buildConversationCollaborationPlan({
      prompt: '完成任务',
      agents: agents.slice(0, 1),
      createStepId: () => 'step-only',
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ agentVersionId: 'av-plan', dependsOn: [] });
  });
});
