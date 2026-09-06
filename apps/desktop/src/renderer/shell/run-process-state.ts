import type { ExecutionProcessStep, ProcessStepStatus, RunProcessView } from '@sync-think/protocol';
import type { Event } from '@sync-think/shared';

const RUN_TERMINAL_EVENT_TYPES = new Set([
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.paused',
]);

export function collectRunProcessIds(input: {
  durableRunIds: Iterable<string>;
  transientRunId?: string;
  projectedActiveRunId?: string;
}): Set<string> {
  const runIds = new Set(input.durableRunIds);
  if (input.transientRunId) runIds.add(input.transientRunId);
  if (input.projectedActiveRunId) runIds.add(input.projectedActiveRunId);
  return runIds;
}

/**
 * A Runtime-owned process terminal is newer and more authoritative than a
 * reconnecting renderer's transient `streaming` bit. Keep the draft visible,
 * but settle it so clocks, spinners, and composer controls stop immediately.
 */
export function reconcileStreamingMessageProcessTerminal<
  T extends { runId?: string; streaming?: boolean },
>(message: T | null, process: RunProcessView | undefined): T | null {
  if (
    !message?.streaming ||
    !message.runId ||
    !process?.completedAt ||
    String(process.runId) !== String(message.runId)
  ) {
    return message;
  }
  return { ...message, streaming: false };
}

/**
 * Project the latest durable terminal boundary for every Run. Event sequence
 * is the authority because reconnect snapshots may replay an older process
 * projection after the terminal event has already been persisted.
 */
export function projectRunTerminalEvents(events: readonly Event[]): Map<string, Event> {
  const terminals = new Map<string, Event>();
  for (const event of events) {
    if (!event.runId || !RUN_TERMINAL_EVENT_TYPES.has(event.type)) continue;
    const runId = String(event.runId);
    const current = terminals.get(runId);
    if (!current || event.sequence > current.sequence) {
      terminals.set(runId, event);
    }
  }
  return terminals;
}

/**
 * Let a durable Run terminal boundary settle a stale process snapshot.
 */
export function reconcileRunProcessTerminal(
  process: RunProcessView,
  terminal: Event | undefined,
): RunProcessView {
  if (!terminal || String(terminal.runId ?? '') !== String(process.runId)) return process;

  const failed = terminal.type === 'run.failed' || terminal.type === 'run.cancelled';
  const terminalStepStatus: ProcessStepStatus = failed ? 'error' : 'done';
  const settleStep = (step: ExecutionProcessStep): ExecutionProcessStep =>
    step.status === 'running'
      ? {
          ...step,
          status: terminalStepStatus,
          completedAt: step.completedAt ?? terminal.occurredAt,
          occurredAt: terminal.occurredAt,
        }
      : step;
  const steps = process.steps.map(settleStep);
  const remaining = process.pages
    ? Math.max(0, process.pages.steps.total - process.doneCount - process.errorCount)
    : 0;
  const doneCount = process.pages
    ? process.doneCount + (failed ? 0 : remaining)
    : steps.filter((step) => step.status === 'done').length;
  const errorCount = process.pages
    ? process.errorCount + (failed ? remaining : 0)
    : steps.filter((step) => step.status === 'error').length;
  const startedAt = process.startedAt ? Date.parse(process.startedAt) : Number.NaN;
  const completedAt = Date.parse(terminal.occurredAt);
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt >= startedAt
      ? completedAt - startedAt
      : process.durationMs;

  return {
    ...process,
    steps,
    ...(process.latestStep ? { latestStep: settleStep(process.latestStep) } : {}),
    running: false,
    doneCount,
    errorCount,
    completedAt: terminal.occurredAt,
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

/**
 * Replace only the process snapshot for the addressed run. Other run entries
 * and their object identities remain untouched, which keeps historical cards
 * from re-rendering while the active run streams tool updates.
 */
export function updateRunProcessMap(
  previous: ReadonlyMap<string, RunProcessView>,
  process: RunProcessView | null | undefined,
): Map<string, RunProcessView> {
  // Older/partially restarted Runtime bridges may briefly return no snapshot
  // for a historical run. Keep the existing projection instead of crashing
  // the whole conversation surface while the durable message still renders.
  if (!process) return previous as Map<string, RunProcessView>;
  if (previous.get(process.runId) === process) return previous as Map<string, RunProcessView>;
  const next = new Map(previous);
  next.set(process.runId, process);
  return next;
}
