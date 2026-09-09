/**
 * Preview partitions.
 *
 * Mirrors NewMax: every preview component owns a throwaway in-memory partition
 * (`newmax-visualization-<random>`), so previews never share cookies, storage
 * or service workers with the embedded browser. The prefix is the main
 * process's allow-list key for attaching the guest preload
 * (see will-attach-webview in apps/desktop/src/main/index.ts) — keep the two in
 * sync.
 */

export const VISUALIZATION_PARTITION_PREFIX = 'sync-think-visualization-';

function randomSuffix(): string {
  const cryptoApi = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID().replace(/-/g, '');
  }
  // jsdom / older runtimes: a partition name only needs to be unique enough to
  // isolate storage, and it never leaves the local process.
  const chunk = () => Math.floor(Math.random() * 0x1_0000_0000).toString(16);
  return `${chunk()}${chunk()}`;
}

export function createVisualizationPartition(): string {
  return `${VISUALIZATION_PARTITION_PREFIX}${randomSuffix()}`;
}
