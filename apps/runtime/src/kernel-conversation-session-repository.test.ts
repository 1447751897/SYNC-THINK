import { describe, expect, it, vi } from 'vitest';
import { KernelConversationSessionRepository } from './kernel-conversation-session-repository.js';

function session(id = 'session-a') {
  return {
    version: 1 as const,
    sessionId: id,
    fingerprint: 'fingerprint-a',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
}

describe('KernelConversationSessionRepository', () => {
  it('loads and normalizes a durable session into the hot cache', () => {
    const get = vi.fn(() => ({
      value: {
        ...session(),
        workspaceRoot: '  D:/workspace  ',
        responseContinuationScopeId: '  scope-a  ',
        lastMessageSequence: 4,
      },
    }));
    const repository = new KernelConversationSessionRepository({ get, set: vi.fn() });

    expect(repository.load('kernel.session')).toEqual({
      ...session(),
      workspaceRoot: 'D:/workspace',
      responseContinuationScopeId: 'scope-a',
      lastMessageSequence: 4,
    });
    expect(repository.load('kernel.session')?.sessionId).toBe('session-a');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined,
    null,
    {},
    { ...session(), version: 2 },
    { ...session(), sessionId: ' ' },
    { ...session(), fingerprint: '' },
  ])('rejects an invalid durable session: %j', (value) => {
    const repository = new KernelConversationSessionRepository({
      get: () => ({ value }),
      set: vi.fn(),
    });

    expect(repository.load('kernel.session')).toBeUndefined();
  });

  it('persists a replacement and returns the previous session', () => {
    const set = vi.fn();
    const repository = new KernelConversationSessionRepository({
      get: () => ({ value: session('session-a') }),
      set,
    });
    const replacement = session('session-b');

    expect(repository.save('kernel.session', replacement)?.sessionId).toBe('session-a');
    expect(repository.load('kernel.session')).toBe(replacement);
    expect(set).toHaveBeenCalledWith('kernel.session', replacement);
  });

  it('removes only the expected session and persists the tombstone', () => {
    const set = vi.fn();
    const repository = new KernelConversationSessionRepository({
      get: () => ({ value: session('session-a') }),
      set,
    });

    expect(repository.remove('kernel.session', 'other')).toBeUndefined();
    expect(set).not.toHaveBeenCalled();
    expect(repository.remove('kernel.session', 'session-a')?.sessionId).toBe('session-a');
    expect(set).toHaveBeenCalledWith('kernel.session', null);
  });
});
