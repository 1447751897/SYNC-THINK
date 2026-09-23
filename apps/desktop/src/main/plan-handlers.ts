import type {
  PlanCommand,
  PlanCommandRequest,
  PlanCommandResponse,
} from '@sync-think/protocol';
import {
  parsePlanApprovePayload,
  parsePlanCreatePayload,
  parsePlanListPayload,
  parsePlanRevisePayload,
} from '../plan-payloads.js';
import { PLAN_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';

export interface PlanHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestPlan<K extends PlanCommand>(
    command: K,
    payload: PlanCommandRequest<NoInfer<K>>,
    options?: { timeoutMs?: number },
  ): Promise<PlanCommandResponse<K>>;
}

export function registerPlanHandlers<Event>(host: PlanHost<Event>): void {
  host.handle(PLAN_RUNTIME_IPC_CHANNELS.create, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestPlan('plan.draft', parsePlanCreatePayload(value));
  });

  host.handle(PLAN_RUNTIME_IPC_CHANNELS.revise, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestPlan('plan.revise', parsePlanRevisePayload(value));
  });

  host.handle(PLAN_RUNTIME_IPC_CHANNELS.listRevisions, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestPlan('plan.listRevisions', parsePlanListPayload(value));
  });

  host.handle(PLAN_RUNTIME_IPC_CHANNELS.approve, async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestPlan('plan.approve', parsePlanApprovePayload(value));
  });
}
