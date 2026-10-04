import { describe, expect, it } from 'vitest';
import { parseAutomationAcceptanceChecks } from './automation-acceptance.js';

describe('parseAutomationAcceptanceChecks', () => {
  it('parses a bounded row requirement without changing the caller contract', () => {
    const contract = Object.freeze({ minimumRows: 2 });
    expect(parseAutomationAcceptanceChecks(contract)).toEqual({ minimumRows: 2 });
  });
});

// The parser is the only contract-validation seam; no private validators are tested.
describe('strict automation acceptance contract', () => {
  it.each([
    { minimumRows: 1, unexpected: true },
    Object.assign(Object.create({ inherited: true }) as object, { minimumRows: 1 }),
    Object.assign(new Date('2026-10-02T00:00:00Z'), { minimumRows: 1 }),
    { minimumRows: 1, [Symbol('hidden')]: true },
    Object.defineProperty({ minimumRows: 1 }, 'hidden', { value: true }),
  ])('rejects unknown fields and non-record objects: %j', (value) => {
    expect(parseAutomationAcceptanceChecks(value)).toBeUndefined();
  });
});

it('normalizes all supported conditions and returns detached arrays', () => {
  const value = {
    minimumRows: 10_000,
    requiredColumns: [' 日期 ', '来源', 'Name'],
    dateColumn: ' 日期 ',
    sourceUrlColumn: ' 来源 ',
    minimumSlides: 100,
  };
  const parsed = parseAutomationAcceptanceChecks(value);
  expect(parsed).toEqual({
    minimumRows: 10_000,
    requiredColumns: ['日期', '来源', 'Name'],
    dateColumn: '日期',
    sourceUrlColumn: '来源',
    minimumSlides: 100,
  });
  parsed!.requiredColumns!.push('new');
  expect(value.requiredColumns).toEqual([' 日期 ', '来源', 'Name']);
});

it.each([
  { minimumSlides: 1 },
  { requiredColumns: ['Name'] },
  { dateColumn: 'Date' },
  { sourceUrlColumn: 'Source' },
  Object.assign(Object.create(null) as object, { minimumRows: 1 }),
])('accepts a single condition, including null-prototype JSON records: %j', (value) => {
  expect(parseAutomationAcceptanceChecks(value)).toEqual(value);
});

it.each([
  undefined,
  null,
  true,
  1,
  'rules',
  [],
  {},
  { minimumRows: undefined },
  { minimumRows: null },
  { minimumRows: '1' },
  { minimumRows: 0 },
  { minimumRows: -1 },
  { minimumRows: 1.5 },
  { minimumRows: 10_001 },
  { minimumRows: Number.NaN },
  { minimumRows: Infinity },
  { minimumSlides: 0 },
  { minimumSlides: 101 },
  { minimumSlides: 1.5 },
  { minimumSlides: '1' },
  { minimumSlides: Infinity },
  { requiredColumns: [] },
  { requiredColumns: new Array(1) },
  { requiredColumns: ['Name', ' Name '] },
  { requiredColumns: ['Name', ''] },
  { requiredColumns: ['  '] },
  { requiredColumns: ['Name', 1] },
  { requiredColumns: 'Name' },
  { requiredColumns: Array.from({ length: 129 }, (_, index) => `column-${index}`) },
  { dateColumn: '' },
  { dateColumn: '  ' },
  { dateColumn: 1 },
  { sourceUrlColumn: '\t' },
  { sourceUrlColumn: true },
  { minimumRows: 1, requiredColumns: undefined },
  { minimumRows: 1, dateColumn: undefined },
  { sourceUrlColumn: 'x'.repeat(32_768) },
  { requiredColumns: ['x'.repeat(32_768)] },
])('rejects empty, malformed or out-of-budget condition #%#', (value) => {
  expect(parseAutomationAcceptanceChecks(value)).toBeUndefined();
});

it('rejects accessor conditions without evaluating caller code', () => {
  const value = Object.defineProperty({}, 'minimumRows', {
    enumerable: true,
    get() {
      throw new Error('Getter should not be evaluated');
    },
  });
  expect(parseAutomationAcceptanceChecks(value)).toBeUndefined();
});

it('accepts the 128-column boundary and preserves case-sensitive names', () => {
  const value = { requiredColumns: Array.from({ length: 128 }, (_, index) => `c-${index}`) };
  expect(parseAutomationAcceptanceChecks(value)?.requiredColumns).toHaveLength(128);
  expect(parseAutomationAcceptanceChecks({ requiredColumns: ['Name', 'name'] })).toEqual({
    requiredColumns: ['Name', 'name'],
  });
});
