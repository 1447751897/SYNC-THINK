import { type ToolApprovalRiskSummary, type ToolApprovalScope } from '@sync-think/protocol';
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

export interface ToolApprovalPolicyInput {
  conversationId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  risk?: ToolApprovalRiskSummary;
}

interface PreparedToolApprovalGrant {
  persistentApp?: PersistentComputerUseApp;
  persist(): void;
  activate(): void;
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
    return this.readPersistentApps().some(
      (allowed) => persistentAppKey(allowed) === persistentAppKey(app),
    );
  }

  remember(input: ToolApprovalPolicyInput & { scope: ToolApprovalScope }): {
    remembered: boolean;
    persistentApp?: PersistentComputerUseApp;
  } {
    const grant = this.prepareRemember(input);
    if (!grant) return { remembered: false };
    grant.persist();
    grant.activate();
    return {
      remembered: true,
      ...(grant.persistentApp ? { persistentApp: grant.persistentApp } : {}),
    };
  }

  prepareRemember(
    input: ToolApprovalPolicyInput & { scope: ToolApprovalScope },
  ): PreparedToolApprovalGrant | undefined {
    if (input.scope === 'once' || !toolApprovalScopesFor(input).includes(input.scope)) return;
    if (input.scope === 'session') {
      const key = this.sessionKey(input.conversationId, input.toolName);
      return {
        persist: () => {},
        activate: () => {
          this.sessionTools.add(key);
        },
      };
    }

    const persistentApp = persistentComputerUseAppOf(input.toolName, input.arguments);
    const settings = this.settings;
    if (!persistentApp || !settings) return;
    return {
      persistentApp,
      persist: () => {
        const apps = this.readPersistentApps();
        if (apps.some((allowed) => persistentAppKey(allowed) === persistentAppKey(persistentApp))) {
          return;
        }
        const policy: ComputerUseApprovalPolicySetting = {
          version: 1,
          alwaysAllowedApps: [...apps, persistentApp],
        };
        settings.set(COMPUTER_USE_APPROVAL_POLICY_SETTING_KEY, policy);
      },
      activate: () => {},
    };
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
