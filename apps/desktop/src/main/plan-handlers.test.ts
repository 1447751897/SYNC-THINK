import { describe, expect, it, vi } from 'vitest';
import { PLAN_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import { registerPlanHandlers, type PlanHost } from './plan-handlers.js';

const step = {
  id: 'step-1',
  title: 'Inspect',
  instructions: 'Inspect the relevant files.',
  agentVersionId: 'agent-version-1',
  dependsOn: [],
};

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { planId: 'plan-1' };
  const request = vi.fn(async (command: string) => {
    order.push(`request:${command}`);
    return response;
  });
  const host = {
    handle: (channel: string, listener: (event: string, value: unknown) => Promise<unknown>) => {
      handlers.set(channel, listener);
    },
    assertSource: vi.fn(() => order.push('source')),
    ensureConnection: vi.fn(async () => {
      order.push('connect');
    }),
    requestPlan: request as PlanHost<string>['requestPlan'],
  };
  registerPlanHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Plan lifecycle IPC boundary', () => {
  it('registers the four plan lifecycle commands', () => {
    expect([...fixture().handlers.keys()]).toEqual(Object.values(PLAN_RUNTIME_IPC_CHANNELS));
  });

  it.each([
    [
      PLAN_RUNTIME_IPC_CHANNELS.create,
      { taskId: 'task-1', expectedTaskVersion: 2, title: 'Plan', steps: [step] },
      'plan.draft',
      {
        taskId: 'task-1',
        expectedTaskVersion: 2,
        title: 'Plan',
        steps: [{ ...step, kind: 'execution' }],
      },
    ],
    [
      PLAN_RUNTIME_IPC_CHANNELS.revise,
      { planId: 'plan-1', expectedRevision: 1, steps: [step] },
      'plan.revise',
      {
        planId: 'plan-1',
        expectedRevision: 1,
        steps: [{ ...step, kind: 'execution' }],
      },
    ],
    [
      PLAN_RUNTIME_IPC_CHANNELS.listRevisions,
      { planId: 'plan-1' },
      'plan.listRevisions',
      { planId: 'plan-1' },
    ],
    [
      PLAN_RUNTIME_IPC_CHANNELS.approve,
      { planId: 'plan-1', revision: 2 },
      'plan.approve',
      { planId: 'plan-1', revision: 2 },
    ],
  ])('forwards %s through its typed command', async (channel, value, command, payload) => {
    const { handlers, order, request, response } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).resolves.toBe(response);
    expect(request).toHaveBeenCalledWith(command, payload);
    expect(order).toEqual(['source', 'connect', `request:${command}`]);
  });

  it('rejects untrusted senders before connection, parsing and transport', async () => {
    const { handlers, host, request } = fixture();
    host.assertSource.mockImplementation(() => {
      throw new Error('untrusted sender');
    });
    await expect(handlers.get(PLAN_RUNTIME_IPC_CHANNELS.create)!('untrusted', null)).rejects.toThrow(
      'untrusted sender',
    );
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [PLAN_RUNTIME_IPC_CHANNELS.create, { taskId: 'task-1' }],
    [PLAN_RUNTIME_IPC_CHANNELS.revise, { planId: 'plan-1', expectedRevision: 0, steps: [step] }],
    [PLAN_RUNTIME_IPC_CHANNELS.listRevisions, {}],
    [PLAN_RUNTIME_IPC_CHANNELS.approve, { planId: 'plan-1', revision: 0 }],
  ])('connects before rejecting invalid %s payloads without transport', async (channel, value) => {
    const { handlers, host, order, request } = fixture();
    await expect(handlers.get(channel)!('trusted', value)).rejects.toThrow(/Invalid/);
    expect(host.ensureConnection).toHaveBeenCalledOnce();
    expect(order).toEqual(['source', 'connect']);
    expect(request).not.toHaveBeenCalled();
  });

  it('preserves connection and transport failure identity', async () => {
    const connectionFixture = fixture();
    const offline = new Error('offline');
    connectionFixture.host.ensureConnection.mockRejectedValue(offline);
    await expect(
      connectionFixture.handlers.get(PLAN_RUNTIME_IPC_CHANNELS.listRevisions)!('trusted', {
        planId: 'plan-1',
      }),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(PLAN_RUNTIME_IPC_CHANNELS.approve)!('trusted', {
        planId: 'plan-1',
        revision: 2,
      }),
    ).rejects.toBe(failure);
  });
});
