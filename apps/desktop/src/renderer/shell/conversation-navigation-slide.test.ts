import { describe, expect, it } from 'vitest';
import {
  easeNavigationSlide,
  NAVIGATION_SLIDE_MAX_DURATION_MS,
  NAVIGATION_SLIDE_MIN_DURATION_MS,
  navigationSlideDuration,
  navigationSlidePosition,
} from './conversation-navigation-slide.js';

describe('navigationSlideDuration', () => {
  it('floors a one-row hop so it still reads as motion', () => {
    expect(navigationSlideDuration(0)).toBe(NAVIGATION_SLIDE_MIN_DURATION_MS);
    expect(navigationSlideDuration(40)).toBe(NAVIGATION_SLIDE_MIN_DURATION_MS);
  });

  it('caps a long jump instead of letting it crawl', () => {
    expect(navigationSlideDuration(20_000)).toBe(NAVIGATION_SLIDE_MAX_DURATION_MS);
  });

  it('grows with distance and ignores direction', () => {
    expect(navigationSlideDuration(400)).toBeGreaterThan(navigationSlideDuration(200));
    expect(navigationSlideDuration(-400)).toBe(navigationSlideDuration(400));
  });
});

describe('easeNavigationSlide', () => {
  it('pins both endpoints', () => {
    expect(easeNavigationSlide(0)).toBe(0);
    expect(easeNavigationSlide(1)).toBe(1);
  });

  it('clamps out-of-range progress', () => {
    expect(easeNavigationSlide(-3)).toBe(0);
    expect(easeNavigationSlide(4)).toBe(1);
  });

  it('is symmetric around the midpoint', () => {
    expect(easeNavigationSlide(0.5)).toBeCloseTo(0.5);
    expect(easeNavigationSlide(0.25) + easeNavigationSlide(0.75)).toBeCloseTo(1);
  });

  it('eases in and out rather than moving linearly', () => {
    expect(easeNavigationSlide(0.25)).toBeLessThan(0.25);
    expect(easeNavigationSlide(0.75)).toBeGreaterThan(0.75);
  });
});

describe('navigationSlidePosition', () => {
  it('lands exactly on the target at full progress', () => {
    expect(navigationSlidePosition({ from: 1_000, to: 240, progress: 1 })).toBe(240);
    expect(navigationSlidePosition({ from: 1_000, to: 4_800, progress: 1 })).toBe(4_800);
  });

  it('starts from the current position', () => {
    expect(navigationSlidePosition({ from: 640, to: 0, progress: 0 })).toBe(640);
  });

  it('advances monotonically in both directions', () => {
    const steps = Array.from({ length: 41 }, (_unused, index) => index / 40);
    const upward = steps.map((progress) =>
      navigationSlidePosition({ from: 900, to: 120, progress }),
    );
    const downward = steps.map((progress) =>
      navigationSlidePosition({ from: 120, to: 900, progress }),
    );
    for (let index = 1; index < steps.length; index += 1) {
      expect(upward[index]!).toBeLessThanOrEqual(upward[index - 1]!);
      expect(downward[index]!).toBeGreaterThanOrEqual(downward[index - 1]!);
    }
    expect(upward.at(-1)).toBe(120);
    expect(downward.at(-1)).toBe(900);
  });

  it('re-aiming the endpoint mid-flight bends the remaining curve instead of restarting it', () => {
    const from = 900;
    const halfway = navigationSlidePosition({ from, to: 120, progress: 0.6 });
    const reaimed = navigationSlidePosition({ from, to: 100, progress: 0.6 });
    // A restart would snap back to `from`; re-aiming only nudges the endpoint.
    expect(reaimed).toBeLessThanOrEqual(halfway);
    expect(reaimed).toBeGreaterThan(from - (from - 120));
    expect(navigationSlidePosition({ from, to: 100, progress: 1 })).toBe(100);
  });
});
