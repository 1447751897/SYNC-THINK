import type { GoalCommand, GoalCommandRequest, GoalCommandResponse } from '@sync-think/protocol';
import {
  parseGoalClearPayload,
  parseGoalGetPayload,
  parseGoalPausePayload,
  parseGoalResumePayload,
  parseGoalSetPayload,
} from '../goal-payloads.js';

export interface GoalHost<Event> {
  handle(channel: string, listener: (event: Event, value: unknown) => Promise<unknown>): void;
  assertSource(event: Event): void;
  ensureConnection(): Promise<unknown>;
  requestGoal<K extends GoalCommand>(
    command: K,
    payload: GoalCommandRequest<NoInfer<K>>,
  ): Promise<GoalCommandResponse<K>>;
}

export function registerGoalHandlers<Event>(host: GoalHost<Event>): void {
  host.handle('runtime:goal-set', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGoal('goal.set', parseGoalSetPayload(value));
  });

  host.handle('runtime:goal-get', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGoal('goal.get', parseGoalGetPayload(value));
  });

  host.handle('runtime:goal-clear', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGoal('goal.clear', parseGoalClearPayload(value));
  });

  host.handle('runtime:goal-pause', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGoal('goal.pause', parseGoalPausePayload(value));
  });

  host.handle('runtime:goal-resume', async (event, value) => {
    host.assertSource(event);
    await host.ensureConnection();
    return host.requestGoal('goal.resume', parseGoalResumePayload(value));
  });
}
