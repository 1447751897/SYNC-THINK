import { describe, expect, it } from 'vitest';
import { decodeFrames, type Frame, type GoalStatus } from '@sync-think/protocol';
import { Runtime } from './runtime.js';
import { KernelExecutionUnavailableError } from './kernel/registry.js';

function fixture() {
  const runtime = new Runtime({ installId: 'pi-execution-admission', allowNoToken: true });
  const frames: Frame[] = [];
  const socket = {
    write: (data: Buffer) => {
      frames.push(...decodeFrames(data).frames);
      return true;
    },
  };
  const internal = runtime as unknown as {
    activeGoals: Map<string, GoalStatus>;
    handleGoalSet(socket: object, frame: Frame): void;
    handleGoalResume(socket: object, frame: Frame): void;
    prepareRunBinding(input: object): unknown;
  };
  return { internal, frames, socket };
}

describe('kernel execution admission', () => {
  it('rejects Pi before preparing context or a run', () => {
    const { internal } = fixture();
    expect(() =>
      internal.prepareRunBinding({
        runId: 'run',
        threadId: 'thread',
        userText: 'work',
        kernelId: 'pi',
      }),
    ).toThrow(KernelExecutionUnavailableError);
  });
  it('does not activate a goal for Pi', () => {
    const { internal, frames, socket } = fixture();
    internal.handleGoalSet(socket, {
      id: 'set',
      kind: 'request',
      type: 'goal.set',
      payload: { conversationId: 'conversation', condition: 'finish', kernelId: 'pi' },
    });
    expect(frames[0]?.error).toMatchObject({ code: 'protocol.unexpected_request' });
    expect(internal.activeGoals.size).toBe(0);
  });
  it.each(['paused', 'blocked'] as const)(
    'preserves a %s goal when its saved Pi selection is resumed',
    (status) => {
      const { internal, frames, socket } = fixture();
      const goal: GoalStatus = {
        conversationId: 'conversation',
        condition: 'finish',
        status,
        kernelId: 'pi',
        startedAt: '2026-09-05T00:00:00.000Z',
        turnCount: 2,
        tokensIn: 10,
        tokensOut: 10,
        blockedStreak: 0,
      };
      internal.activeGoals.set(goal.conversationId, goal);
      internal.handleGoalResume(socket, {
        id: 'resume',
        kind: 'request',
        type: 'goal.resume',
        payload: { conversationId: goal.conversationId },
      });
      expect(frames[0]?.error).toMatchObject({ code: 'protocol.unexpected_request' });
      expect(internal.activeGoals.get(goal.conversationId)).toBe(goal);
    },
  );
});
