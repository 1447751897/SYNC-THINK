export interface PersistentComputerUseApp {
  field: 'app_id' | 'app';
  value: string;
}

export const COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY =
  'computer-use.approval-policy' as const;

export interface ComputerUseApprovalPolicySetting {
  version: 1;
  alwaysAllowedApps: PersistentComputerUseApp[];
}

export function normalizeComputerUseApprovalPolicySetting(
  value: unknown,
): ComputerUseApprovalPolicySetting {
  const rawApps =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { alwaysAllowedApps?: unknown }).alwaysAllowedApps
      : undefined;
  const unique = new Map<string, PersistentComputerUseApp>();
  if (Array.isArray(rawApps)) {
    for (const rawApp of rawApps) {
      if (!rawApp || typeof rawApp !== 'object' || Array.isArray(rawApp)) continue;
      const field = (rawApp as { field?: unknown }).field;
      const rawValue = (rawApp as { value?: unknown }).value;
      if ((field !== 'app_id' && field !== 'app') || typeof rawValue !== 'string') continue;
      const trimmed = rawValue.trim();
      if (!trimmed) continue;
      unique.set(`${field}\u0000${trimmed}`, { field, value: trimmed });
    }
  }
  return { version: 1, alwaysAllowedApps: [...unique.values()] };
}

export function removePersistentComputerUseApp(
  value: unknown,
  target: PersistentComputerUseApp,
): ComputerUseApprovalPolicySetting {
  const policy = normalizeComputerUseApprovalPolicySetting(value);
  const targetValue = target.value.trim();
  return {
    ...policy,
    alwaysAllowedApps: policy.alwaysAllowedApps.filter(
      (app) => app.field !== target.field || app.value !== targetValue,
    ),
  };
}

const WINDOWS_COMPUTER_USE_TOOL_PREFIX = 'mcp__computer-use__computer_';
const COMPUTER_USE_TOOL_PREFIX = 'mcp__computer-use__';

function isMacBundleIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/i.test(value.trim())
  );
}

/** NewMax's exact gate for the "always allow this app" approval action. */
export function persistentComputerUseAppOf(
  toolName: string,
  input: Record<string, unknown> | undefined,
): PersistentComputerUseApp | null {
  if (!input) return null;
  if (toolName.startsWith(WINDOWS_COMPUTER_USE_TOOL_PREFIX)) {
    const appId = typeof input.app_id === 'string' ? input.app_id.trim() : '';
    return appId ? { field: 'app_id', value: appId } : null;
  }
  if (!toolName.startsWith(COMPUTER_USE_TOOL_PREFIX) || !isMacBundleIdentifier(input.app)) {
    return null;
  }
  return { field: 'app', value: input.app.trim() };
}
