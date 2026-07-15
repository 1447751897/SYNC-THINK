/** Product policy for the real-use evidence required to close M1. */
export const M1_DOGFOOD_REQUIRED_DAYS = 1;

/** Keep projector fixtures configurable while sharing one product default. */
export function resolveM1DogfoodRequiredDays(value?: number | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.trunc(value);
    if (normalized > 0) return normalized;
  }
  return M1_DOGFOOD_REQUIRED_DAYS;
}
