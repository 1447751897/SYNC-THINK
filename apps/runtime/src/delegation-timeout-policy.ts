export const BACKGROUND_DELEGATION_IDLE_SECONDS = 1_800;
/**
 * A live child normally emits a projection whenever its run state changes.
 * This shorter watchdog only probes the authoritative record when that push
 * stream goes quiet; it does not replace the absolute or idle deadlines.
 */
export const DELEGATION_STATUS_NOTIFICATION_TIMEOUT_SECONDS = 120;

export function resolveDelegationStatusNotificationTimeoutSeconds(
  background: boolean,
  requested: unknown,
): number {
  if (!background || typeof requested !== 'number' || !Number.isFinite(requested)) {
    return DELEGATION_STATUS_NOTIFICATION_TIMEOUT_SECONDS;
  }
  return Math.min(900, Math.max(15, Math.trunc(requested)));
}

/** Keep the existing agent_run and agent_delegate timeout contracts. */
export function resolveDelegationTimeoutSeconds(background: boolean, requested: unknown): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return background ? 7_200 : 300;
  return Math.min(background ? 7_200 : 3_600, Math.max(background ? 60 : 1, Math.trunc(requested)));
}
