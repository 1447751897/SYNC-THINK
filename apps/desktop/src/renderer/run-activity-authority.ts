import type { Event } from '@sync-think/shared';

/**
 * Runtime-owned reconciliation snapshot captured during connect/reconnect.
 *
 * Events at or before `throughSequence` are historical from the snapshot's
 * point of view. A historical `run.started` is active only when Runtime also
 * reports the same Run ID in `activeRunIds`.
 */
export interface RunActivityAuthority {
  throughSequence: number;
  activeRunIds: ReadonlySet<string>;
}

/**
 * Return true only for a historical run start that Runtime has explicitly
 * confirmed is no longer in flight. Starts without a Run ID retain the legacy
 * projection because there is no stable identity to reconcile safely.
 */
export function isHistoricalOrphanRunStart(
  event: Event,
  authority?: RunActivityAuthority,
): boolean {
  if (!authority || event.type !== 'run.started' || event.sequence > authority.throughSequence) {
    return false;
  }
  const runId = event.runId ? String(event.runId) : undefined;
  return Boolean(runId && !authority.activeRunIds.has(runId));
}
