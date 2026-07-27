import type { RunProcessView } from '@sync-think/protocol';

/**
 * Replace only the process snapshot for the addressed run. Other run entries
 * and their object identities remain untouched, which keeps historical cards
 * from re-rendering while the active run streams tool updates.
 */
export function updateRunProcessMap(
  previous: ReadonlyMap<string, RunProcessView>,
  process: RunProcessView,
): Map<string, RunProcessView> {
  if (previous.get(process.runId) === process) return previous as Map<string, RunProcessView>;
  const next = new Map(previous);
  next.set(process.runId, process);
  return next;
}
