/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { calendarPopoverPosition } from './TaskCalendarPopover.js';

const box = { left: 300, right: 400, top: 80, bottom: 110 };
const size = { width: 320, height: 330 };
describe('calendar popover collision handling', () => {
  it('anchors the date picker below the date title', () => {
    expect(
      calendarPopoverPosition(box, size, { width: 1200, height: 900 }, 'bottom'),
    ).toMatchObject({ left: 300, top: 118, width: 320 });
  });
  it('flips an event card to the left at the right edge', () => {
    const result = calendarPopoverPosition(
      { ...box, left: 1000, right: 1100 },
      size,
      { width: 1200, height: 900 },
      'right',
    );
    expect(result.left).toBe(672);
    expect(result.top).toBe(12);
  });
  it('flips the date picker above near the bottom edge', () => {
    expect(
      calendarPopoverPosition(
        { ...box, top: 750, bottom: 780 },
        size,
        { width: 1200, height: 900 },
        'bottom',
      ).top,
    ).toBe(412);
  });
  it('fits both floating surfaces inside a narrow viewport without page overflow', () => {
    for (const side of ['right', 'bottom'] as const) {
      const result = calendarPopoverPosition(
        { left: 250, right: 320, top: 600, bottom: 640 },
        { width: 320, height: 800 },
        { width: 360, height: 700 },
        side,
      );
      expect(result.left).toBeGreaterThanOrEqual(12);
      expect(result.left + result.width).toBeLessThanOrEqual(348);
      expect(result.top).toBe(12);
      expect(result.maxHeight).toBe(676);
    }
  });
});
