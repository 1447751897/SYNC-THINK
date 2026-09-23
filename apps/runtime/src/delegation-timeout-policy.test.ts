import { expect, it } from 'vitest';
import {
  resolveDelegationStatusNotificationTimeoutSeconds,
  resolveDelegationTimeoutSeconds,
} from './delegation-timeout-policy.js';

it.each([
  [true, undefined, 7200],
  [false, undefined, 300],
  [true, NaN, 7200],
  [false, Infinity, 300],
  [true, '600', 7200],
  [false, '600', 300],
  [true, 0, 60],
  [false, 0, 1],
  [true, 8000, 7200],
  [false, 8000, 3600],
  [true, 360.9, 360],
  [false, 360.9, 360],
])('preserves timeout policy background=%s requested=%s', (background, requested, expected) => {
  expect(resolveDelegationTimeoutSeconds(background as boolean, requested)).toBe(expected);
});

it.each([
  [true, undefined, 120],
  [true, 5, 15],
  [true, 30.9, 30],
  [true, 2_000, 900],
  [false, 30, 120],
])('normalizes status notification timeout background=%s requested=%s', (background, requested, expected) => {
  expect(resolveDelegationStatusNotificationTimeoutSeconds(background as boolean, requested)).toBe(expected);
});
