import type { ScheduledTask } from '@sync-think/shared';
import { computeNextRunAt, initialNextRunAt } from '../task-scheduler.js';
import type { TimerHandle, TimerRegistrar } from './core.js';

const MAX_TIMEOUT_MS = 2_147_000_000;

export interface RuleAwareTimerOptions {
  now?: () => Date;
}

/**
 * Registers one timer per task using the task's persisted nextRunAt. Recurring
 * rules reschedule themselves after each callback; the callback still goes
 * through daemon fireTask, which owns due/catch-up/concurrency decisions.
 */
export function createRuleAwareTimerRegistrar(
  options: RuleAwareTimerOptions = {},
): TimerRegistrar {
  const now = options.now ?? (() => new Date());

  return {
    registerTimer(_taskId: string, fire: () => void, task?: ScheduledTask): TimerHandle {
      if (!task) {
        return { cancel: () => {} };
      }

      let cancelled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const schedule = (at: number | undefined): void => {
        if (cancelled || at === undefined || !Number.isFinite(at)) return;
        const delay = Math.max(0, at - now().getTime());
        const wait = Math.min(delay, MAX_TIMEOUT_MS);
        timeout = setTimeout(() => {
          if (cancelled) return;
          if (delay > MAX_TIMEOUT_MS) {
            schedule(at);
            return;
          }
          fire();
          if (task.rule.kind === 'at') return;
          const next = computeNextRunAt(task, now().toISOString(), now());
          schedule(next ? Date.parse(next) : undefined);
        }, wait);
        const maybeUnref = timeout as ReturnType<typeof setTimeout> & { unref?: () => void };
        maybeUnref.unref?.();
      };

      const initial = task.nextRunAt
        ? Date.parse(task.nextRunAt)
        : (() => {
            const computed = initialNextRunAt(task, now());
            return computed ? Date.parse(computed) : undefined;
          })();
      schedule(initial);

      return {
        cancel: () => {
          cancelled = true;
          if (timeout !== undefined) clearTimeout(timeout);
        },
      };
    },
    unregisterTimer: () => {},
  };
}
