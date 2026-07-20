import { describe, expect, it } from 'vitest';
import {
  parseCreateAutomationPayload,
  parseTriggerAutomationPayload,
  parseUpdateAutomationPayload,
} from './command-validation.js';

const valid = {
  name: '每日检查',
  workspaceId: 'workspace-1',
  target: { type: 'agent', agentVersionId: 'agent-version-1' },
  instruction: '检查项目并汇总',
  trigger: { type: 'cron', expression: '0 9 * * 1-5' },
  timezone: 'Asia/Shanghai',
  concurrencyPolicy: 'queue',
  maxConcurrency: 2,
  maxRetries: 1,
  enabled: true,
};

describe('automation command validation', () => {
  it('accepts bounded cron and webhook definitions', () => {
    expect(parseCreateAutomationPayload(valid)).toMatchObject(valid);
    expect(
      parseCreateAutomationPayload({ ...valid, trigger: { type: 'webhook' } }),
    ).toMatchObject({ trigger: { type: 'webhook' } });
    expect(
      parseUpdateAutomationPayload({
        ...valid,
        automationId: 'automation-1',
        expectedVersion: 2,
      }),
    ).toMatchObject({ automationId: 'automation-1', expectedVersion: 2 });
  });

  it('rejects injected webhook paths, excess retries, and oversized manual input', () => {
    expect(
      parseCreateAutomationPayload({
        ...valid,
        trigger: { type: 'webhook', path: '../chosen-by-client' },
      }),
    ).toBeUndefined();
    expect(parseCreateAutomationPayload({ ...valid, maxRetries: 3 })).toBeUndefined();
    expect(
      parseTriggerAutomationPayload({
        automationId: 'automation-1',
        input: 'x'.repeat(32_001),
      }),
    ).toBeUndefined();
  });
});
