/** @vitest-environment jsdom */
import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueuedComposeRequest, readQueuedComposeRequests, writeQueuedComposeRequests } from './compose-request-queue.js';
import { useComposeRequestQueue } from './use-compose-request-queue.js';

function request(conversationId = 'A', id = 'first') {
  return createQueuedComposeRequest({
    conversationId, text: id, attachments: [{ path: 'image:1', name: 'one.png', kind: 'image', previewUrl: 'data:image/png;base64,AA==' }],
    modelOverride: 'old-model', kernelOverride: 'codex', reasoningEffort: 'high', networkEnabled: false, skillVersionIds: ['skill-v1'],
  }, { id, createdAt: '2026-09-19T00:00:00Z' });
}
function deferred() {
  let resolve!: (value: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function props(sendUserText = vi.fn().mockResolvedValue(true)) {
  return { conversationId: 'A', modelOverride: 'selected-model', runIsActive: false, waitingForThread: false, sendUserText };
}
beforeEach(() => window.localStorage.clear());
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('useComposeRequestQueue', () => {
  it('waits for the thread and sends FIFO with frozen attachments/options but the current model', async () => {
    writeQueuedComposeRequests('A', [request(), request('A', 'second')]);
    const input = { ...props(), waitingForThread: true };
    const view = renderHook(useComposeRequestQueue, { initialProps: input });
    expect(input.sendUserText).not.toHaveBeenCalled();
    view.rerender({ ...input, waitingForThread: false });
    await waitFor(() => expect(view.result.current.queuedComposeRequests).toHaveLength(0));
    expect(input.sendUserText.mock.calls.map(([text]) => text)).toEqual(['first', 'second']);
    expect(input.sendUserText).toHaveBeenNthCalledWith(1, 'first', [expect.objectContaining({ name: 'one.png', url: 'data:image/png;base64,AA==' })], {
      modelOverride: 'selected-model', kernelOverride: 'codex', reasoningEffort: 'high', networkEnabled: false, skillVersionIds: ['skill-v1'],
    });
    expect(readQueuedComposeRequests('A')).toEqual([]);
  });

  it('settles the original queue in storage when the user is viewing another conversation', async () => {
    const pending = deferred();
    const input = props(vi.fn().mockReturnValue(pending.promise));
    writeQueuedComposeRequests('A', [request()]);
    writeQueuedComposeRequests('B', [request('B', 'other')]);
    const view = renderHook(useComposeRequestQueue, { initialProps: input });
    await waitFor(() => expect(input.sendUserText).toHaveBeenCalledTimes(1));
    view.rerender({ ...input, conversationId: 'B', runIsActive: true });
    await act(async () => { pending.resolve(true); await pending.promise; });
    expect(readQueuedComposeRequests('A')).toEqual([]);
    expect(view.result.current.queuedComposeRequests.map((item) => item.id)).toEqual(['other']);
    expect(readQueuedComposeRequests('B')).toHaveLength(1);
  });

  it('holds the per-conversation lock across navigation and rejects deletion while sending', async () => {
    const pending = deferred();
    const input = props(vi.fn().mockReturnValue(pending.promise));
    writeQueuedComposeRequests('A', [request()]);
    const view = renderHook(useComposeRequestQueue, { initialProps: input });
    await waitFor(() => expect(input.sendUserText).toHaveBeenCalledTimes(1));
    act(() => view.result.current.handleDeleteQueuedComposeRequest('first'));
    expect(readQueuedComposeRequests('A')).toHaveLength(1);
    view.rerender({ ...input, conversationId: 'B' });
    view.rerender(input);
    expect(view.result.current.dispatchingQueuedRequestId).toBe('first');
    await act(async () => { pending.resolve(true); await pending.promise; });
    await waitFor(() => expect(view.result.current.queuedComposeRequests).toEqual([]));
    expect(input.sendUserText).toHaveBeenCalledTimes(1);
  });

  it('blocks an unsuccessful automatic send until an explicit retry', async () => {
    const input = props(vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true));
    writeQueuedComposeRequests('A', [request()]);
    const view = renderHook(useComposeRequestQueue, { initialProps: input });
    await waitFor(() => expect(view.result.current.blockedQueuedRequestId).toBe('first'));
    view.rerender({ ...input, modelOverride: 'new-model' });
    expect(input.sendUserText).toHaveBeenCalledTimes(1);
    expect(readQueuedComposeRequests('A')).toHaveLength(1);
    act(() => view.result.current.handleInterjectQueuedComposeRequest('first'));
    await waitFor(() => expect(view.result.current.queuedComposeRequests).toEqual([]));
    expect(input.sendUserText).toHaveBeenLastCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ modelOverride: 'new-model' }));
  });

  it('keeps failed sends isolated and clears the block when that draft is deleted', async () => {
    const pending = deferred();
    const input = props(vi.fn().mockReturnValue(pending.promise));
    writeQueuedComposeRequests('A', [request()]);
    const view = renderHook(useComposeRequestQueue, { initialProps: input });
    await waitFor(() => expect(input.sendUserText).toHaveBeenCalledTimes(1));
    view.rerender({ ...input, conversationId: 'B' });
    await act(async () => { pending.reject(new Error('offline')); await pending.promise.catch(() => undefined); });
    expect(view.result.current.queuedRequestDispatchError).toBeUndefined();
    view.rerender(input);
    expect(view.result.current.blockedQueuedRequestId).toBe('first');
    act(() => view.result.current.handleDeleteQueuedComposeRequest('first'));
    expect(view.result.current.queuedRequestDispatchError).toBeUndefined();
    expect(readQueuedComposeRequests('A')).toEqual([]);
  });

  it('does not duplicate automatic dispatch during StrictMode effect replay', async () => {
    const input = props();
    writeQueuedComposeRequests('A', [request()]);
    const view = renderHook(useComposeRequestQueue, {
      initialProps: input,
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    });
    await waitFor(() => expect(view.result.current.queuedComposeRequests).toEqual([]));
    expect(input.sendUserText).toHaveBeenCalledTimes(1);
  });
});
