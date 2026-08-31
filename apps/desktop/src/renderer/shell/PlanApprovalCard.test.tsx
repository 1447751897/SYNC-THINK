/**
 * @vitest-environment jsdom
 *
 * 可编辑方案卡：渲染草稿、就地编辑 → dirty 校验（批准禁用）、保存为新版本、
 * 批准后触发执行指令、历史版本只读回看、取消计划。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ChatPlanRevision, ConversationId, ConversationPlanSummary } from '@sync-think/shared';
import {
  buildPlanExecutionInstruction,
  PlanApprovalCard,
  type PlanApprovalCardProps,
} from './PlanApprovalCard.js';

const convId = 'conv-1' as ConversationId;

const revision: ChatPlanRevision = {
  id: 'rev-1',
  conversationId: convId,
  revision: 1,
  plan: {
    title: '重构登录模块',
    goal: '把登录模块改为新架构',
    scope: ['apps/desktop/src/auth'],
    assumptions: ['依赖已就绪'],
    decisions: ['使用 vitest'],
    steps: [
      {
        id: 'step-1',
        title: '拆分 auth 包',
        description: '将登录逻辑拆为独立包',
        expectedFiles: ['packages/auth'],
        acceptanceChecks: ['测试通过'],
      },
    ],
    risks: [{ description: '回归风险', mitigation: '跑全量测试' }],
    finalAcceptanceChecks: ['全部测试通过'],
  },
  state: 'draft',
  createdAt: '2025-01-01T00:00:00.000Z',
};

const summary: ConversationPlanSummary = {
  planId: 'plan-1',
  conversationId: convId,
  currentRevision: 1,
  state: 'draft',
  latest: revision,
  revisions: [revision],
};

function mockBridge(overrides: Record<string, unknown> = {}) {
  const runtime = {
    conversationPlanRevise: vi.fn(async () => ({ plan: summary })),
    conversationPlanApprove: vi.fn(async () => ({ plan: { ...summary, state: 'approved' } })),
    conversationPlanCancel: vi.fn(async () => ({ plan: { ...summary, state: 'cancelled' } })),
    ...overrides,
  };
  (window as unknown as Record<string, unknown>).syncThink = { runtime };
  return runtime;
}

function renderCard(props: Partial<PlanApprovalCardProps> = {}) {
  const onPlanUpdated = vi.fn();
  const onExecute = vi.fn(async () => undefined);
  const onSwitchMode = vi.fn(async () => undefined);
  const onNotify = vi.fn();
  const view = render(
    <PlanApprovalCard
      conversationId={convId}
      plan={summary}
      onPlanUpdated={onPlanUpdated}
      onExecute={onExecute}
      onSwitchMode={onSwitchMode}
      onNotify={onNotify}
      {...props}
    />,
  );
  return { onPlanUpdated, onExecute, onSwitchMode, onNotify, view };
}

describe('PlanApprovalCard', () => {
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).syncThink;
  });

  it('renders the draft plan fields read-write', () => {
    renderCard();
    expect(screen.getByTestId('plan-approval-card')).toBeTruthy();
    expect((screen.getByLabelText('计划标题') as HTMLInputElement).value).toBe('重构登录模块');
    expect((screen.getByLabelText('计划目标') as HTMLTextAreaElement).value).toBe(
      '把登录模块改为新架构',
    );
    expect(screen.getByLabelText('步骤 1 标题')).toBeTruthy();
    expect(screen.getByLabelText('验收标准 1')).toBeTruthy();
  });

  it('renders the NewMax composer approval surface as a compact summary', () => {
    renderCard({ variant: 'composer' });

    const card = screen.getByTestId('plan-approval-card');
    expect(card.getAttribute('data-variant')).toBe('composer');
    expect(card.textContent).toContain('方案待确认');
    expect(card.textContent).toContain('重构登录模块');
    expect(card.textContent).toContain('拆分 auth 包');
    expect(screen.queryByLabelText('计划标题')).toBeNull();
    expect(screen.getByRole('button', { name: '批准并执行' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '要求修改' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy();
  });

  it('expands the compact approval surface to show the complete plan', () => {
    renderCard({ variant: 'composer' });

    const toggle = screen.getByTestId('plan-view-details');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('plan-approval-details')).toBeNull();

    fireEvent.click(toggle);

    const details = screen.getByTestId('plan-approval-details');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const detailText = details.textContent ?? '';
    expect(detailText).toContain('目标');
    expect(detailText).toContain('把登录模块改为新架构');
    expect(detailText).toContain('范围');
    expect(detailText).toContain('apps/desktop/src/auth');
    expect(detailText).toContain('假设');
    expect(detailText).toContain('依赖已就绪');
    expect(detailText).toContain('决策');
    expect(detailText).toContain('使用 vitest');
    expect(detailText).toContain('拆分 auth 包');
    expect(detailText).toContain('将登录逻辑拆为独立包');
    expect(detailText).toContain('测试通过');
    expect(detailText).toContain('风险');
    expect(detailText).toContain('回归风险');
    expect(detailText).toContain('跑全量测试');
    expect(detailText).toContain('全部测试通过');

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('plan-approval-details')).toBeNull();
  });

  it('disables approve while dirty and saves a revision to clear it', async () => {
    const { onPlanUpdated } = renderCard();
    const approve = screen.getByTestId('plan-approve');
    // 无未保存改动：可批准。
    expect(approve.hasAttribute('disabled')).toBe(false);

    const title = screen.getByLabelText('计划标题');
    fireEvent.change(title, { target: { value: '重构登录模块（v2）' } });
    expect(screen.getByTestId('plan-dirty-note')).toBeTruthy();
    expect(approve.hasAttribute('disabled')).toBe(true);

    // 保存：调用 revise，生成新版本后恢复可批准。
    const nextRevision: ChatPlanRevision = {
      ...revision,
      id: 'rev-2',
      revision: 2,
      plan: { ...revision.plan, title: '重构登录模块（v2）' },
    };
    const runtime = mockBridge({
      conversationPlanRevise: vi.fn(async () => ({
        plan: {
          ...summary,
          currentRevision: 2,
          latest: nextRevision,
          revisions: [nextRevision, revision],
        },
      })),
    });
    fireEvent.click(screen.getByTestId('plan-save'));
    await Promise.resolve();
    expect(runtime.conversationPlanRevise).toHaveBeenCalledWith({
      conversationId: convId,
      expectedRevision: 1,
      plan: expect.objectContaining({ title: '重构登录模块（v2）' }),
    });
    expect(onPlanUpdated).toHaveBeenCalled();
  });

  it('approve runs the full plan→execute handoff and clears the card', async () => {
    const runtime = mockBridge();
    const { onExecute, onSwitchMode, onPlanUpdated } = renderCard();
    fireEvent.click(screen.getByTestId('plan-approve'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.conversationPlanApprove).toHaveBeenCalledWith({
      conversationId: convId,
      revision: 1,
    });
    expect(onSwitchMode).toHaveBeenCalledWith('execute');
    expect(onExecute).toHaveBeenCalledWith(buildPlanExecutionInstruction(revision, 1));
    expect(onPlanUpdated).toHaveBeenCalledWith(undefined);
  });

  it('shows a read-only history revision and returns to editing', () => {
    const older: ChatPlanRevision = {
      ...revision,
      id: 'rev-0',
      revision: 0,
      plan: { ...revision.plan, title: '旧版标题' },
    };
    const multi = { ...summary, revisions: [revision, older] };
    renderCard({ plan: multi });

    fireEvent.click(screen.getByTitle('查看历史版本 v0（只读）'));
    expect(screen.getByTestId('plan-history-note')).toBeTruthy();
    // 历史模式：标题以只读 span 呈现，目标 textarea 禁用。
    expect(screen.getByText('旧版标题')).toBeTruthy();
    expect((screen.getByLabelText('计划目标') as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.getByTestId('plan-approve').hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '返回编辑最新版本' }));
    expect(screen.queryByTestId('plan-history-note')).toBeNull();
    expect((screen.getByLabelText('计划标题') as HTMLInputElement).disabled).toBe(false);
  });

  it('cancels the plan through conversation.plan.cancel', async () => {
    const runtime = mockBridge();
    const { onPlanUpdated } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: '取消计划' }));
    await Promise.resolve();
    expect(runtime.conversationPlanCancel).toHaveBeenCalledWith({ conversationId: convId });
    expect(onPlanUpdated).toHaveBeenCalledWith(undefined);
  });

  it('adds and removes steps with validation feedback', () => {
    renderCard();
    const stepsBefore = screen.getAllByLabelText(/步骤 \d+ 标题/).length;
    fireEvent.click(screen.getByRole('button', { name: '添加步骤' }));
    expect(screen.getAllByLabelText(/步骤 \d+ 标题/).length).toBe(stepsBefore + 1);

    const title = screen.getByLabelText('计划标题');
    fireEvent.change(title, { target: { value: '' } });
    expect(screen.getByRole('alert').textContent).toContain('必填');
    expect(screen.getByTestId('plan-save').hasAttribute('disabled')).toBe(true);
  });

  it('renders step acceptance checks inside the step editor', () => {
    renderCard();
    const stepEditor = screen
      .getByLabelText('步骤 1 标题')
      .closest('.shell-plan-card__step-editor');
    expect(stepEditor).toBeTruthy();
    expect(within(stepEditor as HTMLElement).getByLabelText('验收标准 1')).toBeTruthy();
  });
});
