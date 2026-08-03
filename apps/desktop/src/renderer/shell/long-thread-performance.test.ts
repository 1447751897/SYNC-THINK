import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  calculateMessageWindow,
  MESSAGE_WINDOW_ESTIMATED_HEIGHT,
} from './message-window.js';

const chatSource = readFileSync(new URL('./ChatView.tsx', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');

describe('long-thread performance budget', () => {
  it('keeps durable history I/O paged and lets Chromium skip offscreen message layout', () => {
    expect(chatSource).toMatch(/limit:\s*50/);
    expect(chatSource).toContain('shell-message-window-item pb-6');
    expect(shellCss).toMatch(
      /\.shell-message-window-item\s*\{[^}]*content-visibility:\s*auto;/s,
    );
    expect(shellCss).toContain(
      'contain-intrinsic-size: auto ' + MESSAGE_WINDOW_ESTIMATED_HEIGHT + 'px',
    );
  });

  it('computes a 100k-message viewport within the closed-beta CPU budget', () => {
    const ids = Array.from({ length: 100_000 }, (_, index) => 'message-' + index);
    const measured = new Map<string, number>();
    const startedAt = performance.now();
    const range = calculateMessageWindow({
      ids,
      measuredHeights: measured,
      scrollTop: 11_000_000,
      viewportHeight: 900,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeLessThan(500);
    expect(range.endIndex - range.startIndex).toBeLessThanOrEqual(16);
    expect(range.totalHeight).toBe(100_000 * MESSAGE_WINDOW_ESTIMATED_HEIGHT);
  });
});
