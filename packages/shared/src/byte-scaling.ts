export const BINARY_BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

export interface ScaledBinaryBytes {
  value: number;
  unitIndex: number;
}

export function scaleBinaryBytes(
  bytes: number,
  maximumUnitIndex: number = BINARY_BYTE_UNITS.length - 1,
): ScaledBinaryBytes {
  const maximum = Math.max(
    0,
    Math.min(BINARY_BYTE_UNITS.length - 1, Math.trunc(maximumUnitIndex)),
  );
  if (bytes < 1024 || maximum === 0) return { value: bytes, unitIndex: 0 };

  let value = bytes;
  let unitIndex = 0;
  while (unitIndex < maximum) {
    value /= 1024;
    unitIndex += 1;
    if (value < 1024) break;
  }
  return { value, unitIndex };
}
