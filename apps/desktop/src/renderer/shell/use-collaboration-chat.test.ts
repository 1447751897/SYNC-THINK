import { COLLABORATION_EXECUTION_VERSION } from '@sync-think/shared';
/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { CollaborationSnapshot } from '@sync-think/shared';
import { useCollaborationChat } from './use-collaboration-chat.js';
afterEach(cleanup);
it('reconciles a timed-out send from its durable receipt without resending', async () => {
  const snapshot = { conversation: { id: 'c' }, revision: 1, receipts: {} } as CollaborationSnapshot;
  const accepted = { ...snapshot, revision: 2, receipts: { 'send:receipt': 'message-id' } };
  let sent = false;
  const collaboration = vi.fn(async (request) => {
    if (request.action === 'send') { sent = true; throw new Error('Runtime request timed out: collaboration.command'); }
    return { snapshot: sent ? accepted : snapshot, executionVersion: COLLABORATION_EXECUTION_VERSION };
  });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { collaboration, onEvent: () => () => {} } } });
  const view = renderHook(() => useCollaborationChat('c'));
  await waitFor(() => expect(view.result.current.snapshot).toBe(snapshot));
  await act(async () => {
    const result = await view.result.current.command({ action: 'send', conversationId: 'c', clientRequestId: 'receipt', text: '你好' });
    expect(result.snapshot).toBe(accepted);
  });
  expect(view.result.current.error).toBe('');
  expect(collaboration.mock.calls.filter(([r]) => r.action === 'send')).toHaveLength(1);
  expect(view.result.current.snapshot).toBe(accepted);
});

it('warns when the renderer is connected to a pre-workflow daemon', async () => {
  const snapshot = { conversation: { id: 'c' }, revision: 1, receipts: {} } as CollaborationSnapshot;
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { collaboration: async () => ({ snapshot }), onEvent: () => () => {} } } });
  const view = renderHook(() => useCollaborationChat('c'));
  await waitFor(() => expect(view.result.current.error).toContain('旧版协作引擎'));
  expect(view.result.current.snapshot).toBe(snapshot);
});


it('ignores an older read including its engine-version warning after a newer command', async () => {
  const initial = { conversation: { id: 'c' }, revision: 1, receipts: {} } as CollaborationSnapshot;
  const latest = { ...initial, revision: 2 };
  let finish!: (value: object) => void;
  const collaboration = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ snapshot: latest, executionVersion: COLLABORATION_EXECUTION_VERSION });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { collaboration, onEvent: () => () => {} } } });
  const view = renderHook(() => useCollaborationChat('c'));
  await act(async () => { await view.result.current.command({ action: 'get', conversationId: 'c' }); });
  await act(async () => { finish({ snapshot: initial }); });
  expect(view.result.current.snapshot).toBe(latest);
  expect(view.result.current.error).toBe('');
});

it('keeps its revision high-water mark when the conversation becomes active again', async () => {
  const latest = { conversation: { id: 'c' }, revision: 5, receipts: {} } as CollaborationSnapshot;
  const collaboration = vi.fn().mockResolvedValueOnce({ snapshot: latest, executionVersion: COLLABORATION_EXECUTION_VERSION })
    .mockResolvedValue({ snapshot: { ...latest, revision: 1 }, executionVersion: COLLABORATION_EXECUTION_VERSION });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { collaboration, onEvent: () => () => {} } } });
  const view = renderHook(({ active }) => useCollaborationChat('c', active), { initialProps: { active: true } });
  await waitFor(() => expect(view.result.current.snapshot).toBe(latest));
  view.rerender({ active: false });
  await act(async () => {});
  view.rerender({ active: true });
  await act(async () => {});
  expect(view.result.current.snapshot).toBe(latest);
});

it('does not surface a previous conversation send failure after navigation', async () => {
  let rejectSend!: (cause: Error) => void;
  const collaboration = vi.fn(request => request.action === 'send'
    ? new Promise((_resolve, reject) => { rejectSend = reject; })
    : Promise.resolve({ snapshot: { conversation: { id: request.conversationId }, revision: 1, receipts: {} }, executionVersion: COLLABORATION_EXECUTION_VERSION }));
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { collaboration, onEvent: () => () => {} } } });
  const view = renderHook(({ id }) => useCollaborationChat(id), { initialProps: { id: 'c' } });
  await waitFor(() => expect(view.result.current.snapshot?.conversation.id).toBe('c'));
  let command!: Promise<unknown>;
  act(() => { command = view.result.current.command({ action: 'send', conversationId: 'c', clientRequestId: 'r', text: 'hello' }).catch(error => error); });
  view.rerender({ id: 'next' });
  await waitFor(() => expect(view.result.current.snapshot?.conversation.id).toBe('next'));
  await act(async () => { rejectSend(new Error('old send failed')); await command; });
  expect(view.result.current.error).toBe('');
});

