import { describe, expect, it } from 'vitest';
import { AUTHOR_SKILL_MARKET_CATALOG, AUTHOR_SKILL_MARKET_ITEMS } from './skill-market-catalog.js';

describe('author Skill market catalog', () => {
  it('publishes stable, unique summaries in declaration order', () => {
    expect(AUTHOR_SKILL_MARKET_ITEMS).toHaveLength(6);
    expect(AUTHOR_SKILL_MARKET_ITEMS.map((item) => item.id)).toEqual(
      Object.keys(AUTHOR_SKILL_MARKET_CATALOG),
    );
    expect(new Set(AUTHOR_SKILL_MARKET_ITEMS.map((item) => item.id)).size).toBe(
      AUTHOR_SKILL_MARKET_ITEMS.length,
    );
    expect(
      AUTHOR_SKILL_MARKET_ITEMS.every(
        (item) =>
          item.id === item.slug &&
          item.author === 'SYNC-THINK' &&
          /^\d+\.\d+\.\d+$/.test(item.version) &&
          Boolean(item.description.trim()),
      ),
    ).toBe(true);
  });
});
