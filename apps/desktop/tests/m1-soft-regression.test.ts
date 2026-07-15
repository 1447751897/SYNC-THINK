import { describe, expect, it } from 'vitest';
import {
  formatM1SoftRegressionMatrix,
  projectM1SoftRegressionMatrix,
  softRegressionLooksSecretFree,
  M1_SOFT_REGRESSION_SUITE_CATALOG,
  filterM1SoftRegressionRows,
  countM1SoftRegressionFilter,
  resolveM1SoftRegressionRowAction,
  isM1SoftRegressionRowActionable,
} from '../src/renderer/m1-soft-regression.js';

const base = {
  generatedAt: '2026-07-12T12:00:00Z',
  connectionState: 'online',
  dualAutomatedOk: true,
  handtestLivePass: 12,
  handtestLiveTotal: 14,
  handtestSoftLiveAllPass: false,
  handtestExternalPending: 4,
  handtestDocChecked: 0,
  handtestDocTotal: 18,
  dogfoodRealDays: 0,
  dogfoodRequired: 3,
  dogfoodFileCount: 1,
  dogfoodDraftDays: 1,
  providersReadySoft: true,
  providerCount: 2,
  modelCount: 3,
  secretCount: 2,
  agentDefaultSet: true,
  agentFallbackCount: 1,
  sessionLevel: 'ready',
  exitLevel: 'soft-only',
  hardGatesMet: false,
  distinctMessageModelCount: 1,
  hasTraceEvents: true,
  manifestCount: 2,
  streamFailureRecoveryReady: true,
  softCraftRound: 45,
};

describe('projectM1SoftRegressionMatrix', () => {
  it('builds fixed core rows and marks dual + external gaps', () => {
    const rows = projectM1SoftRegressionMatrix(base);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    const dual = rows.find((r) => r.id === 'suite-dual');
    expect(dual?.auto).toBe('pass');
    expect(dual?.hand).toBe('external');
    const doc = rows.find((r) => r.id === 'handtest-doc');
    expect(doc?.auto).toBe('na');
    expect(doc?.hand).toBe('external');
    const dog = rows.find((r) => r.id === 'dogfood');
    expect(dog?.hand).toBe('external');
    const fb = rows.find((r) => r.id === 'fallback-external');
    expect(fb?.auto).toBe('na');
    expect(fb?.hand).toBe('external');
  });

  it('appends optional suite results', () => {
    const rows = projectM1SoftRegressionMatrix({
      ...base,
      suiteResults: [
        { id: 'dual-http', label: 'runtime dual-http-gateway', ok: true, detail: 'GREEN' },
        { id: 'broken', label: 'broken suite', ok: false, detail: 'RED' },
      ],
    });
    expect(rows.some((r) => r.id === 'suite-dual-http' && r.auto === 'pass')).toBe(true);
    expect(rows.some((r) => r.id === 'suite-broken' && r.auto === 'fail')).toBe(true);
  });
});

describe('formatM1SoftRegressionMatrix', () => {
  it('formats markdown table and never claims M1 closed', () => {
    const r = formatM1SoftRegressionMatrix(base);
    expect(r.claimsM1Closed).toBe(false);
    expect(r.claimsDocChecked).toBe(false);
    expect(r.charCount).toBeGreaterThan(200);
    expect(r.markdown).toMatch(/soft/);
    expect(r.markdown).toMatch(/handtest|14-external/);
    expect(r.markdown).toMatch(/dogfood/);
    expect(r.markdown).toMatch(/open|claimsM1Closed=false/i);
    expect(r.autoPass).toBeGreaterThan(0);
    expect(r.externalGaps).toBeGreaterThan(0);
    expect(r.summary).toMatch(/auto|soft/);
    expect(softRegressionLooksSecretFree(r.markdown)).toBe(true);
  });

  it('never claims closed even when hard gates look met', () => {
    const r = formatM1SoftRegressionMatrix({
      ...base,
      handtestDocChecked: 18,
      dogfoodRealDays: 3,
      hardGatesMet: true,
      exitLevel: 'evidence-ready',
      handtestExternalPending: 0,
    });
    expect(r.claimsM1Closed).toBe(false);
    expect(r.markdown).toMatch(/open|claimsM1Closed=false/i);
    const doc = r.rows.find((row) => row.id === 'handtest-doc');
    expect(doc?.hand).toBe('pass');
    const dog = r.rows.find((row) => row.id === 'dogfood');
    expect(dog?.hand).toBe('pass');
  });

  it('softRegressionLooksSecretFree rejects key-like strings', () => {
    expect(
      softRegressionLooksSecretFree('token sk-abcdefghijklmnopqrstuvwxyz1234'),
    ).toBe(false);
    expect(softRegressionLooksSecretFree(formatM1SoftRegressionMatrix(base).markdown)).toBe(
      true,
    );
  });

  it('catalog covers dual + core desktop soft packs', () => {
    expect(M1_SOFT_REGRESSION_SUITE_CATALOG.length).toBeGreaterThanOrEqual(8);
    expect(M1_SOFT_REGRESSION_SUITE_CATALOG.some((s) => s.id === 'dual-http')).toBe(true);
    expect(M1_SOFT_REGRESSION_SUITE_CATALOG.some((s) => s.id === 'soft-regression')).toBe(
      true,
    );
  });
});

describe('filterM1SoftRegressionRows', () => {
  it('filters all / gaps / external / auto-fail', () => {
    const rows = projectM1SoftRegressionMatrix({
      ...base,
      dualAutomatedOk: false,
      suiteResults: [{ id: 'x', label: 'x suite', ok: false, detail: 'RED' }],
    });
    expect(filterM1SoftRegressionRows(rows, 'all').length).toBe(rows.length);
    const gaps = filterM1SoftRegressionRows(rows, 'gaps');
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((r) => r.hand === 'pending' || r.hand === 'external' || r.hand === 'fail' || r.auto === 'fail')).toBe(true);
    const ext = filterM1SoftRegressionRows(rows, 'external');
    expect(ext.length).toBeGreaterThan(0);
    expect(ext.every((r) => r.hand === 'external')).toBe(true);
    const fails = filterM1SoftRegressionRows(rows, 'auto-fail');
    expect(fails.some((r) => r.auto === 'fail')).toBe(true);
    expect(countM1SoftRegressionFilter(rows, 'external')).toBe(ext.length);
  });
});

describe('resolveM1SoftRegressionRowAction', () => {
  it('maps hard-gate rows to open-handtest / open-dogfood', () => {
    expect(resolveM1SoftRegressionRowAction('handtest-doc').kind).toBe('open-handtest');
    expect(resolveM1SoftRegressionRowAction('dogfood').kind).toBe('open-dogfood');
    expect(resolveM1SoftRegressionRowAction('providers-soft').kind).toBe('jump-providers');
    expect(resolveM1SoftRegressionRowAction('agent-bind').kind).toBe('jump-agent');
    expect(resolveM1SoftRegressionRowAction('runtime-online').kind).toBe('reconnect');
    expect(isM1SoftRegressionRowActionable('handtest-doc')).toBe(true);
    expect(resolveM1SoftRegressionRowAction('unknown-row').kind).toBe('none');
  });
});

