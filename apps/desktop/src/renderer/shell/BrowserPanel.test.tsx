/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserPanel } from './BrowserPanel.js';

afterEach(cleanup);

describe('BrowserPanel layout contract', () => {
  it('fills a flex pane host instead of shrinking to the toolbar width', () => {
    render(
      <BrowserPanel
        embedded
        registerForAutomation={false}
        initialUrl="https://example.test"
        onClose={vi.fn()}
      />,
    );

    const panel = screen.getByTestId('browser-panel');
    expect(panel.classList.contains('flex-1')).toBe(true);
    expect(panel.classList.contains('min-w-0')).toBe(true);
  });
});
