/**
 * NewMax `scrollToMessage` slides the reader to the clicked outline tick
 * (`container.scrollTo({ top, behavior: 'smooth' })`) instead of teleporting.
 *
 * SYNC-THINK drives that motion itself rather than handing it to the browser,
 * for two reasons the minimap rail already depends on:
 *
 * - the rail keeps re-measuring the landing position for a few frames after a
 *   click (content-visibility rows and images realize late), so the slide has to
 *   survive being re-aimed mid-flight without restarting or stuttering;
 * - every frame is written through the conversation's `programmaticScrollTarget`
 *   contract, so the stick tracker never mistakes the slide for a reader scroll.
 *
 * The easing mirrors the feel of a native smooth scroll: symmetric ease-in-out,
 * a floor so a one-row hop still reads as motion, and a ceiling so a long jump
 * does not crawl.
 */

/** A short hop must still read as motion rather than an instant snap. */
export const NAVIGATION_SLIDE_MIN_DURATION_MS = 180;

/** A long jump must not crawl; roughly matches Chromium's native smooth scroll. */
export const NAVIGATION_SLIDE_MAX_DURATION_MS = 420;

/** Distance-to-duration slope: a viewport-height jump lands near the ceiling. */
export const NAVIGATION_SLIDE_DURATION_PER_PX = 0.55;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function navigationSlideDuration(distancePx: number): number {
  return clamp(
    Math.abs(distancePx) * NAVIGATION_SLIDE_DURATION_PER_PX,
    NAVIGATION_SLIDE_MIN_DURATION_MS,
    NAVIGATION_SLIDE_MAX_DURATION_MS,
  );
}

/** Symmetric ease-in-out over a normalized 0..1 progress. */
export function easeNavigationSlide(progress: number): number {
  const value = clamp(progress, 0, 1);
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

/**
 * Position for one frame. Re-aiming `to` mid-flight only bends the remaining
 * curve: the origin and the elapsed clock stay put, so a late correction nudges
 * the endpoint instead of restarting the animation.
 */
export function navigationSlidePosition(input: {
  from: number;
  to: number;
  progress: number;
}): number {
  return input.from + (input.to - input.from) * easeNavigationSlide(input.progress);
}
