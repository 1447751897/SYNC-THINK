import { describe, expect, it } from 'vitest';
import {
  parsePlanApprovePayload,
  parsePlanCreatePayload,
  parsePlanListPayload,
  parsePlanRevisePayload,
} from './plan-payloads.js';

const step = {
  id: 'step-1',
  title: 'Inspect',
  instructions: 'Inspect the relevant files.',
  agentVersionId: 'agent-version-1',
  dependsOn: [],
};

describe('Plan lifecycle payload validation', () => {
  it('accepts exact create, revise, list and approve payloads', () => {
    expect(
      parsePlanCreatePayload({
        taskId: 'task-1',
        expectedTaskVersion: 2,
        title: 'Review plan',
        steps: [step],
      }),
    ).toMatchObject({ title: 'Review plan', steps: [{ ...step, kind: 'execution' }] });
    expect(
      parsePlanRevisePayload({
        planId: 'plan-1',
        expectedRevision: 1,
        title: 'Review plan v2',
        steps: [step],
      }),
    ).toMatchObject({ expectedRevision: 1, title: 'Review plan v2' });
    expect(parsePlanListPayload({ planId: 'plan-1' })).toEqual({ planId: 'plan-1' });
    expect(parsePlanApprovePayload({ planId: 'plan-1', revision: 2 })).toEqual({
      planId: 'plan-1',
      revision: 2,
    });
  });

  it('rejects duplicate and missing step dependencies', () => {
    const base = {
      taskId: 'task-1',
      expectedTaskVersion: 2,
      title: 'Review plan',
    };
    expect(() => parsePlanCreatePayload({ ...base, steps: [step, step] })).toThrow(
      /Invalid plan-create/,
    );
    expect(() =>
      parsePlanCreatePayload({ ...base, steps: [{ ...step, dependsOn: ['missing-step'] }] }),
    ).toThrow(/Invalid plan-create/);
  });

  it('accepts image generation only on execution steps', () => {
    const base = {
      taskId: 'task-1',
      expectedTaskVersion: 2,
      title: 'Image plan',
    };
    expect(
      parsePlanCreatePayload({
        ...base,
        steps: [
          {
            ...step,
            imageGeneration: { size: 'auto', quality: 'high', count: 1 },
          },
        ],
      }).steps[0]?.imageGeneration,
    ).toEqual({ size: 'auto', quality: 'high', count: 1 });
    expect(() =>
      parsePlanCreatePayload({
        ...base,
        steps: [
          {
            ...step,
            kind: 'merge',
            imageGeneration: { size: 'auto', quality: 'high', count: 1 },
          },
        ],
      }),
    ).toThrow(/Invalid plan-create/);
  });

  it('rejects authority, secret-like and unknown fields', () => {
    expect(() =>
      parsePlanCreatePayload({
        taskId: 'task-1',
        expectedTaskVersion: 2,
        title: 'Review plan',
        steps: [step],
        apiKey: 'plaintext',
      }),
    ).toThrow(/secret-like|Invalid plan-create/);
    expect(() => parsePlanApprovePayload({ planId: 'plan-1', revision: 1, force: true })).toThrow(
      /Invalid plan-approve/,
    );
  });
});
