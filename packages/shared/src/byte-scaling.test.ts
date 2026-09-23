import { describe, expect, it } from 'vitest';
import { scaleBinaryBytes } from './byte-scaling.js';

describe('scaleBinaryBytes', () => {
  it('scales binary byte counts through the smallest fitting unit', () => {
    expect(scaleBinaryBytes(512)).toEqual({ value: 512, unitIndex: 0 });
    expect(scaleBinaryBytes(1024)).toEqual({ value: 1, unitIndex: 1 });
    expect(scaleBinaryBytes(1024 ** 2)).toEqual({ value: 1, unitIndex: 2 });
    expect(scaleBinaryBytes(3 * 1024 ** 3)).toEqual({ value: 3, unitIndex: 3 });
  });

  it('respects the host presentation policy maximum unit', () => {
    expect(scaleBinaryBytes(3 * 1024 ** 3, 2)).toEqual({ value: 3072, unitIndex: 2 });
    expect(scaleBinaryBytes(1024 ** 5)).toEqual({ value: 1024, unitIndex: 4 });
    expect(scaleBinaryBytes(1024, 0)).toEqual({ value: 1024, unitIndex: 0 });
  });
});
