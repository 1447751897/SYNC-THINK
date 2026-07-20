import { describe, expect, it } from 'vitest';
import {
  AGENT_PERMISSION_DISABLED,
  isAgentPermissionCategoryEnabled,
  isLegacyAgentPermissions,
  type AgentPermissions,
} from './agent.js';

describe('Agent permission compatibility', () => {
  it('treats historical all-empty permissions as enabled defaults', () => {
    const permissions: AgentPermissions = {
      file: [],
      command: [],
      browser: [],
      desktop: [],
      network: [],
    };
    expect(isLegacyAgentPermissions(permissions)).toBe(true);
    expect(isAgentPermissionCategoryEnabled(permissions.browser, true)).toBe(true);
  });

  it('distinguishes an explicit disabled category from a legacy empty default', () => {
    expect(isAgentPermissionCategoryEnabled([AGENT_PERMISSION_DISABLED])).toBe(false);
    expect(isAgentPermissionCategoryEnabled(['*'])).toBe(true);
  });
});
