import { describe, expect, it } from 'vitest';
import { isRecord } from './value-validation.js';

describe('isRecord', () => {
  it('accepts object records', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it('rejects null, arrays, and primitives', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('value')).toBe(false);
    expect(isRecord(1)).toBe(false);
  });
});
