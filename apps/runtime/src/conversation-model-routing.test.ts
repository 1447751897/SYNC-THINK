import { expect, it, vi } from 'vitest';
import {
  resolveConversationModelId,
  type ConversationModelRoutingPorts,
} from './conversation-model-routing.js';

function fixture() {
  return {
    getAgent: vi.fn(() => ({ defaultModelId: ' agent-model ' })),
    getTeam: vi.fn(() => ({ coordinatorAgentId: 'leader', members: [{ agentId: 'member' }] })),
  };
}
it('uses a trimmed direct model target without reading the agent directory', () => {
  const ports = fixture();
  for (const track of ['model', undefined, ''])
    expect(resolveConversationModelId({ track, targetRef: ' direct ' }, ports)).toBe('direct');
  expect(ports.getAgent).not.toHaveBeenCalled();
  expect(ports.getTeam).not.toHaveBeenCalled();
});
it('reads the current agent default without caching it', () => {
  const ports = fixture();
  expect(resolveConversationModelId({ track: 'agent', targetRef: ' agent ' }, ports)).toBe(
    'agent-model',
  );
  ports.getAgent.mockReturnValue({ defaultModelId: 'changed' });
  expect(resolveConversationModelId({ track: 'agent', targetRef: 'agent' }, ports)).toBe('changed');
  expect(ports.getAgent).toHaveBeenCalledWith('agent');
});
it('prefers the coordinator and reads the first member only when its model is absent', () => {
  const calls: string[] = [];
  let coordinatorModel = 'primary';
  const ports: ConversationModelRoutingPorts = {
    ...fixture(),
    getAgent: (id) => {
      calls.push(id);
      return { defaultModelId: id === 'leader' ? coordinatorModel : 'member-model' };
    },
  };
  expect(resolveConversationModelId({ track: 'team', targetRef: 'team' }, ports)).toBe('primary');
  expect(calls).toEqual(['leader']);
  coordinatorModel = ' ';
  calls.length = 0;
  expect(resolveConversationModelId({ track: 'team', targetRef: 'team' }, ports)).toBe(
    'member-model',
  );
  expect(calls).toEqual(['leader', 'member']);
});
it('does not invent a model for missing directories, empty targets or unknown tracks', () => {
  const ports = { getAgent: vi.fn(() => undefined), getTeam: vi.fn(() => undefined) };
  for (const track of ['agent', 'team', 'unknown'])
    expect(resolveConversationModelId({ track, targetRef: 'missing' }, ports)).toBeUndefined();
  ports.getAgent.mockClear();
  ports.getTeam.mockClear();
  expect(resolveConversationModelId({ track: 'agent', targetRef: ' ' }, ports)).toBeUndefined();
  expect(ports.getAgent).not.toHaveBeenCalled();
  expect(ports.getTeam).not.toHaveBeenCalled();
});
