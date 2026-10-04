import { createHash } from 'node:crypto';
import type { AutomationAcceptanceChecks } from '@sync-think/shared';
import { dateString } from '@sync-think/shared/task-schedule';
/** Frozen trigger date, never the recovery machine's current day. */
export function automationExpectedLocalDate(firedAt: string, timeZone: string): string {
  return dateString(timeZone, new Date(firedAt));
}
export function automationAcceptanceContractHash(
  checks: AutomationAcceptanceChecks | undefined,
  firedAt: string,
  timeZone: string,
): string | undefined {
  if (!checks) return undefined;
  return createHash('sha256')
    .update(
      JSON.stringify({
        minimumRows: checks.minimumRows,
        requiredColumns: checks.requiredColumns,
        dateColumn: checks.dateColumn,
        sourceUrlColumn: checks.sourceUrlColumn,
        minimumSlides: checks.minimumSlides,
        expectedLocalDate: automationExpectedLocalDate(firedAt, timeZone),
      }),
    )
    .digest('hex');
}
