import type { ScheduledTask } from '@sync-think/shared';
import { computeNextRunAt, initialNextRunAt } from '../task-scheduler.js';
import { DEFAULT_CATCHUP_WINDOW_MS } from '../scheduler-core.js';
import type { TimerFireContext, TimerHandle, TimerRegistrar } from './core.js';

const MAX_TIMEOUT_MS = 2_147_000_000;

export interface RuleAwareTimerOptions {
  now?: () => Date;
}

/**
 * Registers one timer per task using the task's persisted nextRunAt. Recurring
 * rules reschedule themselves after each callback; the callback still goes
 * through daemon fireTask, which owns due/catch-up/concurrency decisions.
 */
export function createRuleAwareTimerRegistrar(options: RuleAwareTimerOptions = {}): TimerRegistrar {
  const now = options.now ?? (() => new Date());

  return {
    registerTimer(
      _taskId: string,
      fire: (context?: TimerFireContext) => void,
      task?: ScheduledTask,
    ): TimerHandle {
      if (!task) {
        return { cancel: () => {} };
      }

      let cancelled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const schedule = (at: number | undefined): void => {
        if (cancelled || at === undefined || !Number.isFinite(at)) return;
        const registeredAt = now().getTime();
        const delay = Math.max(0, at - registeredAt);
        const wait = Math.min(delay, MAX_TIMEOUT_MS);
        timeout = setTimeout(() => {
          if (cancelled) return;
          if (delay > MAX_TIMEOUT_MS) {
            schedule(at);
            return;
          }
          const due = new Date(at);
          const nextDeadline = computeNextRunAt(task, due.toISOString(), due);
          // A live timer may wake slightly late. Recover only if it was already
          // overdue at registration, missed an entire period, or slept >24h.
          const missedPeriod = nextDeadline && Date.parse(nextDeadline) <= now().getTime();
          fire({
            trigger:
              at < registeredAt || missedPeriod || now().getTime() - at > DEFAULT_CATCHUP_WINDOW_MS
                ? 'recovery'
                : 'timer',
            scheduledAt: due.toISOString(),
          });
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
