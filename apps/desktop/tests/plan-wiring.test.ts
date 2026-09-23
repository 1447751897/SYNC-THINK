import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLAN_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(new URL('../src/main/plan-handlers.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Plan lifecycle IPC wiring', () => {
  it('registers plan lifecycle commands through the typed boundary', () => {
    for (const command of ['plan.draft', 'plan.revise', 'plan.listRevisions', 'plan.approve']) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('PLAN_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(PLAN_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`PLAN_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerPlanHandlers({');
    expect(mainSource).toContain('requestPlan:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const method of [
      'createPlan(payload: PlanDraftPayload)',
      'revisePlan(payload: PlanRevisePayload)',
      'listPlanRevisions(payload: PlanListRevisionsPayload)',
      'approvePlan(payload: PlanApprovePayload)',
    ]) {
      expect(globalSource).toContain(method);
    }
  });
});
