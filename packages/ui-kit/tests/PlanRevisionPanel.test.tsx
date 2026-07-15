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
});
