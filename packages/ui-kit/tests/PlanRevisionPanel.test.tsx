import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlanRevision } from '@sync-think/shared';
import { PlanRevisionPanel } from '../src/components/PlanRevisionPanel.js';

afterEach(() => cleanup());

const v1: PlanRevision = {
  id: 'plan-revision-1' as never,
  planId: 'plan-1' as never,
  taskId: 'task-1' as never,
  revision: 1,
  title: 'M2 initial',
  state: 'superseded',
  steps: [
    {
      id: 'design' as never,
      title: 'Design',
      instructions: 'Create the design candidate.',
      agentVersionId: 'agent-version-designer' as never,
      dependsOn: [],
    },
  ],
  diffFromPrevious: { added: [], removed: [], changed: [] },
  createdAt: '2026-07-14T00:00:00.000Z',
};

const draft: PlanRevision = {
  ...v1,
  id: 'plan-revision-2' as never,
  revision: 2,
  title: 'M2 draft',
  state: 'draft',
  steps: [
    v1.steps[0]!,
    {
      id: 'image' as never,
      kind: 'execution',
      title: 'Image',
      instructions: 'Create an image candidate.',
      agentVersionId: 'agent-version-image' as never,
      modelOverrideId: 'model-image' as never,
      dependsOn: [],
    },
    {
      id: 'merge' as never,
      kind: 'merge',
      title: 'Merge',
      instructions: 'Merge the design and image candidates.',
      agentVersionId: 'agent-version-designer' as never,
      dependsOn: ['design', 'image'] as never,
    },
  ],
  diffFromPrevious: { added: [], removed: [], changed: [] },
  createdAt: '2026-07-14T00:01:00.000Z',
};

