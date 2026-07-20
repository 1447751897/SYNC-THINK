import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ApprovalCenterPanel,
  projectApprovalGateReadiness,
  type ApprovalItemView,
} from '../src/components/ApprovalCenterPanel.js';

const samplePending: ApprovalItemView = {
  id: 'a1',
  kind: 'tool',
  action: 'shell.exec',
  summary: 'Run npm test',
  humanOnly: false,
  mode: 'request',
  gate: 'require-human',
  state: 'pending',
  createdAt: '2026-07-12T12:00:00.000Z',
};

const sampleHuman: ApprovalItemView = {
  id: 'a2',
  kind: 'human-only',
  action: 'payment-or-purchase',
  summary: 'Buy domain',
  humanOnly: true,
  humanOnlyAction: 'payment-or-purchase',
  mode: 'full',
  gate: 'require-human',
  state: 'pending',
  createdAt: '2026-07-12T12:01:00.000Z',
};

describe('ApprovalCenterPanel (section 13)', () => {
  it('uses theme-aware design tokens instead of dark-only fallback variables', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8');
    const approvalCss = css.slice(
      css.indexOf('/* Approval Center'),
      css.indexOf('/* MCP discovered tool catalog'),
    );

    expect(approvalCss).toContain('var(--st-color-surface)');
    expect(approvalCss).toContain('var(--st-color-text-primary)');
    expect(approvalCss).not.toMatch(
      /var\(--st-(?:surface(?:-2)?|text(?:-muted|-secondary)?|accent|border)(?:,|\))/,
    );
  });

  it('renders human-only chips and empty pending', () => {
    render(
      <ApprovalCenterPanel
        items={[]}
        pendingCount={0}
        humanOnlyActions={[
          'irreversible-deletion',
          'payment-or-purchase',
          'access-or-create-secret',
        ]}
      />,
    );
    expect(screen.getByTestId('approval-center-panel')).toBeTruthy();
    expect(screen.getByTestId('approval-human-only-chips').children.length).toBe(3);
    expect(screen.getByTestId('approval-pending-empty')).toBeTruthy();
    expect(screen.getByTestId('approval-pending-empty').textContent).toMatch(/暂无待审|入队演示/);
  });

  it('shows gate readiness strip with human-only and idle queue', () => {
    render(
      <ApprovalCenterPanel
        items={[]}
        pendingCount={0}
        humanOnlyActions={[
          'irreversible-deletion',
          'payment-or-purchase',
          'access-or-create-secret',
        ]}
      />,
    );
    const strip = screen.getByTestId('approval-gate-readiness');
    expect(strip.getAttribute('data-level')).toMatch(/ready|empty|partial/);
    expect(screen.getByTestId('approval-gate-readiness-badge').textContent).toMatch(
      /闸门空闲|尚未观测|进行中/,
    );
    expect(screen.getByTestId('approval-gate-check-human').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('approval-gate-check-pending').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('approval-gate-check-human').textContent).toMatch(/敏感操作|3/);
    expect(screen.getByTestId('approval-gate-readiness-note').textContent).toMatch(
      /完全访问|审计记录/,
    );
  });

  it('attention level when pending items exist', () => {
    render(
      <ApprovalCenterPanel
        items={[
          {
            id: 'p1',
            kind: 'memory',
            action: 'memory.change',
            summary: 'pref',
            humanOnly: false,
            mode: 'request',
            gate: 'require-human',
            state: 'pending',
            createdAt: '2026-07-12T12:00:00.000Z',
          },
        ]}
        pendingCount={1}
      />,
    );
    expect(screen.getByTestId('approval-gate-readiness').getAttribute('data-level')).toBe(
      'attention',
    );
    expect(screen.getByTestId('approval-gate-readiness-badge').textContent).toMatch(/1 待审/);
    expect(screen.getByTestId('approval-gate-check-pending').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('approval-gate-check-bridge').textContent).toMatch(/记忆|桥接/);
  });

  it('lists pending and fires decide', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalCenterPanel
        items={[samplePending, sampleHuman]}
        pendingCount={2}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByTestId('approval-pending-a1')).toBeTruthy();
    expect(screen.getByTestId('approval-pending-a2').getAttribute('data-human-only')).toBe('true');
    const humanActor = screen.getByTestId('approval-decision-actor-a1') as HTMLSelectElement;
    expect(humanActor.value).toBe('human');
    expect(humanActor.disabled).toBe(true);
    expect(humanActor.querySelector('option[value="delegate"]')).toBeNull();
    fireEvent.click(screen.getByTestId('approval-approve-a1'));
    await waitFor(() => {
      expect(onDecide).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1', decision: 'approved' }),
      );
    });
    fireEvent.click(screen.getByTestId('approval-reject-a2'));
    await waitFor(() => {
      expect(onDecide).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a2', decision: 'rejected' }),
      );
    });
  });

  it('fires evaluate and enqueue demo', async () => {
    const onEvaluateDemo = vi.fn().mockResolvedValue(undefined);
    const onEnqueueDemo = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalCenterPanel
        items={[]}
        productMode={false}
        onEvaluateDemo={onEvaluateDemo}
        onEnqueueDemo={onEnqueueDemo}
      />,
    );
    fireEvent.change(screen.getByTestId('approval-demo-mode'), { target: { value: 'full' } });
    fireEvent.click(screen.getByTestId('approval-demo-evaluate'));
    await waitFor(() => {
      expect(onEvaluateDemo).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByTestId('approval-demo-human-only'));
    fireEvent.click(screen.getByTestId('approval-demo-enqueue'));
    await waitFor(() => {
      expect(onEnqueueDemo).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'human-only',
          action: 'irreversible-deletion',
        }),
      );
    });
  });

  it('uses product policy, decision notes, actor and Run/Step deep links', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    const onSavePolicy = vi.fn().mockResolvedValue(undefined);
    const onNavigate = vi.fn();
    render(
      <ApprovalCenterPanel
        items={[
          {
            ...samplePending,
            runId: 'run-1',
            stepId: 'step-1',
          },
          {
            ...sampleHuman,
            id: 'history-1',
            state: 'approved',
            decidedBy: 'human',
            decisionNote: '已核对影响范围',
            decidedAt: '2026-07-12T12:02:00.000Z',
          },
        ]}
        policies={[
          {
            id: 'policy-version-1',
            policyId: 'policy-1',
            version: 1,
            scopeType: 'task',
            scopeId: 'task-1',
            approvalMode: 'request',
            rules: [],
            createdAt: '2026-07-12T11:00:00.000Z',
          },
        ]}
        defaultPolicyScope={{ scopeType: 'task', scopeId: 'task-1' }}
        onDecide={onDecide}
        onSavePolicy={onSavePolicy}
        onNavigateToRunStep={onNavigate}
      />,
    );

    expect(screen.queryByTestId('approval-probe')).toBeNull();
    fireEvent.change(screen.getByLabelText('策略审批模式'), { target: { value: 'custom' } });
    fireEvent.click(screen.getByRole('button', { name: '保存策略新版本' }));
    await waitFor(() => {
      expect(onSavePolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: 'task',
          scopeId: 'task-1',
          approvalMode: 'custom',
        }),
      );
    });

    fireEvent.change(screen.getByLabelText('审批说明 a1'), {
      target: { value: '允许本次测试' },
    });
    fireEvent.click(screen.getByTestId('approval-approve-a1'));
    await waitFor(() => {
      expect(onDecide).toHaveBeenCalledWith({
        id: 'a1',
        decision: 'approved',
        decidedBy: 'human',
        decisionNote: '允许本次测试',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '打开 Run run-1 Step step-1' }));
    expect(onNavigate).toHaveBeenCalledWith({ runId: 'run-1', stepId: 'step-1' });
    expect(screen.getByTestId('approval-history-history-1').textContent).toContain(
      '已核对影响范围',
    );
  });

  it('refresh button works', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<ApprovalCenterPanel items={[]} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTestId('approval-refresh'));
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('loads all decided approvals through stable history paging instead of truncating after ten', () => {
    const history = Array.from({ length: 12 }, (_, index): ApprovalItemView => ({
      id: `history-${index + 1}`,
      kind: 'tool',
      action: `tool.action.${index + 1}`,
      summary: `Decision ${index + 1}`,
      humanOnly: false,
      mode: 'request',
      gate: 'require-human',
      state: 'approved',
      decidedBy: 'human',
      createdAt: `2026-07-12T12:${String(index).padStart(2, '0')}:00.000Z`,
      decidedAt: `2026-07-12T13:${String(index).padStart(2, '0')}:00.000Z`,
    }));
    render(<ApprovalCenterPanel items={history} />);

    expect(screen.getByTestId('approval-section-history').textContent).toContain('12');
    expect(screen.queryByTestId('approval-history-history-12')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /加载更多已决记录/ }));
    expect(screen.getByTestId('approval-history-history-12')).toBeTruthy();
  });

  it('round-trips an exact delegate AgentVersion and deep-links pending and history scope', async () => {
    const onSavePolicy = vi.fn().mockResolvedValue(undefined);
    const onNavigate = vi.fn();
    render(
      <ApprovalCenterPanel
        items={[
          {
            ...samplePending,
            workspaceId: 'workspace-1',
            taskId: 'task-1',
            runId: 'run-1',
            stepId: 'step-1',
          },
          {
            ...samplePending,
            id: 'history-scope',
            state: 'approved',
            workspaceId: 'workspace-1',
            taskId: 'task-1',
            runId: 'run-2',
            stepId: 'step-2',
            decidedAt: '2026-07-14T02:00:00.000Z',
          },
        ]}
        policies={[
          {
            id: 'policy-version-3',
            policyId: 'policy-1',
            version: 3,
            scopeType: 'task',
            scopeId: 'task-1',
            approvalMode: 'custom',
            rules: [
              {
                action: 'shell.exec',
                approvalMode: 'delegate',
                delegateAgentVersionId: 'agent-reviewer-v3',
              },
            ],
            createdAt: '2026-07-14T01:00:00.000Z',
          },
        ]}
        delegateAgentVersions={[
          {
            id: 'agent-reviewer-v3',
            agentId: 'agent-reviewer',
            agentName: 'Reviewer',
            version: 3,
          },
          {
            id: 'agent-executor-v2',
            agentId: 'agent-executor',
            agentName: 'Executor',
            version: 2,
          },
        ]}
        defaultPolicyScope={{ scopeType: 'task', scopeId: 'task-1' }}
        onSavePolicy={onSavePolicy}
        onNavigateToRunStep={onNavigate}
      />,
    );

    expect(screen.getByTestId('approval-policy-rule-action')).toHaveProperty('value', 'shell.exec');
    expect(screen.getByTestId('approval-policy-rule-mode')).toHaveProperty('value', 'delegate');
    const delegate = screen.getByTestId('approval-policy-rule-delegate');
    expect(delegate).toHaveProperty('value', 'agent-reviewer-v3');
    expect(delegate.textContent).toMatch(/Reviewer.*v3.*agent-reviewer-v3/);
    fireEvent.click(screen.getByTestId('approval-policy-save'));
    expect(onSavePolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        rules: [
          {
            action: 'shell.exec',
            approvalMode: 'delegate',
            delegateAgentVersionId: 'agent-reviewer-v3',
          },
        ],
      }),
    );

    fireEvent.click(screen.getByTestId('approval-deep-link-a1'));
    expect(onNavigate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      runId: 'run-1',
      stepId: 'step-1',
    });
    fireEvent.click(screen.getByTestId('approval-deep-link-history-scope'));
    expect(onNavigate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      runId: 'run-2',
      stepId: 'step-2',
    });
  });

  it('preserves every later policy rule when editing and saving the first rule', async () => {
    const onSavePolicy = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalCenterPanel
        items={[]}
        policies={[
          {
            id: 'policy-version-multi',
            policyId: 'policy-multi',
            version: 4,
            scopeType: 'task',
            scopeId: 'task-multi',
            approvalMode: 'custom',
            rules: [
              { action: 'shell.exec', approvalMode: 'request' },
              {
                action: 'artifact.publish',
                approvalMode: 'delegate',
                delegateAgentVersionId: 'agent-reviewer-v3',
              },
            ],
            createdAt: '2026-07-14T04:00:00.000Z',
          },
        ]}
        defaultPolicyScope={{ scopeType: 'task', scopeId: 'task-multi' }}
        onSavePolicy={onSavePolicy}
      />,
    );

    expect(screen.getByTestId('approval-policy-preserved-rules').textContent).toMatch(/1/);
    fireEvent.change(screen.getByTestId('approval-policy-rule-action'), {
      target: { value: 'shell.read' },
    });
    fireEvent.click(screen.getByTestId('approval-policy-save'));

    await waitFor(() =>
      expect(onSavePolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          rules: [
            { action: 'shell.read', approvalMode: 'request' },
            {
              action: 'artifact.publish',
              approvalMode: 'delegate',
              delegateAgentVersionId: 'agent-reviewer-v3',
            },
          ],
        }),
      ),
    );
  });

  it('resets the policy form when switching to a scope without a policy', async () => {
    const policy = {
      id: 'policy-version-reset',
      policyId: 'policy-reset',
      version: 1,
      scopeType: 'task' as const,
      scopeId: 'task-with-policy',
      approvalMode: 'custom' as const,
      rules: [{ action: 'shell.exec', approvalMode: 'delegate' as const }],
      createdAt: '2026-07-14T04:30:00.000Z',
    };
    const view = render(
      <ApprovalCenterPanel
        items={[]}
        policies={[policy]}
        defaultPolicyScope={{ scopeType: 'task', scopeId: 'task-with-policy' }}
      />,
    );
    expect(screen.getByTestId('approval-policy-rule-action')).toHaveProperty('value', 'shell.exec');

    view.rerender(
      <ApprovalCenterPanel
        items={[]}
        policies={[policy]}
        defaultPolicyScope={{ scopeType: 'task', scopeId: 'task-without-policy' }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('approval-policy-rule-action')).toHaveProperty('value', '');
      expect(screen.getByTestId('approval-policy-rule-mode')).toHaveProperty('value', 'request');
    });
  });

  it('uses the effective task mode for a new policy draft', () => {
    render(
      <ApprovalCenterPanel
        items={[]}
        policies={[]}
        defaultPolicyScope={{ scopeType: 'task', scopeId: 'task-full' }}
        defaultPolicyMode="full"
      />,
    );

    expect(screen.getByLabelText('策略审批模式')).toHaveProperty('value', 'full');
  });

  it('submits the selected exact delegate AgentVersion and shows it in immutable history', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalCenterPanel
        items={[
          {
            ...samplePending,
            mode: 'delegate',
            gate: 'require-delegate',
            delegateAgentVersionId: 'agent-reviewer-v3',
          },
          {
            ...samplePending,
            id: 'delegate-history',
            mode: 'delegate',
            gate: 'require-delegate',
            state: 'approved',
            decidedBy: 'delegate',
            delegateAgentVersionId: 'agent-reviewer-v3',
            decidedAt: '2026-07-14T03:00:00.000Z',
          },
        ]}
        delegateAgentVersions={[
          {
            id: 'agent-reviewer-v3',
            agentId: 'agent-reviewer',
            agentName: 'Reviewer',
            version: 3,
          },
          {
            id: 'agent-reviewer-v4',
            agentId: 'agent-reviewer',
            agentName: 'Reviewer',
            version: 4,
          },
        ]}
        onDecide={onDecide}
      />,
    );

    const actor = screen.getByTestId('approval-decision-actor-a1') as HTMLSelectElement;
    expect(actor.value).toBe('delegate');
    expect(actor.disabled).toBe(true);
    expect(actor.querySelector('option[value="human"]')).toBeNull();
    const versionSelect = screen.getByTestId('approval-delegate-version-a1');
    expect(versionSelect).toHaveProperty('value', 'agent-reviewer-v3');
    expect(versionSelect.textContent).not.toContain('agent-reviewer-v4');
    fireEvent.click(screen.getByTestId('approval-approve-a1'));

    await waitFor(() =>
      expect(onDecide).toHaveBeenCalledWith({
        id: 'a1',
        decision: 'approved',
        decidedBy: 'delegate',
        delegateAgentVersionId: 'agent-reviewer-v3',
      }),
    );
    expect(screen.getByTestId('approval-history-delegate-history').textContent).toMatch(
      /Reviewer.*v3.*agent-reviewer-v3/,
    );
  });
});

