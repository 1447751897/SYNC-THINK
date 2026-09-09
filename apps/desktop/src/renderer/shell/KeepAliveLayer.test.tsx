/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { KeepAliveLayer } from './KeepAliveLayer.js';

afterEach(() => {
  cleanup();
});

describe('KeepAliveLayer', () => {
  it('mounts a surface on first visit and hides it instead of unmounting', () => {
    const { rerender } = render(
      <KeepAliveLayer active testId="layer-one">
        <span data-testid="one-marker">one body</span>
      </KeepAliveLayer>,
    );
    expect(screen.getByTestId('one-marker')).toBeTruthy();

    rerender(
      <KeepAliveLayer active={false} testId="layer-one">
        <span data-testid="one-marker">one body</span>
      </KeepAliveLayer>,
    );
    const one = screen.getByTestId('one-marker');
    expect(screen.getByTestId('layer-one').hasAttribute('hidden')).toBe(true);

    rerender(
      <KeepAliveLayer active testId="layer-one">
        <span data-testid="one-marker">one body</span>
      </KeepAliveLayer>,
    );
    expect(screen.getByTestId('one-marker')).toBe(one);
    expect(screen.getByTestId('layer-one').hasAttribute('hidden')).toBe(false);
  });

  it('can hide without collapsing layout', () => {
    const { rerender } = render(
      <KeepAliveLayer active preserveLayout testId="layer-talk">
        <span data-testid="talk-marker">talk</span>
      </KeepAliveLayer>,
    );
    rerender(
      <KeepAliveLayer active={false} preserveLayout testId="layer-talk">
        <span data-testid="talk-marker">talk</span>
      </KeepAliveLayer>,
    );
    expect(screen.getByTestId('talk-marker')).toBeTruthy();
    expect(screen.getByTestId('layer-talk').hasAttribute('hidden')).toBe(false);
    expect(screen.getByTestId('layer-talk').getAttribute('data-active')).toBe('false');
  });

  it('does not mount a layer until it has been active once', () => {
    const { rerender } = render(
      <KeepAliveLayer active={false} testId="layer-two">
        <span data-testid="two-marker">two body</span>
      </KeepAliveLayer>,
    );
    expect(screen.queryByTestId('two-marker')).toBeNull();

    rerender(
      <KeepAliveLayer active testId="layer-two">
        <span data-testid="two-marker">two body</span>
      </KeepAliveLayer>,
    );
    expect(screen.getByTestId('two-marker')).toBeTruthy();
    expect(screen.getByTestId('layer-two').hasAttribute('hidden')).toBe(false);
  });
});
