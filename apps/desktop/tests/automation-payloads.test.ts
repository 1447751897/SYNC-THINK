import { describe, expect, it } from 'vitest';
import {
  parseCreateAutomationPayload,
  parseListAutomationExecutionsPayload,
  parseListAutomationsPayload,
  parseTriggerAutomationPayload,
  parseUpdateAutomationPayload,
} from '../src/automation-payloads.js';

const payload = {
  name: '每日检查',
  workspaceId: 'workspace-1',
  target: { type: 'agent', agentVersionId: 'agent-version-1' },
  instruction: '检查状态',
  trigger: { type: 'cron', expression: '0 9 * * *' },
  maxConcurrency: 1,
  maxRetries: 2,
};

describe('desktop automation payload boundary', () => {
  it('normalizes create and update payloads', () => {
    expect(parseCreateAutomationPayload(payload)).toMatchObject(payload);
    expect(
      parseUpdateAutomationPayload({
        ...payload,
        automationId: 'automation-1',
        expectedVersion: 2,
      }),
    ).toMatchObject({ automationId: 'automation-1', expectedVersion: 2 });
  });

  it('rejects oversized trigger input and invalid concurrency', () => {
    expect(() => parseCreateAutomationPayload({ ...payload, maxConcurrency: 9 })).toThrow();
    expect(() =>
      parseTriggerAutomationPayload({ automationId: 'automation-1', input: 'x'.repeat(32_001) }),
    ).toThrow();
    expect(() =>
      parseCreateAutomationPayload({ ...payload, confirmationToken: 'must-not-cross-ipc' }),
    ).toThrow();
  });

  it('rejects invalid enums, empty ids, and unknown list fields at the Electron boundary', () => {
    expect(() => parseCreateAutomationPayload({ ...payload, approvalMode: 'root' })).toThrow();
    expect(() =>
      parseCreateAutomationPayload({ ...payload, concurrencyPolicy: 'unbounded' }),
    ).toThrow();
    expect(() =>
      parseCreateAutomationPayload({
        ...payload,
        target: { type: 'agent', agentVersionId: '   ' },
      }),
    ).toThrow();
    expect(() => parseCreateAutomationPayload({ ...payload, timezone: '' })).toThrow();
    expect(() => parseListAutomationsPayload({ secret: 'must-not-cross-ipc' })).toThrow();
    expect(() =>
      parseListAutomationExecutionsPayload({ status: 'running' }),
    ).toThrow();
  });
});
