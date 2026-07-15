import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isAllowedM1OpenDocId,
  isValidDogfoodDayDate,
  resolveM1OpenDocPath,
  todayIsoDate,
} from '../src/main/m1-open-doc.js';

function makeDocsRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'st-m1-docs-'));
  const dev = path.join(root, 'development');
  fs.mkdirSync(dev, { recursive: true });
  fs.writeFileSync(
    path.join(dev, '14-external-gateway-handtest.md'),
    '# handtest\n- [ ] a\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dev, 'dogfood-template.md'),
    '# Dogfood · TEMPLATE\n- [ ] start\n- Provider A：待填\n',
    'utf8',
  );
  fs.mkdirSync(path.join(dev, 'dogfood'), { recursive: true });
  fs.writeFileSync(
    path.join(dev, 'dogfood', '2026-07-12.md'),
    '# Dogfood · 2026-07-12（脚手架）\n待填\n',
    'utf8',
  );
  return dev;
}

describe('resolveM1OpenDocPath', () => {
  it('allowlist only known ids', () => {
    expect(isAllowedM1OpenDocId('handtest')).toBe(true);
    expect(isAllowedM1OpenDocId('dogfood-today')).toBe(true);
    expect(isAllowedM1OpenDocId('../secret')).toBe(false);
    expect(isAllowedM1OpenDocId('')).toBe(false);
  });

  it('resolves handtest and dogfood dir', () => {
    const docs = makeDocsRoot();
    const h = resolveM1OpenDocPath(docs, 'handtest');
    expect(h?.path.endsWith('14-external-gateway-handtest.md')).toBe(true);
    const d = resolveM1OpenDocPath(docs, 'dogfood');
    expect(d?.path.endsWith(`dogfood` + path.sep) || d?.path.endsWith('dogfood')).toBe(
      true,
    );
  });

  it('dogfood-today opens existing latest or creates from template', () => {
    const docs = makeDocsRoot();
    const existing = resolveM1OpenDocPath(docs, 'dogfood-today', {
      today: '2026-07-12',
      ensureTodayFromTemplate: false,
    });
    expect(existing?.path).toMatch(/2026-07-12\.md$/);

    const created = resolveM1OpenDocPath(docs, 'dogfood-today', {
      today: '2026-07-13',
      ensureTodayFromTemplate: true,
    });
    expect(created?.created).toBe(true);
    expect(created?.path).toMatch(/2026-07-13\.md$/);
    expect(fs.existsSync(created!.path)).toBe(true);
    expect(fs.readFileSync(created!.path, 'utf8')).toMatch(/2026-07-13|Dogfood/);
  });

  it('todayIsoDate is YYYY-MM-DD', () => {
    expect(todayIsoDate(new Date('2026-07-12T12:00:00Z'))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('isValidDogfoodDayDate allowlists real calendar dates', () => {
    expect(isValidDogfoodDayDate('2026-07-12')).toBe(true);
    expect(isValidDogfoodDayDate('2026-02-30')).toBe(false);
    expect(isValidDogfoodDayDate('../etc')).toBe(false);
    expect(isValidDogfoodDayDate('2026/07/12')).toBe(false);
    expect(isValidDogfoodDayDate(null)).toBe(false);
  });

  it('dogfood-day opens existing day file only', () => {
    const docs = makeDocsRoot();
    const ok = resolveM1OpenDocPath(docs, 'dogfood-day', { date: '2026-07-12' });
    expect(ok?.path).toMatch(/2026-07-12\.md$/);
    expect(ok?.created).toBe(false);
    const missing = resolveM1OpenDocPath(docs, 'dogfood-day', {
      date: '2099-01-01',
    });
    expect(missing).toBeNull();
    const bad = resolveM1OpenDocPath(docs, 'dogfood-day', { date: '../x' });
    expect(bad).toBeNull();
  });

  it('allows dogfood-day id in allowlist', () => {
    expect(isAllowedM1OpenDocId('dogfood-day')).toBe(true);
  });
});
