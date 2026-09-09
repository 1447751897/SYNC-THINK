/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GridReveal } from './GridReveal.js';

afterEach(() => {
  cleanup();
});

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => null,
  });
});

describe('GridReveal', () => {
  it('renders the waiting caption before an image arrives', () => {
    render(<GridReveal src={null} caption="生成中" aspect={1} />);
    expect(screen.getByTestId('grid-reveal-caption').textContent).toBe('生成中');
    expect(document.querySelector('[data-slot="grid-reveal"]')).toBeTruthy();
  });
});
