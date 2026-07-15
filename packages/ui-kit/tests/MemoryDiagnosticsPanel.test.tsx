import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import {
  MemoryDiagnosticsPanel,
  projectMemoryDiagnosticsReadiness,
} from '../src/components/MemoryDiagnosticsPanel.js';

afterEach(() => cleanup());

const entries = [
  {
    id: 'e1',
    key: 'task.digest',
    value: '用户确认默认走 agentDefault',
    scope: 'task' as const,
    active: true,
    updatedAt: '2026-07-12T10:00:00.000Z',
  },
];

const changes = [
  {
    id: 'c1' as never,
    taskId: 't1' as never,
    targetScope: 'task' as const,
    approvalState: 'pending' as const,
    confidence: 0.82,
    additions: [{ id: 'a1', key: 'pref.theme', value: 'dark', targetScope: 'task' as const }],
    modifications: [] as { id: string; key: string; value: string; targetScope: 'task' }[],
    deprecations: [] as string[],
    createdAt: '2026-07-12T10:01:00.000Z',
  },
];

const diagnostics = [
  {
    id: 'd1',
    category: 'run.failed',
    failureClass: 'provider_error',
    summary: 'upstream 401 · Bearer [REDACTED]',
    createdAt: '2026-07-12T10:02:00.000Z',
  },
];

describe('MemoryDiagnosticsPanel', () => {
  it('renders durable entries, pending changes, diagnostics; approve/reject', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    render(
      <MemoryDiagnosticsPanel
        entries={entries}
        changes={changes}
        diagnostics={diagnostics}
        onDecide={onDecide}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByTestId('memory-entry-e1').textContent).toMatch(/task\.digest/);
    expect(screen.getByTestId('memory-change-c1').textContent).toMatch(/pending|待审|pref\.theme/i);
    expect(screen.getByTestId('diagnostic-d1').textContent).toMatch(/REDACTED/);
    expect(screen.getByTestId('diagnostic-d1').textContent).not.toMatch(/sk-/);

    fireEvent.click(screen.getByTestId('memory-approve-c1'));
    await waitFor(() => {
      expect(onDecide).toHaveBeenCalledWith({ changeId: 'c1', decision: 'approved' });
    });

    fireEvent.click(screen.getByTestId('memory-reject-c1'));
    await waitFor(() => {
      expect(onDecide).toHaveBeenCalledWith({ changeId: 'c1', decision: 'rejected' });
    });

    fireEvent.click(screen.getByTestId('memory-refresh'));
    await waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });


  it('lists decided history and rolls back approved change (§10.4)', async () => {
    const onRollback = vi.fn().mockResolvedValue(undefined);
    const decided = [
      {
        id: 'c-approved',
        taskId: 't1',
        targetScope: 'task' as const,
        approvalState: 'approved' as const,
        confidence: 0.9,
        additions: [{ id: 'a1', key: 'pref.theme', value: 'dark', targetScope: 'task' as const }],
        modifications: [] as { id: string; key: string; value: string; targetScope: 'task' }[],
        deprecations: [] as string[],
        createdAt: '2026-07-12T10:01:00.000Z',
        decidedAt: '2026-07-12T10:02:00.000Z',
      },
      {
        id: 'c-rolled',
        taskId: 't1',
        targetScope: 'project' as const,
        approvalState: 'rolled_back' as const,
        confidence: 0.7,
        additions: [{ id: 'a2', key: 'style', value: 'continuum', targetScope: 'project' as const }],
        modifications: [] as { id: string; key: string; value: string; targetScope: 'task' }[],
        deprecations: [] as string[],
        createdAt: '2026-07-12T09:00:00.000Z',
        decidedAt: '2026-07-12T09:30:00.000Z',
      },
    ];

    render(
      <MemoryDiagnosticsPanel
        entries={entries}
        changes={decided}
        diagnostics={[]}
        onRollback={onRollback}
      />,
    );

    expect(screen.getByTestId('memory-history')).toBeTruthy();
    expect(screen.getByTestId('memory-history-c-approved').textContent).toMatch(/已通过|approved|pref\.theme/i);
    expect(screen.getByTestId('memory-history-c-rolled').textContent).toMatch(/已回滚|rolled/i);
    expect(screen.getByTestId('memory-rollback-c-approved')).toBeTruthy();
    expect(screen.queryByTestId('memory-rollback-c-rolled')).toBeNull();

    fireEvent.click(screen.getByTestId('memory-rollback-c-approved'));
    await waitFor(() => {
      expect(onRollback).toHaveBeenCalledWith({ changeId: 'c-approved' });
    });
  });

  it('shows empty hint when disconnected', () => {
    render(
      <MemoryDiagnosticsPanel
        entries={[]}
        changes={[]}
        diagnostics={[]}
        loading={false}
      />,
    );
    // Known limitations always keep the body open (§23.2 #12)
    expect(screen.queryByTestId('memory-empty')).toBeNull();
    expect(screen.getByTestId('memory-section-limitations')).toBeTruthy();
  });

  it('shows recovery steps and known limitations (§23.2 #9/#12)', async () => {
    const onNavigate = vi.fn();
    render(
      <MemoryDiagnosticsPanel
        entries={entries}
        changes={[]}
        diagnostics={[
          {
            id: 'd-auth',
            category: 'provider',
            failureClass: 'auth',
            summary: 'Discovery failed (auth): Bearer [REDACTED]',
            createdAt: '2026-07-12T11:00:00.000Z',
          },
          {
            id: 'd-timeout',
            category: 'provider',
            failureClass: 'timeout',
            summary: 'upstream timed out',
            createdAt: '2026-07-12T11:01:00.000Z',
          },
        ]}
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByTestId('diagnostic-d-auth').getAttribute('data-retryable')).toBe('0');
    expect(screen.getByTestId('diagnostic-d-timeout').getAttribute('data-retryable')).toBe('1');
    expect(screen.getByTestId('diagnostic-class-d-auth').textContent).toMatch(/鉴权|auth/i);

    fireEvent.click(screen.getByTestId('diagnostic-toggle-d-auth'));
    expect(screen.getByTestId('diagnostic-recovery-d-auth').textContent).toMatch(/密钥|API Key|凭证/i);

    fireEvent.click(screen.getByTestId('diagnostic-goto-d-auth'));
    expect(onNavigate).toHaveBeenCalledWith('providers');

    const limSection = screen.getByTestId('memory-section-limitations');
    if (limSection.getAttribute('data-open') !== 'true') {
      fireEvent.click(limSection.querySelector('button')!);
    }
    expect(screen.getByTestId('memory-limitations')).toBeTruthy();
    expect(screen.getByTestId('limitation-lim-secrets')).toBeTruthy();
    expect(screen.getByTestId('limitation-lim-m1-exit').textContent).toMatch(/M1|dogfood|18\/18/i);
  });


  it('shows memory readiness strip with attention when pending', () => {
    render(
      <MemoryDiagnosticsPanel
        entries={entries}
        changes={changes}
        diagnostics={diagnostics}
      />,
    );
    expect(screen.getByTestId('memory-m1-readiness').getAttribute('data-level')).toBe('attention');
    expect(screen.getByTestId('memory-m1-readiness-badge').textContent).toMatch(/待审/);
    expect(screen.getByTestId('memory-m1-check-entries').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('memory-m1-check-pending').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('memory-m1-check-diag').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('memory-m1-check-limits').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('memory-m1-readiness-note').textContent).toMatch(/MemoryChange|批准中心|待审/);
  });

  it('shows entries empty card when no durable memory', () => {
    render(
      <MemoryDiagnosticsPanel
        entries={[]}
        changes={[]}
        diagnostics={[]}
      />,
    );
    expect(screen.getByTestId('memory-m1-readiness')).toBeTruthy();
    expect(screen.getByTestId('memory-entries-empty').textContent).toMatch(/尚无持久记忆|MemoryChange/);
    expect(screen.getByTestId('memory-pending-empty').textContent).toMatch(/暂无待审|批准中心/);
  });

});

