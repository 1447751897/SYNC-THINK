import { describe, expect, it } from 'vitest';
import {
  MAX_TOOL_OUTPUT_CHARACTERS,
  MAX_TOOL_OUTPUT_LINES,
  formatDisplayedToolOutput,
} from './tool-output-display.js';

describe('formatDisplayedToolOutput', () => {
  it('keeps ordinary command output intact', () => {
    expect(formatDisplayedToolOutput('ok\nready\n')).toEqual({
      text: 'ok\nready',
      truncated: false,
    });
  });

  it('keeps the NewMax head-and-tail window for oversized character payloads', () => {
    const raw = `${'H'.repeat(30_000)}${'M'.repeat(20_000)}${'T'.repeat(10_000)}`;
    const displayed = formatDisplayedToolOutput(raw);
    expect(raw.length).toBeGreaterThan(MAX_TOOL_OUTPUT_CHARACTERS);
    expect(displayed.truncated).toBe(true);
    expect(displayed.text.startsWith('H'.repeat(30_000))).toBe(true);
    expect(displayed.text.endsWith('T'.repeat(10_000))).toBe(true);
    expect(displayed.notice).toContain('20,000');
  });

  it('keeps the first 200 lines when the payload is only line-heavy', () => {
    const lines = Array.from({ length: MAX_TOOL_OUTPUT_LINES + 12 }, (_, index) => `L${index + 1}`);
    const displayed = formatDisplayedToolOutput(lines.join('\n'));
    expect(displayed.truncated).toBe(true);
    expect(displayed.text).toBe(lines.slice(0, MAX_TOOL_OUTPUT_LINES).join('\n'));
    expect(displayed.notice).toBe('… 还有 12 行');
  });
});
