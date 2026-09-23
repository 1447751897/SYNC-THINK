export function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(Math.round(value));
}

export function formatCompactDuration(ms?: number): string | undefined {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1_000) return `${Math.max(1, Math.round(ms))}ms`;
  const totalSeconds = Math.round(ms / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function formatCompactRunMetrics(options: {
  durationMs?: number;
  tokensIn?: number;
  tokensOut?: number;
}): string | undefined {
  const duration = formatCompactDuration(options.durationMs);
  const totalTokens =
    options.tokensIn !== undefined || options.tokensOut !== undefined
      ? (options.tokensIn ?? 0) + (options.tokensOut ?? 0)
      : undefined;
  const tokens = totalTokens !== undefined ? formatCompactCount(totalTokens) : undefined;
  if (duration && tokens) return `${duration} · ${tokens}`;
  return duration ?? tokens;
}

export function formatMessageClock(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatMessageAbsoluteTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatRunModelLabel(options: {
  providerModelId?: string;
  modelId?: string;
  catalogName?: string;
}): string | undefined {
  const catalog = options.catalogName?.trim();
  if (catalog) return catalog;
  const provider = options.providerModelId?.trim();
  if (provider) {
    return provider.includes('/') ? provider.slice(provider.lastIndexOf('/') + 1) : provider;
  }
  return options.modelId?.trim() || undefined;
}
