import { describe, expect, it, vi } from 'vitest';
import { CAPABILITY_RUNTIME_IPC_CHANNELS } from '../runtime-bridge-contract.js';
import {
  registerCapabilityGovernanceHandlers,
  type CapabilityGovernanceHost,
} from './capability-governance-handlers.js';

function fixture() {
  const handlers = new Map<string, (event: string, value: unknown) => Promise<unknown>>();
  const order: string[] = [];
  const response = { items: [] };
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
    requestCapabilityGovernance:
      request as CapabilityGovernanceHost<string>['requestCapabilityGovernance'],
  };
  registerCapabilityGovernanceHandlers(host);
  return { handlers, host, order, request, response };
}

describe('Capability Governance IPC boundary', () => {
  it('registers activation, governance, publishing and organization commands', () => {
    expect([...fixture().handlers.keys()]).toEqual(Object.values(CAPABILITY_RUNTIME_IPC_CHANNELS));
  });

  it.each([
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.listWorkspaceActivations,
      { workspaceId: ' workspace-1 ', capabilityType: 'skill' },
      'capability.workspace.list',
      { workspaceId: 'workspace-1', capabilityType: 'skill' },
    ],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.setWorkspaceActive,
      {
        workspaceId: ' workspace-1 ',
        capabilityType: 'mcp',
        capabilityId: ' mcp-1 ',
        active: true,
      },
      'capability.workspace.setActive',
      { workspaceId: 'workspace-1', capabilityType: 'mcp', capabilityId: 'mcp-1', active: true },
    ],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.listGovernance,
      { workspaceId: ' workspace-1 ', now: '2026-08-09T00:00:00.000Z' },
      'capability.governance.list',
      { workspaceId: 'workspace-1', now: '2026-08-09T00:00:00.000Z' },
    ],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.savePublishDraft,
      {
        skillVersionId: ' version-1 ',
        skillId: ' skill-1 ',
        displayName: ' Review ',
        description: 'Review changes.',
        skillMd: '---\nname: review\n---\nReview.',
        category: ' development ',
        version: ' 1.0.0 ',
        icon: ' sparkles ',
      },
      'capability.publishDraft.save',
      {
        skillVersionId: 'version-1',
        skillId: 'skill-1',
        displayName: 'Review',
        description: 'Review changes.',
        skillMd: '---\nname: review\n---\nReview.',
        category: 'development',
        version: '1.0.0',
        icon: 'sparkles',
      },
    ],
    [CAPABILITY_RUNTIME_IPC_CHANNELS.listPublishDrafts, null, 'capability.publishDraft.list', {}],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.getPublishDraft,
      { id: ' draft-1 ' },
      'capability.publishDraft.get',
      { id: 'draft-1' },
    ],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.submitPublishDraft,
      { id: ' draft-1 ' },
      'capability.publishDraft.submit',
      { id: 'draft-1' },
    ],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.previewOrganize,
      { workspaceId: ' workspace-1 ', contextBudgetTokens: 15_000 },
      'capability.organize.preview',
      { workspaceId: 'workspace-1', contextBudgetTokens: 15_000 },
    ],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.getLatestOrganize,
      { workspaceId: ' workspace-1 ' },
      'capability.organize.getLatest',
      { workspaceId: 'workspace-1' },
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
    await expect(
      handlers.get(CAPABILITY_RUNTIME_IPC_CHANNELS.listGovernance)!('untrusted', null),
    ).rejects.toThrow('untrusted sender');
    expect(host.ensureConnection).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    [CAPABILITY_RUNTIME_IPC_CHANNELS.listWorkspaceActivations, { workspaceId: '' }],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.setWorkspaceActive,
      { workspaceId: 'workspace-1', capabilityType: 'tool', capabilityId: 'tool-1', active: true },
    ],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.listGovernance,
      { workspaceId: 'workspace-1', now: 'invalid' },
    ],
    [CAPABILITY_RUNTIME_IPC_CHANNELS.savePublishDraft, { skillVersionId: 'version-1' }],
    [CAPABILITY_RUNTIME_IPC_CHANNELS.listPublishDrafts, { limit: 0 }],
    [CAPABILITY_RUNTIME_IPC_CHANNELS.getPublishDraft, {}],
    [CAPABILITY_RUNTIME_IPC_CHANNELS.submitPublishDraft, { id: '' }],
    [
      CAPABILITY_RUNTIME_IPC_CHANNELS.previewOrganize,
      { workspaceId: 'workspace-1', contextBudgetTokens: 0 },
    ],
    [CAPABILITY_RUNTIME_IPC_CHANNELS.getLatestOrganize, { workspaceId: '', extra: true }],
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
      connectionFixture.handlers.get(CAPABILITY_RUNTIME_IPC_CHANNELS.listPublishDrafts)!(
        'trusted',
        {},
      ),
    ).rejects.toBe(offline);
    expect(connectionFixture.request).not.toHaveBeenCalled();

    const transportFixture = fixture();
    const failure = new Error('pipe failed');
    transportFixture.request.mockRejectedValue(failure);
    await expect(
      transportFixture.handlers.get(CAPABILITY_RUNTIME_IPC_CHANNELS.getLatestOrganize)!('trusted', {
        workspaceId: 'workspace-1',
      }),
    ).rejects.toBe(failure);
  });
});
