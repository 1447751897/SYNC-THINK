import type { ReactNode } from 'react';

declare global {
  interface Window {
    __syncThinkShellChunks?: Readonly<Record<string, string>>;
  }
}

let retrySequence = 0;

export function shellChunkRetryUrl(entry: string, attempt: number): string | undefined {
  const path = window.__syncThinkShellChunks?.[entry];
  if (!path || !/^\.\/chunks\/[A-Za-z0-9_-]+\.js$/.test(path)) return undefined;
  const url = new URL(path, document.baseURI);
  url.searchParams.set('shellRetry', `${attempt}-${++retrySequence}`);
  return url.href;
}

export async function loadShellPanel<Props extends object>(
  load: () => Promise<{ default: (props: Props) => ReactNode }>,
  entry: string | undefined,
  attempt: number,
): Promise<{ default: (props: Props) => ReactNode }> {
  const url = entry && attempt > 0 ? shellChunkRetryUrl(entry, attempt) : undefined;
  if (!url) return load();
  const module = await import(url);
  const panel: unknown = module[entry!];
  if (typeof panel !== 'function') throw new Error('shell.panel.invalid_export');
  return { default: panel as (props: Props) => ReactNode };
}