describe('projectMemoryDiagnosticsReadiness', () => {
  it('projects empty when nothing loaded', () => {
    const r = projectMemoryDiagnosticsReadiness({});
    expect(r.level).toBe('empty');
    expect(r.badge).toBe('未连接');
    expect(r.entriesOk).toBe(false);
    expect(r.note).toMatch(/Runtime|MemoryChange|scrub/);
  });

  it('projects partial when only known limitations', () => {
    const r = projectMemoryDiagnosticsReadiness({ limitationCount: 5 });
    expect(r.level).toBe('partial');
    expect(r.badge).toBe('仅限制说明');
    expect(r.limitsOk).toBe(true);
    expect(r.note).toMatch(/23.2|#12|限制/);
  });

  it('projects ready with durable entries', () => {
    const r = projectMemoryDiagnosticsReadiness({
      entryCount: 2,
      pendingCount: 0,
      decidedCount: 0,
      diagCount: 0,
      limitationCount: 3,
    });
    expect(r.level).toBe('ready');
    expect(r.badge).toBe('证据在线');
    expect(r.entriesOk).toBe(true);
    expect(r.note).toMatch(/dogfood|soft|M1|scrub/);
    expect(r.note).not.toMatch(/仍需.*外网/);
  });

  it('projects ready with decided history or diagnostics only', () => {
    const decided = projectMemoryDiagnosticsReadiness({
      decidedCount: 1,
      limitationCount: 1,
    });
    expect(decided.level).toBe('ready');
    expect(decided.bridgeOk).toBe(true);

    const diag = projectMemoryDiagnosticsReadiness({
      diagCount: 2,
      limitationCount: 1,
    });
    expect(diag.level).toBe('ready');
    expect(diag.diagVisible).toBe(true);
  });

  it('projects attention when pending MemoryChange', () => {
    const r = projectMemoryDiagnosticsReadiness({
      entryCount: 1,
      pendingCount: 2,
      decidedCount: 1,
      diagCount: 1,
      limitationCount: 4,
    });
    expect(r.level).toBe('attention');
    expect(r.badge).toBe('2 待审');
    expect(r.pendingCount).toBe(2);
    expect(r.note).toMatch(/MemoryChange|批准中心|待审/);
  });

  it('attention wins over ready evidence', () => {
    const r = projectMemoryDiagnosticsReadiness({
      entryCount: 5,
      pendingCount: 1,
      diagCount: 3,
    });
    expect(r.level).toBe('attention');
    expect(r.badge).toBe('1 待审');
  });
});