describe('PlanRevisionPanel', () => {
  it('saves edits as a new immutable revision but cannot approve the stale dirty revision', () => {
    const revise = vi.fn();
    const approve = vi.fn();

    render(
      <PlanRevisionPanel
        revision={draft}
        revisions={[v1, draft]}
        onRevise={revise}
        onApprove={approve}
      />,
    );

    fireEvent.change(screen.getByLabelText('计划标题'), {
      target: { value: 'M2 revised' },
    });
    fireEvent.change(screen.getByLabelText('步骤 2 标题'), {
      target: { value: 'Image candidate' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存新版本' }));

    expect(revise).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'plan-1',
        expectedRevision: 2,
        title: 'M2 revised',
        steps: expect.arrayContaining([
          expect.objectContaining({ id: 'image', title: 'Image candidate' }),
          expect.objectContaining({ id: 'merge', kind: 'merge' }),
        ]),
      }),
    );

    const approveButton = screen.getByRole('button', { name: '批准版本 2' });
    expect(approveButton).toHaveProperty('disabled', true);
    expect(screen.getByTestId('plan-dirty-note').textContent).toMatch(/保存|版本/);
    fireEvent.click(approveButton);
    expect(approve).not.toHaveBeenCalled();
  });

  it('approves the selected persisted draft when there are no unsaved edits', () => {
    const approve = vi.fn();
    render(<PlanRevisionPanel revision={draft} revisions={[v1, draft]} onApprove={approve} />);

    fireEvent.click(screen.getByRole('button', { name: '批准版本 2' }));
    expect(approve).toHaveBeenCalledWith({ planId: 'plan-1', revision: 2 });
  });

  it('shows revision history and exact AgentVersion pins', () => {
    render(<PlanRevisionPanel revision={draft} revisions={[v1, draft]} />);

    expect(screen.getAllByTestId(/plan-revision-/)).toHaveLength(2);
    expect(screen.getByTestId('plan-step-design').textContent).toContain('agent-version-designer');
    expect(screen.getByTestId('plan-step-image').textContent).toContain('agent-version-image');
  });

  it('is fully read-only when authoring callbacks are omitted', () => {
    render(<PlanRevisionPanel revision={draft} revisions={[v1, draft]} />);

    expect(screen.getByLabelText('计划标题')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('步骤 3 类型')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '添加步骤' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '保存新版本' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: '批准版本 2' })).toHaveProperty('disabled', true);
  });

  it('edits and saves a strict image generation configuration', () => {
    const revise = vi.fn();
    render(
      <PlanRevisionPanel revision={draft} revisions={[v1, draft]} onRevise={revise} />,
    );

    const generation = screen.getByLabelText('\u6b65\u9aa4 2 \u56fe\u7247\u751f\u6210');
    expect(generation).toHaveProperty('value', 'disabled');
    fireEvent.change(generation, { target: { value: 'enabled' } });

    const size = screen.getByLabelText('\u6b65\u9aa4 2 \u56fe\u7247\u5c3a\u5bf8');
    const quality = screen.getByLabelText('\u6b65\u9aa4 2 \u56fe\u7247\u8d28\u91cf');
    const count = screen.getByLabelText('\u6b65\u9aa4 2 \u5019\u9009\u6570\u91cf');
    expect(size).toHaveProperty('value', 'auto');
    expect(quality).toHaveProperty('value', 'auto');
    expect(count).toHaveProperty('value', '1');

    fireEvent.change(size, { target: { value: '1024x1536' } });
    fireEvent.change(quality, { target: { value: 'high' } });
    fireEvent.change(count, { target: { value: '3' } });
    fireEvent.click(
      screen.getByRole('button', { name: '\u4fdd\u5b58\u65b0\u7248\u672c' }),
    );

    expect(revise).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: expect.arrayContaining([
          expect.objectContaining({
            id: 'image',
            imageGeneration: {
              size: '1024x1536',
              quality: 'high',
              count: 3,
            },
          }),
        ]),
      }),
    );
  });

  it('clears image generation configuration when an execution Step becomes merge', () => {
    const revise = vi.fn();
    render(
      <PlanRevisionPanel revision={draft} revisions={[v1, draft]} onRevise={revise} />,
    );

    fireEvent.change(screen.getByLabelText('\u6b65\u9aa4 3 \u7c7b\u578b'), {
      target: { value: 'execution' },
    });
    fireEvent.change(
      screen.getByLabelText('\u6b65\u9aa4 3 \u56fe\u7247\u751f\u6210'),
      { target: { value: 'enabled' } },
    );
    fireEvent.change(screen.getByLabelText('\u6b65\u9aa4 3 \u7c7b\u578b'), {
      target: { value: 'merge' },
    });
    expect(
      screen.queryByLabelText('\u6b65\u9aa4 3 \u56fe\u7247\u751f\u6210'),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText('\u6b65\u9aa4 3 \u6807\u9898'), {
      target: { value: 'Merge updated' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '\u4fdd\u5b58\u65b0\u7248\u672c' }),
    );

    const input = revise.mock.calls[0]![0] as { steps: Array<Record<string, unknown>> };
    const mergeStep = input.steps.find((step) => step.id === 'merge');
    expect(mergeStep).toMatchObject({ id: 'merge', kind: 'merge', title: 'Merge updated' });
    expect(mergeStep).not.toHaveProperty('imageGeneration');
  });

  it('disables image generation controls in read-only mode', () => {
    const configuredDraft: PlanRevision = {
      ...draft,
      steps: draft.steps.map((step) =>
        step.id === 'image'
          ? {
              ...step,
              imageGeneration: { size: '1536x1024', quality: 'high', count: 3 },
            }
          : step,
      ),
    };
    render(<PlanRevisionPanel revision={configuredDraft} revisions={[v1, configuredDraft]} />);

    expect(
      screen.getByLabelText('\u6b65\u9aa4 2 \u56fe\u7247\u751f\u6210'),
    ).toHaveProperty('disabled', true);
    expect(
      screen.getByLabelText('\u6b65\u9aa4 2 \u56fe\u7247\u5c3a\u5bf8'),
    ).toHaveProperty('disabled', true);
    expect(
      screen.getByLabelText('\u6b65\u9aa4 2 \u56fe\u7247\u8d28\u91cf'),
    ).toHaveProperty('disabled', true);
    expect(
      screen.getByLabelText('\u6b65\u9aa4 2 \u5019\u9009\u6570\u91cf'),
    ).toHaveProperty('disabled', true);
  });

});
