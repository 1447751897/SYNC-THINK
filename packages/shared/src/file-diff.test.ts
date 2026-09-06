import { describe, expect, it } from 'vitest';
import { parseFileDiffReadOptions, projectFileDiffPage } from './file-diff.js';

describe('bounded file difference pages', () => {
  it('finds a small edit in a long file and begins near that edit', () => {
    const lines = Array.from({ length: 10000 }, (_, index) => 'line-' + index);
    const changed = [...lines];
    changed[5000] = 'updated';
    const page = projectFileDiffPage(lines.join('\n'), changed.join('\n'), {}, 'version');
    expect(page).toMatchObject({ mode: 'exact', offset: 4997, added: 1, removed: 1 });
    expect(
      page.rows.filter((row) => row.kind !== 'ctx').map((row) => [row.kind, row.text]),
    ).toEqual([
      ['del', 'line-5000'],
      ['add', 'updated'],
    ]);
  });

  it('paginates every row without losing content and clearly marks budgeted replacement mode', () => {
    const before = Array.from({ length: 600 }, (_, index) => 'old-' + index).join('\n');
    const after = Array.from({ length: 600 }, (_, index) => 'new-' + index).join('\n');
    const rows = [];
    let offset = 0;
    while (true) {
      const page = projectFileDiffPage(before, after, { offset, limit: 80 }, 'version');
      expect(page.mode).toBe('replacement');
      rows.push(...page.rows);
      if (page.nextOffset === undefined) break;
      offset = page.nextOffset;
    }
    expect(
      rows
        .filter((row) => row.kind !== 'del')
        .map((row) => row.text)
        .join('\n'),
    ).toBe(after);
    expect(
      rows
        .filter((row) => row.kind !== 'add')
        .map((row) => row.text)
        .join('\n'),
    ).toBe(before);
  });

  it('bounds long escaped lines, preserves Unicode boundaries and reports format-only changes', () => {
    const text = '\u0001'.repeat(511) + '🙂' + 'x'.repeat(10000);
    const page = projectFileDiffPage('', text, {}, 'version');
    expect(page.rows[0]).toMatchObject({ truncated: true, newLine: 1, newOffset: 0 });
    expect(page.rows[0].text).toBe(text.slice(0, 511));
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(8192);
    expect(projectFileDiffPage('a\r\nb\r\n', 'a\nb\n', {}, 'version')).toMatchObject({
      formatChanged: true,
      added: 0,
      removed: 0,
    });
    expect(projectFileDiffPage('a\nb\n', 'a\nb', {}, 'version').formatChanged).toBe(true);
  });

  it('validates bounded owned inputs and refuses unsupported source paths', () => {
    const valid = {
      before: { text: '' },
      after: { reference: { source: 'event', id: 'event', path: ['argumentsJson', 'content'] } },
    };
    expect(parseFileDiffReadOptions(valid)).toEqual(valid);
    for (const extra of [
      { limit: 161 },
      { offset: -1 },
      { version: 'bad' },
      { path: 'C:/secret' },
      { before: { text: 'x'.repeat(8193) } },
      { after: { reference: { source: 'event', id: 'event', path: ['run'] } } },
    ])
      expect(parseFileDiffReadOptions({ ...valid, ...extra })).toBeUndefined();
  });
});
