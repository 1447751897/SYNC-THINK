import { describe, expect, it } from 'vitest';
import type { AgentVersionId, PlanStepDraft, StepId } from './index.js';
import { findPlanStepGraphIssue } from './orchestration-plan-graph.js';

const agentVersionId = 'agent-version-1' as AgentVersionId;

function step(id: string, dependsOn: string[] = [], kind?: PlanStepDraft['kind']): PlanStepDraft {
  return {
    id: id as StepId,
    ...(kind ? { kind } : {}),
    title: id,
    instructions: `Do ${id}`,
    agentVersionId,
    dependsOn: dependsOn as StepId[],
  };
}

describe('findPlanStepGraphIssue', () => {
  it('accepts an acyclic graph and merge steps with two producers', () => {
    expect(
      findPlanStepGraphIssue([
        step('a'),
        step('b'),
        step('merge', ['a', 'b'], 'merge'),
        step('publish', ['merge']),
      ]),
    ).toBeUndefined();
  });

  it.each([
    {
      name: 'duplicate step id',
      steps: [step('a'), step('a')],
      issue: { code: 'duplicate_step_id', path: 'steps[1].id', stepId: 'a' },
    },
    {
      name: 'merge with fewer than two producers',
      steps: [step('a'), step('merge', ['a'], 'merge')],
      issue: {
        code: 'merge_dependencies_required',
        path: 'steps[1].dependsOn',
        stepId: 'merge',
      },
    },
    {
      name: 'self dependency',
      steps: [step('a', ['a'])],
      issue: {
        code: 'self_dependency',
        path: 'steps[0].dependsOn[0]',
        stepId: 'a',
        dependencyId: 'a',
      },
    },
    {
      name: 'duplicate dependency',
      steps: [step('a'), step('b', ['a', 'a'])],
      issue: {
        code: 'duplicate_dependency',
        path: 'steps[1].dependsOn[1]',
        stepId: 'b',
        dependencyId: 'a',
      },
    },
    {
      name: 'missing dependency',
      steps: [step('a', ['missing'])],
      issue: {
        code: 'missing_dependency',
        path: 'steps[0].dependsOn[0]',
        stepId: 'a',
        dependencyId: 'missing',
      },
    },
    {
      name: 'dependency cycle',
      steps: [step('a', ['b']), step('b', ['a'])],
      issue: { code: 'cycle', path: 'steps[0].dependsOn', stepId: 'a' },
    },
  ])('reports the first deterministic $name issue', ({ steps, issue }) => {
    expect(findPlanStepGraphIssue(steps)).toEqual(issue);
  });
});
