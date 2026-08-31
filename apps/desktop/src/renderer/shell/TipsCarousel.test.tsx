/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_HOME_TIPS,
  TIP_FADE_DURATION_MS,
  TIP_ROTATE_INTERVAL_MS,
  TipsCarousel,
} from './TipsCarousel.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.documentElement.removeAttribute('data-reduced-motion');
});

describe('TipsCarousel', () => {
  it('cycles the 13 NewMax home tips after a seven-second hold and 500ms fade', () => {
    vi.useFakeTimers();
    render(<TipsCarousel />);

    expect(DEFAULT_HOME_TIPS).toHaveLength(13);
    expect(screen.getByTestId('home-tip-text').textContent).toBe(DEFAULT_HOME_TIPS[0]);
    expect(screen.getByTestId('home-tips-carousel').dataset.fading).toBe('false');

    act(() => vi.advanceTimersByTime(TIP_ROTATE_INTERVAL_MS - 1));
    expect(screen.getByTestId('home-tip-text').textContent).toBe(DEFAULT_HOME_TIPS[0]);

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('home-tips-carousel').dataset.fading).toBe('true');
    expect(screen.getByTestId('home-tip-text').textContent).toBe(DEFAULT_HOME_TIPS[0]);

    act(() => vi.advanceTimersByTime(TIP_FADE_DURATION_MS));
    expect(screen.getByTestId('home-tip-text').textContent).toBe(DEFAULT_HOME_TIPS[1]);
    expect(screen.getByTestId('home-tips-carousel').dataset.fading).toBe('false');
  });

  it('switches without a fade when reduced motion is enabled', () => {
    vi.useFakeTimers();
    document.documentElement.setAttribute('data-reduced-motion', '');
    render(<TipsCarousel />);

    act(() => vi.advanceTimersByTime(TIP_ROTATE_INTERVAL_MS));

    expect(screen.getByTestId('home-tip-text').textContent).toBe(DEFAULT_HOME_TIPS[1]);
    expect(screen.getByTestId('home-tips-carousel').dataset.fading).toBe('false');
  });
});
