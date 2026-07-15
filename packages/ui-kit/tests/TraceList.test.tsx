import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TraceList, projectTraceReadiness } from '../src/components/TraceList.js';

describe('TraceList', () => {
  it('shows Chinese category labels while keeping english data-category', () => {
    render(
      <TraceList
        items={[
          { id: 't1', category: 'model-call', summary: 'stream start' },
          { id: 't2', category: 'recovery', summary: 'fallback walk' },
        ]}
      />,
    );
    expect(screen.getByTestId('trace-category-t1').textContent).toBe('模型调用');
    expect(screen.getByTestId('trace-category-t1').getAttribute('data-category')).toBe('model-call');
    expect(screen.getByTestId('trace-category-t2').textContent).toBe('恢复');
  });

  it('shows chinese empty hint', () => {
    render(<TraceList items={[]} />);
    expect(screen.getByTestId('trace-empty').textContent).toMatch(/尚无轨迹/);
  });

  it('renders readiness strip with empty level', () => {
    render(<TraceList items={[]} hasActiveTask />);
    const strip = screen.getByTestId('trace-readiness');
    expect(strip.getAttribute('data-level')).toBe('empty');
    expect(screen.getByTestId('trace-readiness-badge').textContent).toBe('静默');
    expect(screen.getByTestId('trace-check-events').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('trace-check-model').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('trace-readiness-note').textContent).toMatch(/发送消息/);
  });

  it('shows waiting-task empty copy when no task', () => {
    render(<TraceList items={[]} hasActiveTask={false} />);
    expect(screen.getByTestId('trace-readiness-badge').textContent).toBe('等待任务');
    expect(screen.getByTestId('trace-empty').textContent).toMatch(/先打开任务/);
    expect(screen.getByTestId('trace-check-live').textContent).toMatch(/任务未打开/);
  });

  it('summarizes live events by category', () => {
    render(
      <TraceList
        items={[
          { id: 'a', category: 'model-call', summary: 'gpt-4o-mini stream', time: '12:01' },
          { id: 'b', category: 'recovery', summary: 'credential walk', time: '12:02' },
          { id: 'c', category: 'tool-action', summary: 'mcp.echo', time: '12:03' },
        ]}
        hasActiveTask
      />,
    );
    expect(screen.getByTestId('trace-readiness').getAttribute('data-level')).toBe('live');
    expect(screen.getByTestId('trace-readiness-badge').textContent).toBe('有轨迹');
    expect(screen.getByTestId('trace-check-events').textContent).toMatch(/事件 3/);
    expect(screen.getByTestId('trace-check-model').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('trace-check-recovery').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('trace-check-action').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('trace-check-last').textContent).toMatch(/工具动作/);
    expect(screen.getByTestId('trace-check-last').textContent).toMatch(/mcp.echo/);
  });

  it('marks streaming level', () => {
    render(
      <TraceList
        items={[{ id: 's', category: 'model-call', summary: 'delta…' }]}
        streaming
        hasActiveTask
      />,
    );
    expect(screen.getByTestId('trace-readiness').getAttribute('data-level')).toBe('streaming');
    expect(screen.getByTestId('trace-readiness-badge').textContent).toBe('流式中');
    expect(screen.getByTestId('trace-check-live').textContent).toMatch(/流式写入/);
  });

  it('can hide readiness strip', () => {
    render(<TraceList items={[]} hideReadiness />);
    expect(screen.queryByTestId('trace-readiness')).toBeNull();
    expect(screen.getByTestId('trace-empty')).toBeTruthy();
  });

  it('shows complete selected audit details only after the event is selected', () => {
    render(
      <TraceList
        items={[
          {
            id: 'review-1',
            category: 'review',
            summary: 'Review returned',
            details: [
              { label: '评审说明', value: 'Missing verification evidence.' },
              { label: '产物版本', value: 'artifact-version-a, artifact-version-b' },
            ],
          },
        ]}
      />,
    );

    expect(screen.queryByTestId('trace-details-review-1')).toBeNull();
    fireEvent.click(screen.getByTestId('trace-item-review-1'));
    expect(screen.getByTestId('trace-details-review-1').textContent).toContain(
      'Missing verification evidence.',
    );
    expect(screen.getByTestId('trace-details-review-1').textContent).toContain(
      'artifact-version-a, artifact-version-b',
    );
  });

  it('pages a long complete trace without dropping older events', () => {
    render(
      <TraceList
        items={Array.from({ length: 75 }, (_, index) => ({
          id: `trace-${index + 1}`,
          category: 'run' as const,
          summary: `Event ${index + 1}`,
        }))}
      />,
    );

    expect(screen.queryByTestId('trace-item-trace-1')).toBeNull();
    expect(screen.getByTestId('trace-item-trace-75')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /加载更早轨迹/ }));
    expect(screen.getByTestId('trace-item-trace-1')).toBeTruthy();
  });
});

describe('projectTraceReadiness', () => {
  it('projects partial when only recovery events', () => {
    const r = projectTraceReadiness([{ id: 'r', category: 'recovery', summary: 'catch-up' }]);
    expect(r.level).toBe('partial');
    expect(r.hasModelCall).toBe(false);
    expect(r.hasRecovery).toBe(true);
    expect(r.badge).toBe('部分事件');
  });

  it('projects live when model-call present', () => {
    const r = projectTraceReadiness([
      { id: 'm', category: 'model-call', summary: 'ok' },
      { id: 'r', category: 'recovery', summary: 'ok' },
    ]);
    expect(r.level).toBe('live');
    expect(r.total).toBe(2);
    expect(r.categoryCount).toBe(2);
  });
});
