import type { ManagedKernelUpdateId } from '../../kernel-update-contract.js';

export const BETA_INSTALLABLE_KERNEL_IDS = ['codex', 'claude-code'] as const satisfies readonly ManagedKernelUpdateId[];

export function isKernelInstallOffered(kernelId: string): boolean {
  return (BETA_INSTALLABLE_KERNEL_IDS as readonly string[]).includes(kernelId);
}

export function visibleManagedKernelItems<T extends { kernelId: string }>(items: readonly T[]): T[] {
  return items.filter((item) => isKernelInstallOffered(item.kernelId));
}

export function hasUsableModelProvider(
  providers: readonly {
    enabled?: boolean;
    credentials?: readonly { hasSecret?: boolean }[];
    models?: readonly unknown[];
  }[],
): boolean {
  return providers.some(
    (provider) =>
      provider.enabled !== false &&
      ((provider.credentials ?? []).some((credential) => credential.hasSecret === true) ||
        (provider.models?.length ?? 0) > 0),
  );
}
