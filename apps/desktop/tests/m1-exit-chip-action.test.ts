import { describe, expect, it } from 'vitest';
import {
  formatM1OpenDocFeedback,
  isM1ExitChipActionable,
  resolveM1ExitChipAction,
} from '../src/renderer/m1-exit-chip-action.js';

describe('resolveM1ExitChipAction', () => {
  it('maps handtest chip to open handtest doc', () => {
    const a = resolveM1ExitChipAction('handtest');
    expect(a.kind).toBe('open-doc');
    if (a.kind === 'open-doc') {
      expect(a.openDoc).toBe('handtest');
      expect(a.ctaLabel).toMatch(/手测/);
    }
    expect(isM1ExitChipActionable('handtest')).toBe(true);
  });

  it('maps dogfood chip to open dogfood-today', () => {
    const a = resolveM1ExitChipAction('dogfood');
    expect(a.kind).toBe('open-doc');
    if (a.kind === 'open-doc') {
      expect(a.openDoc).toBe('dogfood-today');
    }
  });

  it('maps dual-auto and soft-session to refresh', () => {
    expect(resolveM1ExitChipAction('dual-auto').kind).toBe('refresh');
    expect(resolveM1ExitChipAction('soft-session').kind).toBe('refresh');
    expect(isM1ExitChipActionable('dual-auto')).toBe(true);
  });

  it('unknown chip is none / not actionable', () => {
    expect(resolveM1ExitChipAction('mystery').kind).toBe('none');
    expect(isM1ExitChipActionable('mystery')).toBe(false);
  });
});

describe('formatM1OpenDocFeedback', () => {
  it('formats success with basename', () => {
    const f = formatM1OpenDocFeedback({
      id: 'handtest',
      ok: true,
      path: 'D:\\projects\\SYNC-THINK\\docs\\development\\14-external-gateway-handtest.md',
      created: false,
    });
    expect(f.level).toBe('ok');
    expect(f.dataOk).toBe('1');
    expect(f.basename).toBe('14-external-gateway-handtest.md');
    expect(f.message).toMatch(/已打开/);
  });

  it('formats created scaffold as warn', () => {
    const f = formatM1OpenDocFeedback({
      id: 'dogfood-today',
      ok: true,
      path: '/docs/development/dogfood/2026-07-13.md',
      created: true,
    });
    expect(f.level).toBe('warn');
    expect(f.dataCreated).toBe('1');
    expect(f.message).toMatch(/创建|脚手架/);
  });

  it('formats errors with Chinese map', () => {
    const f = formatM1OpenDocFeedback({
      id: 'handtest',
      ok: false,
      error: 'docs-not-found',
      path: null,
    });
    expect(f.level).toBe('error');
    expect(f.dataOk).toBe('0');
    expect(f.message).toMatch(/未找到 docs/);
  });
});
