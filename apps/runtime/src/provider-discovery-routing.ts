import type { ProtocolFamily } from '@sync-think/shared';
import type { DemoProvider } from './demo-run.js';

export type DiscoveryAdapterCatalog = Partial<Record<ProtocolFamily, DemoProvider>>;

export function resolveProviderDiscoveryAdapter(
  protocol: ProtocolFamily,
  adaptersByProtocol: DiscoveryAdapterCatalog,
  fallback?: DemoProvider,
): DemoProvider | undefined {
  return adaptersByProtocol[protocol] ?? fallback;
}
