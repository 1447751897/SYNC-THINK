import { describe, expect, it } from 'vitest';
import { ConversationNavigationLayout } from './conversation-navigation-layout.js';

function fixture(count = 6) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    top: 40 + index * 120,
    height: 120,
  }));
  const anchors = rows
    .filter((_, index) => index % 2 === 0)
    .map((row, index) => ({ id: `turn-${index}`, messageId: row.id }));
  return new ConversationNavigationLayout(rows, anchors);
}

describe('ConversationNavigationLayout', () => {
  it('finds the reading focus and pins the edges without reading the DOM', () => {
    const layout = fixture();
    expect(layout.active(0, 200, 800)).toBe('turn-0');
    expect(layout.active(240, 200, 800)).toBe('turn-1');
    expect(layout.active(600, 200, 800)).toBe('turn-2');
    expect(layout.top('turn-1')).toBe(280);
    expect(layout.top('missing')).toBeUndefined();
  });

  it('applies only preceding height deltas to an anchor, including user rows', () => {
    const layout = fixture();
    expect(layout.updateHeights([{ messageId: 'message-1', height: 220 }])).toBe(100);
    expect(layout.top('turn-0')).toBe(40);
    expect(layout.top('turn-1')).toBe(380);
    expect(layout.top('turn-2')).toBe(620);
    expect(layout.updateHeights([{ messageId: 'message-4', height: 400 }])).toBe(280);
    expect(layout.top('turn-2')).toBe(620);
    expect(layout.active(340, 200, 1180)).toBe('turn-1');
  });

  it('handles shrink, repeated measurements, removed nodes and invalid sizes', () => {
    const layout = fixture();
    expect(
      layout.updateHeights([
        { messageId: 'message-0', height: 80 },
        { messageId: 'message-2', height: 180 },
      ]),
    ).toBe(20);
    expect(layout.top('turn-1')).toBe(240);
    expect(layout.top('turn-2')).toBe(540);
    expect(
      layout.updateHeights([
        { messageId: 'message-0', height: 80 },
        { messageId: 'missing', height: 200 },
        { messageId: 'message-1', height: NaN },
        { messageId: 'message-2', height: -20 },
      ]),
    ).toBe(0);
    expect(layout.top('turn-2')).toBe(540);
  });

  it('keeps equal-position turns and empty pages deterministic', () => {
    const layout = new ConversationNavigationLayout(
      [{ id: 'prompt', top: 40, height: 200 }],
      [
        { id: 'one', messageId: 'prompt' },
        { id: 'two', messageId: 'prompt' },
      ],
    );
    expect(layout.active(0, 100, 500)).toBe('one');
    expect(layout.active(40, 100, 500)).toBe('two');
    expect(new ConversationNavigationLayout([], []).active(10, 200, 500)).toBeUndefined();
  });

  it('keeps the last turn selected across small fractional layout drift at the bottom', () => {
    const layout = new ConversationNavigationLayout(
      [
        { id: 'first', top: 40, height: 500 },
        { id: 'last', top: 799, height: 100 },
      ],
      [
        { id: 'first', messageId: 'first' },
        { id: 'last', messageId: 'last' },
      ],
    );
    expect(layout.active(596, 400, 1000)).toBe('last');
    expect(layout.active(590, 400, 1000)).toBe('first');
  });

  it('agrees with a full recomputation for 2000 variable-height messages', () => {
    const count = 2000;
    const heights = Array.from({ length: count }, (_, index) => 70 + (index % 113));
    let cursor = 24;
    const rows = heights.map((height, index) => {
      const row = { id: `message-${index}`, top: cursor, height };
      cursor += height;
      return row;
    });
    const layout = new ConversationNavigationLayout(
      rows,
      rows.map((row) => ({ id: row.id, messageId: row.id })),
    );
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const index = (iteration * 19) % count;
      const height = 40 + ((iteration * 37) % 400);
      heights[index] = height;
      layout.updateHeights([{ messageId: `message-${index}`, height }]);
    }
    cursor = 24;
    for (let index = 0; index < count; index += 1) {
      expect(layout.top(`message-${index}`)).toBe(cursor);
      cursor += heights[index]!;
    }
  });
});
