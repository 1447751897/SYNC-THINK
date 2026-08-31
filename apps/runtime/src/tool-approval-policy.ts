import {
  type ToolApprovalRiskSummary,
  type ToolApprovalScope,
} from '@sync-think/protocol';
import {
  COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY,
  normalizeComputerUseApprovalPolicySetting,
  persistentComputerUseAppOf,
  type ComputerUseApprovalPolicySetting,
  type PersistentComputerUseApp,
} from '@sync-think/protocol/tool-approval';

export {
  COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY,
  persistentComputerUseAppOf,
} from '@sync-think/protocol/tool-approval';

interface SettingStoreLike {
  get(key: string): { value: unknown } | undefined;
  set(key: string, value: unknown): unknown;
}

interface ToolApprovalPolicyInput {
  conversationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  risk?: ToolApprovalRiskSummary;
}

export function toolApprovalScopesFor(
  input: Pick<ToolApprovalPolicyInput, 'toolName' | 'arguments' | 'risk'>,
): ToolApprovalScope[] {
  if (input.risk?.level === 'human-only') return ['once'];
  return persistentComputerUseAppOf(input.toolName, input.arguments)
    ? ['once', 'always-app']
    : ['once', 'session'];
}

function persistentAppKey(app: PersistentComputerUseApp): string {
  return `${app.field}\u0000${app.value}`;
}

/** Runtime-owned memory for NewMax's once/session/always-app approval scopes. */
export class ToolApprovalPolicy {
  private readonly sessionTools = new Set<string>();

  constructor(private readonly settings?: SettingStoreLike) {}

  isAllowed(input: ToolApprovalPolicyInput): boolean {
    if (input.risk?.level === 'human-only') return false;
    if (this.sessionTools.has(this.sessionKey(input.conversationId, input.toolName))) return true;
    const app = persistentComputerUseAppOf(input.toolName, input.arguments);
    if (!app) return false;
    return this.readPersistentApps().some((allowed) => persistentAppKey(allowed) === persistentAppKey(app));
  }

  remember(
    input: ToolApprovalPolicyInput & { scope: ToolApprovalScope },
  ): { remembered: boolean; persistentApp?: PersistentComputerUseApp } {
    if (input.scope === 'once') return { remembered: false };
    if (!toolApprovalScopesFor(input).includes(input.scope)) return { remembered: false };
    if (input.scope === 'session') {
      this.sessionTools.add(this.sessionKey(input.conversationId, input.toolName));
      return { remembered: true };
    }

    const persistentApp = persistentComputerUseAppOf(input.toolName, input.arguments);
    if (!persistentApp || !this.settings) return { remembered: false };
    const apps = this.readPersistentApps();
    if (!apps.some((allowed) => persistentAppKey(allowed) === persistentAppKey(persistentApp))) {
      const policy: ComputerUseApprovalPolicySetting = {
        version: 1,
        alwaysAllowedApps: [...apps, persistentApp],
      };
      this.settings.set(COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY, policy);
    }
    return { remembered: true, persistentApp };
  }

  private readPersistentApps(): PersistentComputerUseApp[] {
    return normalizeComputerUseApprovalPolicySetting(
      this.settings?.get(COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY)?.value,
    ).alwaysAllowedApps;
  }

  private sessionKey(conversationId: string, toolName: string): string {
    return `${conversationId}\u0000${toolName}`;
  }
}
