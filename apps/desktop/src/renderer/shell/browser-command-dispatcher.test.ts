import { describe, expect, it, vi } from 'vitest';
import type { Event } from '@sync-think/shared';
import { createBrowserCommandDispatcher } from './browser-command-dispatcher.js';

function request(id = 'live'): Event {
  return {
    id: id as Event['id'],
    workspaceId: 'workspace' as Event['workspaceId'],
    category: 'tool',
    type: 'browser.command_requested',
    occurredAt: new Date().toISOString(),
    sequence: 4,
    payload: {
      requestId: id,
      ownerId: 'task-a',
      action: 'browser_open',
      args: { url: 'https://example.com/' },
    },
  } as Event;
}

describe('live browser dispatcher', () => {
  it('opens and executes once without a ChatView or animation frame and uses the owning workspace', async () => {
    const order: string[] = [];
    const execute = vi.fn(async () => {
      order.push('execute');
      return { ok: true };
    });
    const submit = vi.fn(async () => {
      order.push('reply');
    });
    const dispatch = createBrowserCommandDispatcher({
      open: (url, workspace) => {
        expect(url).toBe('https://example.com/');
        expect(workspace).toBe('workspace');
        order.push('open');
      },
      projectFolder: () => 'D:/project',
      execute,
      submit,
    });
    const event = request();
    await Promise.all([dispatch(event), dispatch(event)]);
    expect(order).toEqual(['open', 'execute', 'reply']);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'task-a', projectFolder: 'D:/project' }),
    );
    expect(submit).toHaveBeenCalledWith({ requestId: 'live', ok: true });
  });

  it('rejects expired deliveries without executing a late click', async () => {
    const execute = vi.fn();
    const submit = vi.fn(async () => {});
    const dispatch = createBrowserCommandDispatcher({
      open: vi.fn(),
      projectFolder: () => undefined,
      execute,
      submit,
    });
    await dispatch({ ...request(), occurredAt: new Date(Date.now() - 60_000).toISOString() });
    expect(execute).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining('过期') }),
    );
  });

  it('returns routing failures immediately and ignores durable audit events', async () => {
    const execute = vi.fn();
    const submit = vi.fn(async () => {});
    const dispatch = createBrowserCommandDispatcher({
      open: () => {
        throw new Error('workspace closed');
      },
      projectFolder: () => undefined,
      execute,
      submit,
    });
    await dispatch({ ...request(), type: 'browser.command.started' });
    expect(submit).not.toHaveBeenCalled();
    await dispatch(request());
    expect(execute).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith({
      requestId: 'live',
      ok: false,
      error: 'workspace closed',
    });
  });
});
