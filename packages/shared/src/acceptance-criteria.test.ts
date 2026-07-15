import { describe, expect, it } from 'vitest';
import {
  MAX_ACCEPTANCE_CRITERIA,
  MAX_ACCEPTANCE_CRITERIA_TOTAL_UTF8_BYTES,
  MAX_ACCEPTANCE_CRITERION_UTF8_BYTES,
  normalizeAcceptanceCriteria,
} from './acceptance-criteria.js';

describe('acceptance criteria bounds', () => {
  it('normalizes whitespace and accepts empty Task criteria plus exact legal bounds', () => {
    expect(normalizeAcceptanceCriteria([])).toEqual([]);
    expect(normalizeAcceptanceCriteria(['  exact criterion  '])).toEqual(['exact criterion']);
    expect(
      normalizeAcceptanceCriteria(['x'.repeat(MAX_ACCEPTANCE_CRITERION_UTF8_BYTES)]),
    ).toEqual(['x'.repeat(MAX_ACCEPTANCE_CRITERION_UTF8_BYTES)]);
    expect(
      normalizeAcceptanceCriteria(
        Array.from({ length: MAX_ACCEPTANCE_CRITERIA }, () =>
          'x'.repeat(Math.floor(MAX_ACCEPTANCE_CRITERIA_TOTAL_UTF8_BYTES / MAX_ACCEPTANCE_CRITERIA)),
        ),
      ),
    ).toHaveLength(MAX_ACCEPTANCE_CRITERIA);
  });

  it.each([
    {
      name: 'too many items',
      value: Array.from({ length: 65 }, (_, index) => `criterion-${index}`),
      code: 'acceptance_criteria.too_many',
    },
    {
      name: 'oversized item',
      value: ['x'.repeat(4_001)],
      code: 'acceptance_criteria.item_too_large',
    },
    {
      name: 'oversized multibyte item',
      value: ['\u754c'.repeat(1_334)],
      code: 'acceptance_criteria.item_too_large',
    },
    {
      name: 'oversized total',
      value: Array.from({ length: 17 }, () => 'x'.repeat(4_000)),
      code: 'acceptance_criteria.total_too_large',
    },
    {
      name: 'blank criterion',
      value: ['   '],
      code: 'acceptance_criteria.empty',
    },
  ])('rejects $name', ({ value, code }) => {
    expect(() => normalizeAcceptanceCriteria(value)).toThrow(code);
  });

  it('requires at least one criterion when requested', () => {
    expect(() => normalizeAcceptanceCriteria([], { requireNonEmpty: true })).toThrow(
      'acceptance_criteria.required',
    );
  });
});
