/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MermaidChart } from './MermaidChart.js';

const vendor = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({
    svg: '<svg data-testid="rendered-mermaid" viewBox="0 0 100 60"><text>chart</text></svg>',
  })),
}));

vi.mock('./mermaid-vendor-loader.js', () => ({
  loadMermaidVendor: vi.fn(async () => vendor),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MermaidChart', () => {
  it('opens the rendered chart in a dismissible enlarged dialog', async () => {
    render(<MermaidChart code={'flowchart LR\nA --> B'} />);

    const enlarge = screen.getByRole('button', { name: '\u653e\u5927\u67e5\u770b\u56fe\u8868' });
    await waitFor(() => expect((enlarge as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(enlarge);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.innerHTML).toContain('rendered-mermaid');
    expect(screen.getByText('Mermaid \u56fe\u8868\u9884\u89c8')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '\u5173\u95ed\u653e\u5927\u56fe\u8868' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
