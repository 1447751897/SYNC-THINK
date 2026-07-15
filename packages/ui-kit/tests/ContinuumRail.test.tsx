import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContinuumRail, projectContinuumReadiness } from '../src/components/ContinuumRail.js';

describe('ContinuumRail', () => {
  it('renders entries and forwards selection', () => {
    const onSelect = vi.fn();
    render(
      <ContinuumRail
        entries={[
          { id: 'a', kind: 'decision', label: 'Pick SQLite' },
          { id: 'b', kind: 'memory', label: 'wp folder = D:/proj' },
        ]}
        activeId="b"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByTestId('continuum-chip-a')).toBeTruthy();
    expect(screen.getByTestId('continuum-chip-b').getAttribute('data-active')).toBe('true');
    fireEvent.click(screen.getByTestId('continuum-chip-a'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('shows Chinese kind labels while keeping data-kind english', () => {
    render(
      <ContinuumRail
        entries={[
          { id: 'a', kind: 'decision', label: '选库' },
          { id: 'b', kind: 'context-transfer', label: '线程' },
        ]}
      />,
    );
    expect(screen.getByTestId('continuum-kind-a').textContent).toBe('决策');
    expect(screen.getByTestId('continuum-kind-a').getAttribute('data-kind')).toBe('decision');
    expect(screen.getByTestId('continuum-kind-b').textContent).toBe('上下文');
  });

  it('uses plain scaffold labels without changing durable kind data', () => {
    render(
      <ContinuumRail
        scaffoldOnly
        entries={[
          { id: 'folder', kind: 'decision', categoryLabel: '工作区', label: 'Local WS' },
          { id: 'task', kind: 'memory', categoryLabel: '任务', label: 'Fix UI' },
          { id: 'thread', kind: 'context-transfer', categoryLabel: '对话', label: 'v36' },
        ]}
      />,
    );
    expect(screen.getByTestId('continuum-kind-folder').textContent).toBe('工作区');
    expect(screen.getByTestId('continuum-kind-folder').getAttribute('data-kind')).toBe('decision');
    expect(screen.getByTestId('continuum-kind-task').textContent).toBe('任务');
    expect(screen.getByTestId('continuum-kind-thread').textContent).toBe('对话');
  });

  it('shows chinese empty hint when no entries', () => {
    render(<ContinuumRail entries={[]} />);
    expect(screen.getByTestId('continuum-empty').textContent).toMatch(/尚无连续体/);
  });

  it('renders readiness strip empty / waiting-task', () => {
    render(<ContinuumRail entries={[]} hasActiveTask={false} />);
    expect(screen.getByTestId('continuum-readiness').getAttribute('data-level')).toBe('empty');
    expect(screen.getByTestId('continuum-readiness-badge').textContent).toBe('等待任务');
    expect(screen.getByTestId('continuum-check-entries').getAttribute('data-ok')).toBe('0');
    expect(screen.getByTestId('continuum-empty').textContent).toMatch(/添加文件夹/);
  });

  it('marks scaffold structure when task open', () => {
    render(
      <ContinuumRail
        entries={[
          { id: 'folder', kind: 'decision', label: 'MyProject' },
          { id: 'task', kind: 'memory', label: 'Alpha' },
          { id: 'thread', kind: 'context-transfer', label: '线程 · v1' },
        ]}
        hasActiveTask
        scaffoldOnly
      />,
    );
    expect(screen.getByTestId('continuum-readiness').getAttribute('data-level')).toBe('scaffold');
    expect(screen.getByTestId('continuum-readiness-badge').textContent).toBe('结构位');
    expect(screen.getByTestId('continuum-check-decision').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('continuum-check-memory').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('continuum-check-transfer').getAttribute('data-ok')).toBe('1');
    expect(screen.getByTestId('continuum-check-bind').textContent).toMatch(/任务结构位/);
  });

  it('marks live when durable evidence present', () => {
    render(
      <ContinuumRail
        entries={[
          { id: 'd', kind: 'decision', label: '选库' },
          { id: 'a', kind: 'artifact', label: 'plan.md' },
        ]}
        hasActiveTask
      />,
    );
    expect(screen.getByTestId('continuum-readiness').getAttribute('data-level')).toBe('live');
    expect(screen.getByTestId('continuum-readiness-badge').textContent).toBe('有证据');
    expect(screen.getByTestId('continuum-check-durable').getAttribute('data-ok')).toBe('1');
  });

  it('marks streaming level', () => {
    render(
      <ContinuumRail
        entries={[{ id: 't', kind: 'memory', label: 'draft' }]}
        streaming
        hasActiveTask
        scaffoldOnly
      />,
    );
    expect(screen.getByTestId('continuum-readiness').getAttribute('data-level')).toBe('streaming');
    expect(screen.getByTestId('continuum-readiness-badge').textContent).toBe('流式中');
  });

  it('can hide readiness strip', () => {
    render(<ContinuumRail entries={[]} hideReadiness />);
    expect(screen.queryByTestId('continuum-readiness')).toBeNull();
    expect(screen.getByTestId('continuum-empty')).toBeTruthy();
  });
});

describe('projectContinuumReadiness', () => {
  it('projects empty when no entries', () => {
    const r = projectContinuumReadiness([]);
    expect(r.level).toBe('empty');
    expect(r.hasEntries).toBe(false);
    expect(r.badge).toBe('静默');
  });

  it('projects scaffold when scaffoldOnly with task structure', () => {
    const r = projectContinuumReadiness(
      [
        { id: 'f', kind: 'decision', label: 'wp' },
        { id: 't', kind: 'memory', label: 'task' },
      ],
      { hasActiveTask: true, scaffoldOnly: true },
    );
    expect(r.level).toBe('scaffold');
    expect(r.kindCount).toBe(2);
  });
});
