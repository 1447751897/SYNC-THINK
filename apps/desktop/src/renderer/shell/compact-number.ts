function formatScale(
  value: number,
  divisor: number,
  fractionDigits: number,
  suffix: string,
): string {
  return `${(value / divisor).toFixed(fractionDigits)}${suffix}`;
}

export function formatCapabilityMetric(value: number): string {
  if (value < 1_000) return value.toLocaleString('zh-CN');
  return formatScale(value, 1_000, value >= 10_000 ? 0 : 1, 'k');
}

export function formatUsageTokenCount(value: number): string {
  if (value >= 1_000_000) return formatScale(value, 1_000_000, 1, 'M');
  if (value >= 1_000) return formatScale(value, 1_000, 1, 'k');
  return String(value);
}
