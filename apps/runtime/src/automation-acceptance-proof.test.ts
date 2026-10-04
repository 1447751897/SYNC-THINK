import { describe, expect, it } from 'vitest';
import {
  automationAcceptanceContractHash,
  automationExpectedLocalDate,
} from './automation-acceptance-proof.js';
import {
  automationAcceptanceFailure,
  type AutomationRunEvidence,
} from './automation-run-evidence.js';
const firedAt = '2026-10-01T18:30:00.000Z';
const checks = { minimumRows: 3, dateColumn: 'date', sourceUrlColumn: 'source' };
describe('host acceptance proof binds the occurrence', () => {
  it('uses original local trigger day after restart, not UTC or wall time', () => {
    expect(automationExpectedLocalDate(firedAt, 'Asia/Shanghai')).toBe('2026-10-02');
    expect(automationExpectedLocalDate(firedAt, 'America/Los_Angeles')).toBe('2026-10-01');
  });
  it('has a stable semantic rule fingerprint and invalidates changed rules or local date', () => {
    const key = automationAcceptanceContractHash(checks, firedAt, 'Asia/Shanghai');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(automationAcceptanceContractHash({ ...checks }, firedAt, 'Asia/Shanghai')).toBe(key);
    expect(
      automationAcceptanceContractHash({ ...checks, minimumRows: 4 }, firedAt, 'Asia/Shanghai'),
    ).not.toBe(key);
    expect(
      automationAcceptanceContractHash(checks, '2026-10-03T18:30:00Z', 'Asia/Shanghai'),
    ).not.toBe(key);
  });
  it('actual file metadata without a current host proof does not pass configured business rules', () => {
    const config = { outputs: ['spreadsheet' as const], acceptanceChecks: checks };
    const key = automationAcceptanceContractHash(checks, firedAt, 'Asia/Shanghai')!;
    const evidence: AutomationRunEvidence = {
      outputs: [
        { format: 'spreadsheet', path: 'fixture.xlsx', sha256: 'a'.repeat(64), bytes: 128 },
      ],
    };
    expect(automationAcceptanceFailure(config, evidence, key)).toMatch(/结构化业务验收/);
    evidence.outputs[0].businessAcceptance = {
      passed: true,
      contractHash: key,
      expectedLocalDate: '2026-10-02',
    };
    expect(automationAcceptanceFailure(config, evidence, key)).toBeUndefined();
    expect(automationAcceptanceFailure(config, evidence, 'different-occurrence')).toMatch(
      /结构化业务验收/,
    );
  });
});
