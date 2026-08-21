/** Desktop is a client of the execution owner, not the owner itself. */
export type DesktopShutdownReason = 'desktop-exit' | 'update-install' | 'background-stop';

export interface DesktopShutdownPlan {
  disconnectClient: true;
  stopRuntime: boolean;
  stopDaemon: boolean;
}

export interface DesktopShutdownActions {
  stopDaemon(): Promise<void>;
  stopRuntime(): Promise<void>;
}

export function planDesktopShutdown(reason: DesktopShutdownReason): DesktopShutdownPlan {
  if (reason === 'desktop-exit') {
    return { disconnectClient: true, stopRuntime: false, stopDaemon: false };
  }
  return { disconnectClient: true, stopRuntime: true, stopDaemon: true };
}

/**
 * Stop the execution owner in ownership order. The daemon owns the Runtime, so
 * it must receive the graceful stop first and be allowed to drain/close its
 * child. Desktop only performs the Runtime stop afterwards as a bounded orphan
 * fallback. Running both operations concurrently can kill the daemon halfway
 * through its own cleanup and leave Runtime/Codex children behind.
 */
export async function executeDesktopShutdownPlan(
  plan: DesktopShutdownPlan,
  actions: DesktopShutdownActions,
): Promise<void> {
  const errors: unknown[] = [];
  if (plan.stopDaemon) {
    try {
      await actions.stopDaemon();
    } catch (error) {
      errors.push(error);
    }
  }
  if (plan.stopRuntime) {
    try {
      await actions.stopRuntime();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1)
    throw new AggregateError(errors, 'desktop execution owner shutdown failed');
}
