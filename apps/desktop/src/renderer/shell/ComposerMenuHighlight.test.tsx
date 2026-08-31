/**
 * @vitest-environment jsdom
 */
import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerMenuHighlight } from './ComposerMenuHighlight.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Fixture() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  return (
    <div ref={rootRef} className="shell-composer-menu">
      <ComposerMenuHighlight containerRef={rootRef} activeIndex={active} />
      {['first', 'second'].map((label, index) => (
        <button
          key={label}
          type="button"
          data-composer-menu-index={index}
          aria-selected={active === index}
          onMouseEnter={() => setActive(index)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

describe('ComposerMenuHighlight', () => {
  it('moves one shared highlight between menu items using measured geometry', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.textContent === 'second' ? 44 : 4;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.textContent === 'second' ? 38 : 36;
    });

    render(<Fixture />);
    const highlight = screen.getByTestId('composer-menu-highlight');
    expect(highlight.style.transform).toBe('translateY(4px)');
    expect(highlight.style.height).toBe('36px');

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'second' }));
    expect(highlight.style.transform).toBe('translateY(44px)');
    expect(highlight.style.height).toBe('38px');
  });
});
