/**
 * @vitest-environment jsdom
 *
 * Drive 3×3 delays and the pixel/shimmer CSS must stay aligned with
 * Beautiful UI Loading State (default demo label: Churning / variant: Drive).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LOADING_PIXEL_DRIVE_DELAYS_MS, LoadingPixelGrid } from './LoadingPixelGrid.js';

const SHELL_CSS = readFileSync(resolve(process.cwd(), 'src/renderer/shell/shell.css'), 'utf8');

function cssRuleContaining(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = SHELL_CSS.match(new RegExp(`${escaped}[^{]*\\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`Missing CSS rule containing: ${selector}`);
  return match[1];
}

function cssKeyframes(name: string): string {
  const start = SHELL_CSS.indexOf(`@keyframes ${name}`);
  if (start < 0) throw new Error(`Missing @keyframes ${name}`);
  const nextAt = SHELL_CSS.indexOf('@keyframes', start + 1);
  const nextMedia = SHELL_CSS.indexOf('\n@media', start + 1);
  const end = Math.min(
    nextAt === -1 ? SHELL_CSS.length : nextAt,
    nextMedia === -1 ? SHELL_CSS.length : nextMedia,
  );
  return SHELL_CSS.slice(start, end);
}

describe('LoadingPixelGrid Drive contract', () => {
  afterEach(cleanup);

  it('staggers the 3x3 cells with the Beautiful UI Drive chevron delays', () => {
    expect(LOADING_PIXEL_DRIVE_DELAYS_MS).toEqual([90, 180, 270, 0, 90, 180, 90, 180, 270]);

    render(<LoadingPixelGrid />);
    const cells = [...screen.getByTestId('loading-pixel-grid').children];
    expect(cells).toHaveLength(9);
    expect(
      cells.map((cell) => (cell as HTMLElement).style.getPropertyValue('--shell-pixel-delay')),
    ).toEqual(LOADING_PIXEL_DRIVE_DELAYS_MS.map((delay) => `${delay}ms`));
  });

  it('uses the Drive pixel-on plateau, 1.5px gap, and ink-text shimmer', () => {
    expect(cssRuleContaining('.shell-loading-pixel-grid')).toContain('gap: 1.5px');
    expect(cssRuleContaining('.shell-loading-pixel-grid__cell')).toMatch(
      /animation:\s*shell-loading-pixel-on 650ms ease-in-out infinite/,
    );
    expect(cssRuleContaining('.shell-loading-pixel-grid__cell')).toContain('opacity: 0.15');

    const pixelOn = cssKeyframes('shell-loading-pixel-on');
    expect(pixelOn).toMatch(/0%,\s*100%\s*\{\s*opacity:\s*0\.15;/);
    expect(pixelOn).toMatch(/18%,\s*42%\s*\{\s*opacity:\s*1;/);
    expect(pixelOn).toMatch(/62%\s*\{\s*opacity:\s*0\.15;/);
    expect(pixelOn).not.toContain('opacity: 0.38');

    const shimmerRule = cssRuleContaining('.shell-text-shimmer::after');
    expect(shimmerRule).toContain('90deg');
    expect(shimmerRule).toContain('35%');
    expect(shimmerRule).toContain('50%');
    expect(shimmerRule).toContain('65%');
    expect(shimmerRule).toContain('background-size: 200% 100%');
    expect(shimmerRule).toMatch(/animation:\s*shell-activity-shimmer 1\.4s linear infinite/);
    expect(shimmerRule).not.toContain('var(--color-accent)');

    const shimmer = cssKeyframes('shell-activity-shimmer');
    expect(shimmer).toContain('150% center');
    expect(shimmer).toContain('-50% center');
  });
});