it('hides the old conversation warning while the next snapshot is loading', async () => {
  const collaboration = vi.fn().mockResolvedValueOnce({ snapshot: { conversation: { id: 'c' }, revision: 1, receipts: {} } })
    .mockImplementation(() => new Promise(() => {}));
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { collaboration, onEvent: () => () => {} } } });
  const view = renderHook(({ id }) => useCollaborationChat(id), { initialProps: { id: 'c' } });
  await waitFor(() => expect(view.result.current.error).toContain('旧版协作引擎'));
  view.rerender({ id: 'next' });
  expect(view.result.current.snapshot).toBeUndefined();
  expect(view.result.current.error).toBe('');
});

it('rejects nested-team commands on a v2 host instead of silently ignoring the new fields',async()=>{
 const snapshot={conversation:{id:'c'},revision:1,receipts:{}} as CollaborationSnapshot;
 const collaboration=vi.fn().mockResolvedValue({snapshot,executionVersion:2});
 Object.defineProperty(window,'syncThink',{configurable:true,value:{runtime:{collaboration,onEvent:()=>()=>{}}}});
 const view=renderHook(()=>useCollaborationChat('c'));await waitFor(()=>expect(view.result.current.snapshot).toBe(snapshot));
 await act(async()=>{await expect(view.result.current.command({action:'members',conversationId:'c',addTeamIds:['team-1'],expectedTopologyRevision:0})).rejects.toThrow('重启守护进程');});
 expect(collaboration.mock.calls.some(([request])=>request.action==='members')).toBe(false);
});


it('blocks message and policy changes on a version-4 daemon before sending a mutation', async () => {
  const snapshot = { conversation: { id: 'c' }, revision: 1, receipts: {} } as CollaborationSnapshot;
  const collaboration = vi.fn().mockResolvedValue({ snapshot, executionVersion: 4 });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { collaboration, onEvent: () => () => {} } } });
  const view = renderHook(() => useCollaborationChat('c'));
  await waitFor(() => expect(view.result.current.snapshot).toBe(snapshot));
  await act(async () => {
    await expect(view.result.current.command({ action: 'send', conversationId: 'c', clientRequestId: 'r', text: 'hello' })).rejects.toThrow('新版群内通信');
    await expect(view.result.current.command({ action: 'policy', conversationId: 'c', policy: { allowGroupMessages: true } })).rejects.toThrow('新版群内通信');
  });
  expect(collaboration.mock.calls.every(([command]) => command.action === 'get')).toBe(true);
});

it.each(['room-resume', 'room-brief', 'start-workflow'] as const)('reconciles a timed-out %s without blindly replaying it', async action => {
  const snapshot = { conversation: { id: 'c' }, revision: 1, receipts: {} } as CollaborationSnapshot;
  const key = action === 'start-workflow' ? 'dispatch:room-start:request' : action + ':request';
  const accepted = { ...snapshot, revision: 2, receipts: { [key]: 'durable' } };
  let committed = false;
  const collaboration = vi.fn(async request => {
    if (request.action === action) { committed = true; throw Error('Runtime request timed out'); }
    return { snapshot: committed ? accepted : snapshot, executionVersion: COLLABORATION_EXECUTION_VERSION };
  });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { collaboration, onEvent: () => () => {} } } });
  const view = renderHook(() => useCollaborationChat('c'));
  await waitFor(() => expect(view.result.current.snapshot).toBe(snapshot));
  await act(async () => { await view.result.current.command({ action, conversationId: 'c', clientRequestId: 'request', goal: 'new', expectedGoalRevision: 1 }); });
  expect(view.result.current.error).toBe('');
  expect(view.result.current.snapshot).toBe(accepted);
  expect(collaboration.mock.calls.filter(([r]) => r.action === action)).toHaveLength(1);
});


it('does not mistake an explicit idempotency conflict for an accepted command merely because a receipt exists', async () => {
  const snapshot = { conversation: { id: 'c', workspaceId: 'w', kind: 'group', title: 'test', coordinatorMemberId: 'leader', createdAt: '', policy: { allowPeerDirect: false, maxConcurrent: 3, maxMessageHops: 6, maxAutoMessages: 12, taskTimeoutSeconds: 120, statusTimeoutSeconds: 120 } }, revision: 1, receipts: { 'room-brief:reused': 'older command receipt' }, members: [], messages: [], deliveries: [], tasks: [], attempts: [] } as CollaborationSnapshot;
  const collaboration = vi.fn(async request => { if (request.action !== 'get') throw Error('collaboration.idempotency_conflict'); return { snapshot, executionVersion: COLLABORATION_EXECUTION_VERSION }; });
  Object.defineProperty(window, 'syncThink', { configurable: true, value: { runtime: { collaboration, onEvent: () => () => {} } } });
  const view = renderHook(() => useCollaborationChat('c'));
  await waitFor(() => expect(view.result.current.snapshot).toBe(snapshot));
  await act(async () => { await expect(view.result.current.command({ action: 'room-brief', conversationId: 'c', clientRequestId: 'reused', goal: 'different command', expectedGoalRevision: 1 })).rejects.toThrow('idempotency_conflict'); });
  expect(collaboration.mock.calls.filter(([r]) => r.action === 'get')).toHaveLength(1);
  expect(view.result.current.error).toContain('idempotency_conflict');
});
