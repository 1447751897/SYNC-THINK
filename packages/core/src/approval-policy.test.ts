import { describe, expect, it } from 'vitest';
import {
  evaluateApproval,
  isHumanOnlyAction,
  listHumanOnlyActions,
  normalizeApprovalMode,
  humanOnlyActionLabelZh,
  formatApprovalGateLabel,
} from './approval-policy.js';
import { HUMAN_ONLY_ACTIONS } from '@sync-think/shared';

describe('approval-policy (§13)', () => {
  it('lists all human-only actions from shared', () => {
    expect(listHumanOnlyActions()).toEqual([...HUMAN_ONLY_ACTIONS]);
    expect(isHumanOnlyAction('irreversible-deletion')).toBe(true);
    expect(isHumanOnlyAction('read-file')).toBe(false);
  });

  it('normalizes unknown modes to request', () => {
    expect(normalizeApprovalMode('full')).toBe('full');
    expect(normalizeApprovalMode('weird')).toBe('request');
    expect(normalizeApprovalMode(undefined)).toBe('request');
  });

  it('accepts execution-mode aliases on the approval path', () => {
    expect(normalizeApprovalMode('full-access')).toBe('full');
    expect(normalizeApprovalMode('workspace')).toBe('request');
    expect(normalizeApprovalMode('read-only')).toBe('request');
  });

  it('full access auto-approves sensitive actions without losing audit metadata', () => {
    const r = evaluateApproval({
      mode: 'full',
      action: 'payment-or-purchase',
      insideExplicitPolicy: true,
      delegateAvailable: true,
    });
    expect(r.gate).toBe('auto-approve');
    expect(r.humanOnly).toBe(true);
    expect(r.humanOnlyAction).toBe('payment-or-purchase');
    expect(r.labelZh).toMatch(/完全访问/);
  });

  it('human-only cannot be delegated', () => {
    const r = evaluateApproval({
      mode: 'delegate',
      action: 'access-or-create-secret',
      delegateAvailable: true,
    });
    expect(r.gate).toBe('require-human');
    expect(r.humanOnly).toBe(true);
  });

  it('request mode requires human for normal tools', () => {
    const r = evaluateApproval({
      mode: 'request',
      action: 'shell.exec',
      kind: 'tool',
      insideExplicitPolicy: true,
    });
    expect(r.gate).toBe('require-human');
    expect(r.humanOnly).toBe(false);
  });

  it('full mode auto-approves inside explicit policy', () => {
    const r = evaluateApproval({
      mode: 'full',
      action: 'shell.exec',
      kind: 'tool',
      insideExplicitPolicy: true,
    });
    expect(r.gate).toBe('auto-approve');
    expect(formatApprovalGateLabel(r)).toMatch(/自动执行/);
  });

  it('full mode does not require an additional explicit policy rule', () => {
    const r = evaluateApproval({
      mode: 'full',
      action: 'shell.exec',
      insideExplicitPolicy: false,
    });
    expect(r.gate).toBe('auto-approve');
  });

  it('delegate routes to approval agent when available', () => {
    const r = evaluateApproval({
      mode: 'delegate',
      action: 'tool.write',
      delegateAvailable: true,
    });
    expect(r.gate).toBe('require-delegate');
  });

  it('delegate falls back to human without agent', () => {
    const r = evaluateApproval({
      mode: 'delegate',
      action: 'tool.write',
      delegateAvailable: false,
    });
    expect(r.gate).toBe('require-human');
  });

  it('custom mode respects insideExplicitPolicy', () => {
    expect(
      evaluateApproval({
        mode: 'custom',
        action: 'browser.nav',
        insideExplicitPolicy: true,
      }).gate,
    ).toBe('auto-approve');
    expect(
      evaluateApproval({
        mode: 'custom',
        action: 'browser.nav',
        insideExplicitPolicy: false,
      }).gate,
    ).toBe('require-human');
  });

  it('full access also auto-approves a generic sensitive action category', () => {
    const r = evaluateApproval({
      mode: 'full',
      action: 'custom-danger',
      kind: 'human-only',
      insideExplicitPolicy: true,
    });
    expect(r.gate).toBe('auto-approve');
    expect(r.humanOnly).toBe(true);
  });

  it('labels human-only actions in Chinese', () => {
    expect(humanOnlyActionLabelZh('irreversible-deletion')).toMatch(/删除/);
  });
});