describe('projectApprovalGateReadiness', () => {
  it('projects ready with fallback human-only and idle queue', () => {
    const r = projectApprovalGateReadiness({ items: [] });
    expect(r.level).toBe('ready');
    expect(r.badge).toBe('闸门空闲');
    expect(r.humanOnlyOk).toBe(true);
    expect(r.humanOnlyCount).toBe(7);
    expect(r.pendingCount).toBe(0);
    expect(r.note).toMatch(/完全访问|审计记录/);
    expect(r.note).not.toMatch(/仍需.*外网/);
  });

  it('projects empty when human-only list forced empty and no items', () => {
    const r = projectApprovalGateReadiness({
      items: [],
      humanOnlyActions: [],
      humanOnlyFallback: [],
    });
    expect(r.level).toBe('empty');
    expect(r.badge).toBe('尚未观测');
    expect(r.humanOnlyOk).toBe(false);
  });

  it('projects attention when pendingCount > 0', () => {
    const r = projectApprovalGateReadiness({
      items: [
        { kind: 'memory', state: 'pending' },
        { kind: 'tool', state: 'approved' },
      ],
      pendingCount: 1,
      humanOnlyActions: ['payment-or-purchase', 'access-or-create-secret'],
    });
    expect(r.level).toBe('attention');
    expect(r.badge).toBe('1 待审');
    expect(r.pendingCount).toBe(1);
    expect(r.historyCount).toBe(1);
    expect(r.hasMemoryBridge).toBe(true);
    expect(r.hasTool).toBe(true);
    expect(r.bridgeKinds).toBe(2);
    expect(r.note).toMatch(/Runtime|Memory|MCP/);
  });

  it('projects attention from item states when pendingCount omitted', () => {
    const r = projectApprovalGateReadiness({
      items: [
        { kind: 'mcp-permission', state: 'pending' },
        { kind: 'skill-permission', state: 'pending' },
      ],
      humanOnlyActions: ['irreversible-deletion'],
    });
    expect(r.level).toBe('attention');
    expect(r.pendingCount).toBe(2);
    expect(r.badge).toBe('2 待审');
    expect(r.hasMcpBridge).toBe(true);
    expect(r.hasSkillBridge).toBe(true);
    expect(r.bridgeKinds).toBe(2);
  });

  it('projects ready with history only and human-only policy', () => {
    const r = projectApprovalGateReadiness({
      items: [
        { kind: 'tool', state: 'approved' },
        { kind: 'export', state: 'rejected' },
      ],
      humanOnlyActions: ['export-sensitive-data-outside-boundary'],
    });
    expect(r.level).toBe('ready');
    expect(r.historyCount).toBe(2);
    expect(r.pendingCount).toBe(0);
    expect(r.countLabel).toMatch(/队列空闲/);
    expect(r.hasTool).toBe(true);
  });

  it('projects partial when history exists but no human-only policy', () => {
    const r = projectApprovalGateReadiness({
      items: [{ kind: 'plan', state: 'approved' }],
      humanOnlyActions: [],
      humanOnlyFallback: [],
    });
    expect(r.level).toBe('partial');
    expect(r.badge).toBe('进行中');
    expect(r.humanOnlyOk).toBe(false);
    expect(r.hasTool).toBe(true);
  });

  it('prefers explicit pendingCount over item filter', () => {
    const r = projectApprovalGateReadiness({
      items: [{ kind: 'tool', state: 'approved' }],
      pendingCount: 3,
      humanOnlyActions: ['public-publishing'],
    });
    expect(r.level).toBe('attention');
    expect(r.pendingCount).toBe(3);
    expect(r.badge).toBe('3 待审');
  });
});
