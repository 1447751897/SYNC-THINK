/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { GlobalAgent } from '@sync-think/shared';
import { AgentModelRepair } from './AgentModelRepair.js';
const agents = [{ id: 'a', name: '主策划', defaultModelId: 'deleted' }, { id: 'b', name: '架构师', defaultModelId: 'deleted' }, { id: 'c', name: '写手', defaultModelId: 'live' }, { id: 'd', name: '外部内核', defaultModelId: 'external-model', defaultKernelId: 'claude' }] as GlobalAgent[];
const models = [{ modelId: 'live', displayName: '可用模型', providerName: '服务商' }];
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'syncThink'); });
it('requires an explicit choice and updates only invalid native bindings, preserving all other fields', async () => {
  const updateGlobalAgent = vi.fn(async payload => ({ agent: { ...agents.find(a => a.id === payload.agentId), defaultModelId: payload.defaultModelId } }));
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { updateGlobalAgent } } });
  const onSaved = vi.fn(); render(<AgentModelRepair agents={agents} models={models} onSaved={onSaved} onSettings={vi.fn()} />);
  expect(screen.getByText('2 位智能体的模型已失效')).toBeTruthy();
  expect((screen.getByRole('button', { name: '应用到以上成员' }) as HTMLButtonElement).disabled).toBe(true);
  expect(updateGlobalAgent).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('替换失效模型'), { target: { value: 'live' } });
  fireEvent.click(screen.getByRole('button', { name: '应用到以上成员' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
  expect(updateGlobalAgent.mock.calls.map(([payload]) => payload)).toEqual([{ agentId: 'a', defaultModelId: 'live' }, { agentId: 'b', defaultModelId: 'live' }]);
});
it('does not report a false missing binding while model options are still loading', () => {
  render(<AgentModelRepair agents={agents} onSaved={vi.fn()} onSettings={vi.fn()} />);
  expect(screen.queryByLabelText('修复智能体模型')).toBeNull();
});
it('keeps the selection and exposes update errors instead of claiming success', async () => {
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { updateGlobalAgent: vi.fn().mockRejectedValue(new Error('连接断开')) } } });
  const onSaved = vi.fn(); render(<AgentModelRepair agents={agents} models={models} onSaved={onSaved} onSettings={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('替换失效模型'), { target: { value: 'live' } });
  fireEvent.click(screen.getByRole('button', { name: '应用到以上成员' }));
  expect((await screen.findByRole('alert')).textContent).toBe('连接断开');
  expect(onSaved).not.toHaveBeenCalled(); expect((screen.getByLabelText('替换失效模型') as HTMLSelectElement).value).toBe('live');
});
