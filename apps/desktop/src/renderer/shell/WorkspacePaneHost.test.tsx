/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePaneHost } from './WorkspacePaneHost.js';
import { createWorkspacePaneLayout, splitPaneWithConversation } from './pane-layout.js';

afterEach(cleanup);

describe('WorkspacePaneHost', () => {
  it('renders recursively nested horizontal and vertical splits', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const firstPaneId = initial.focusedPaneId;
    const horizontal = splitPaneWithConversation(initial, firstPaneId, 'horizontal', 'c2');
    const nested = splitPaneWithConversation(
      horizontal,
      horizontal.focusedPaneId,
      'vertical',
      'c3',
    );

    render(
      <WorkspacePaneHost
        layout={nested}
        onFocusPane={vi.fn()}
        onSplitRatioChange={vi.fn()}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    );

    expect(document.querySelectorAll('.shell-workspace-pane')).toHaveLength(3);
    expect(screen.getAllByTestId(/^workspace-split-/)).toHaveLength(2);
    expect(document.querySelector('[data-direction="horizontal"]')).toBeTruthy();
    expect(document.querySelector('[data-direction="vertical"]')).toBeTruthy();
  });

  it('focuses a pane and adjusts the divider with the keyboard', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const layout = splitPaneWithConversation(initial, initial.focusedPaneId, 'horizontal', 'c2');
    expect(layout.root.type).toBe('split');
    const splitId = layout.root.id;
    const onFocusPane = vi.fn();
    const onSplitRatioChange = vi.fn();

    render(
      <WorkspacePaneHost
        layout={layout}
        onFocusPane={onFocusPane}
        onSplitRatioChange={onSplitRatioChange}
        renderPane={(pane) => <button type="button">{pane.id}</button>}
      />,
    );

    const firstPane = screen.getByTestId(`workspace-pane-${initial.focusedPaneId}`);
    fireEvent.mouseDown(firstPane);
    expect(onFocusPane).toHaveBeenCalledWith(initial.focusedPaneId);

    const separator = screen.getByRole('separator');
    expect(separator.getAttribute('aria-orientation')).toBe('vertical');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(onSplitRatioChange).toHaveBeenCalledWith(splitId, 0.55, true);
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(onSplitRatioChange).toHaveBeenCalledWith(splitId, 0.2, true);
  });

  it('focuses a pane when keyboard focus enters one of its descendants', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const layout = splitPaneWithConversation(initial, initial.focusedPaneId, 'horizontal', 'c2');
    const onFocusPane = vi.fn();

    render(
      <WorkspacePaneHost
        layout={layout}
        onFocusPane={onFocusPane}
        onSplitRatioChange={vi.fn()}
        renderPane={(pane) => (
          <button type="button" data-testid={`focus-control-${pane.id}`}>
            {pane.id}
          </button>
        )}
      />,
    );

    const targetPaneId = layout.focusedPaneId;
    fireEvent.focus(screen.getByTestId(`focus-control-${targetPaneId}`));
    expect(onFocusPane).toHaveBeenCalledWith(targetPaneId);
  });

  it('covers the workspace while a divider is dragged and commits the final ratio', () => {
    const initial = createWorkspacePaneLayout('ws-a', ['c1', 'c2'], 'c1');
    const layout = splitPaneWithConversation(initial, initial.focusedPaneId, 'horizontal', 'c2');
    expect(layout.root.type).toBe('split');
    const onSplitRatioChange = vi.fn();

    render(
      <WorkspacePaneHost
        layout={layout}
        onFocusPane={vi.fn()}
        onSplitRatioChange={onSplitRatioChange}
        renderPane={(pane) => <div>{pane.id}</div>}
      />,
    );

    const separator = screen.getByRole('separator');
    const split = screen.getByTestId(`workspace-split-${layout.root.id}`);
    vi.spyOn(split, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1_000,
      bottom: 600,
      width: 1_000,
      height: 600,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(separator, { clientX: 500 });
    expect(document.querySelector('.shell-pane-resize-shield')).toBeTruthy();
    expect(document.body.style.cursor).toBe('col-resize');

    fireEvent.mouseMove(window, { clientX: 600 });
    expect(onSplitRatioChange).toHaveBeenCalledWith(layout.root.id, 0.6, false);
    fireEvent.mouseUp(window);
    expect(document.querySelector('.shell-pane-resize-shield')).toBeNull();
    expect(document.body.style.cursor).toBe('');
    expect(onSplitRatioChange).toHaveBeenLastCalledWith(layout.root.id, 0.6, true);
  });
});
