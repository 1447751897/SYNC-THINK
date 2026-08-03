import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ExecutionGraphPanel } from '../src/components/ExecutionGraphPanel.js';

afterEach(() => cleanup());

const parallelGraph = {
  run: {
    id: 'run-1',
    state: 'running' as const,
    planRevisionId: 'plan-revision-2',
  },
  steps: [
    {
      id: 'design',
      title: 'Design',
      agentVersionId: 'agent-version-designer',
      state: 'running' as const,
      dependsOn: [] as string[],
      modelId: 'model-design',
      retries: 0,
      reviewIteration: 0,
      currentArtifactVersion: 1,
    },
    {
      id: 'image',
      title: 'Image',
      agentVersionId: 'agent-version-image',
      state: 'running' as const,
      dependsOn: [] as string[],
      modelId: 'model-image',
      retries: 1,
      reviewIteration: 0,
      currentArtifactVersion: 2,
    },
    {
      id: 'review',
      title: 'Review',
      agentVersionId: 'agent-version-reviewer',
      state: 'pending' as const,
      dependsOn: ['design', 'image'],
      retries: 0,
      reviewIteration: 1,
    },
  ],
};

describe('ExecutionGraphPanel', () => {
  it('renders parallel state and operational metadata without collapsing nodes', () => {
    render(<ExecutionGraphPanel graph={parallelGraph} />);

    expect(screen.getByTestId('step-design').getAttribute('data-state')).toBe('running');
    expect(screen.getByTestId('step-image').getAttribute('data-state')).toBe('running');
    expect(screen.getByTestId('step-review').textContent).toContain('design, image');
    expect(screen.getByTestId('step-image').textContent).toMatch(/重试 1/);
    expect(screen.getByTestId('step-image').textContent).toMatch(/产物 v2/);
    expect(screen.getByTestId('step-review').textContent).toMatch(/返工 1/);
  });

  it('exposes pause, resume and cancel controls as native buttons', () => {
    const pause = vi.fn();
    const resume = vi.fn();
    const cancel = vi.fn();

    const { rerender } = render(
      <ExecutionGraphPanel
        graph={parallelGraph}
        onPause={pause}
        onResume={resume}
        onCancel={cancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '暂停运行' }));
    fireEvent.click(screen.getByRole('button', { name: '取消运行' }));
    expect(pause).toHaveBeenCalledWith('run-1');
    expect(cancel).toHaveBeenCalledWith('run-1');

    rerender(
      <ExecutionGraphPanel
        graph={{ ...parallelGraph, run: { ...parallelGraph.run, state: 'paused' } }}
        onPause={pause}
        onResume={resume}
        onCancel={cancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '继续运行' }));
    expect(resume).toHaveBeenCalledWith('run-1');
  });

  it('stably highlights, scrolls and focuses an exact deep-linked Step', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    render(<ExecutionGraphPanel graph={parallelGraph} selectedStepId="review" />);

    const selected = screen.getByTestId('step-review');
    expect(selected.getAttribute('data-selected')).toBe('1');
    expect(selected.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(selected);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });
  it('renders an opaque image artifact thumbnail on its producing Step', () => {
    render(
      <ExecutionGraphPanel
        graph={{
          ...parallelGraph,
          steps: parallelGraph.steps.map((step) =>
            step.id === 'image'
              ? {
                  ...step,
                  artifactImagePreview: {
                    version: 2,
                    url: 'sync-think-image://artifact/abcdefghijklmnop',
                    mimeType: 'image/png',
                    status: 'candidate',
                  },
                }
              : step,
          ),
        }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Image 图片 v2' }).getAttribute('src')).toBe(
      'sync-think-image://artifact/abcdefghijklmnop',
    );
    expect(screen.getByTestId('step-image').textContent).toContain('image/png');
  });
});
