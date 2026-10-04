/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentActivityViewport, agentActivityState } from './AgentActivity.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import type { InlineProcessItem } from './conversation-types.js';

const tool: InlineProcessItem = { kind: 'tool', toolCallId: 'command-1', name: 'command_execution', argumentsJson: '{"command":"pnpm test"}', status: 'running', progressOutput: 'running tests' };
afterEach(cleanup);

describe('real run activity state', () => {
  it('gives terminal states priority over stale streaming and approval flags', () => {
    for (const terminalState of ['failed', 'cancelled', 'paused'] as const) {
      expect(agentActivityState({ streaming: true, waitingForApproval: true, terminalState })).toBe(terminalState);
    }
    expect(agentActivityState({ waitingForApproval: true })).toBe('approval');
    expect(agentActivityState({ streaming: true, answerStarted: true })).toBe('working');
    expect(agentActivityState({ answerStarted: true })).toBe('complete');
    expect(agentActivityState({})).toBe('recorded');
  });
  it('folds completed activity while retaining the summary and supports history replay', () => {
    const { rerender, unmount } = render(<InlineProcessFlow items={[tool]} streaming runId="a" />);
    expect(screen.getByTestId('agent-activity-status').textContent).toBe('进行中');
    rerender(<InlineProcessFlow items={[{ ...tool, status: 'completed', result: 'passed' }]} answerStarted runId="a" />);
    expect(screen.getByTestId('agent-activity-status').textContent).toBe('已完成');
    expect(screen.getByTestId('process-panel-toggle').textContent).toContain('1 次工具调用');
    expect(screen.queryByTestId('agent-activity-viewport')).toBeNull();
    fireEvent.click(screen.getByTestId('process-panel-toggle'));
    expect(screen.getByTestId('process-action-summary-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('inline-process-tool')).toBeNull();
    fireEvent.click(screen.getByTestId('process-action-summary-toggle'));
    expect(screen.getByTestId('inline-process-tool')).toBeTruthy();
    unmount();
    render(<InlineProcessFlow items={[{ ...tool, status: 'completed', result: 'passed' }]} answerStarted runId="a" />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('false');
  });
  it.each(['failed', 'cancelled', 'paused'] as const)('keeps %s visible and stops pending tool output spinners', terminalState => {
    render(<InlineProcessFlow items={[tool]} streaming answerStarted terminalState={terminalState} runId="a" />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('agent-activity-status').getAttribute('data-state')).toBe(terminalState);
    expect(screen.queryByTestId('process-panel-activity')).toBeNull();
    expect(screen.getByTestId('inline-process-tool-result').getAttribute('aria-busy')).toBe('false');
  });
  it('keeps a tool failure visible without claiming the entire run failed', () => {
    render(<InlineProcessFlow items={[{ ...tool, status: 'failed', failed: true, result: 'exit code 1' }]} answerStarted />);
    expect(screen.getByTestId('agent-activity-status').textContent).toBe('执行结束');
    expect(screen.getByTestId('process-panel-toggle').textContent).toContain('1 项失败');
    expect(screen.queryByTestId('inline-process-tool-result')).toBeNull();
    expect(screen.getByTestId('inline-process-tool-error-summary').textContent).toContain('exit code 1');
  });
  it('uses the durable total instead of a page-local count', () => {
    render(<InlineProcessFlow items={[tool]} totalTools={48} streaming />);
    expect(screen.getByTestId('process-panel-toggle').textContent).toContain('48 次工具调用');
  });
  it('preserves manually expanded tool details when completion arrives', () => {
    const { rerender } = render(<InlineProcessFlow items={[{ ...tool, progressOutput: undefined }]} streaming runId="a" />);
    fireEvent.click(screen.getByTestId('inline-process-tool').querySelector('button')!);
    rerender(<InlineProcessFlow items={[{ ...tool, status: 'completed', result: 'passed' }]} answerStarted runId="a" />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('passed');
  });
});

describe('activity in the conversation flow', () => {
  it('does not manage an internal scroll position when a long running trace grows', () => {
    const view = render(<AgentActivityViewport state="working" runId="a"><p>activity</p></AgentActivityViewport>);
    const viewport = screen.getByTestId('agent-activity-viewport');
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1900 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 280 });
    fireEvent.wheel(viewport, { deltaY: -180 });
    fireEvent.scroll(viewport);
    view.rerender(<AgentActivityViewport state="working" runId="a"><p>activity</p><p>more activity</p></AgentActivityViewport>);
    expect(viewport.scrollTop).toBe(0);
    expect(viewport.parentElement?.getAttribute('data-layout')).toBe('flow');
    expect(viewport.parentElement?.querySelector('[data-above], [data-below]')).toBeNull();
    expect(viewport.getAttribute('tabindex')).toBeNull();
    expect(screen.queryByRole('button', { name: '回到最新活动' })).toBeNull();
  });
  it('keeps inspection available without adding a second follow control', () => {
    const inspect = vi.fn();
    render(<AgentActivityViewport state="working" onInspect={inspect}><button>查看命令</button></AgentActivityViewport>);
    fireEvent.click(screen.getByRole('button', { name: '查看命令' }));
    expect(inspect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '回到最新活动' })).toBeNull();
  });
  it('keeps manually inspected activity open when a final answer arrives', () => {
    const view = render(<InlineProcessFlow items={[tool]} streaming runId="a" />);
    fireEvent.click(screen.getByTestId('inline-process-tool').querySelector('button')!);
    view.rerender(<InlineProcessFlow items={[{ ...tool, status: 'completed', result: 'passed' }]} answerStarted runId="a" />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: '执行活动记录' })).toBeTruthy();
  });
  it('preserves an earlier record being read through the main conversation scroll', () => {
    const view = render(<InlineProcessFlow items={[tool]} streaming runId="a" />);
    fireEvent.wheel(screen.getByTestId('agent-activity-viewport'), { deltaY: -180 });
    view.rerender(<InlineProcessFlow items={[{ ...tool, status: 'completed', result: 'passed' }]} answerStarted runId="a" />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: '执行活动记录' })).toBeTruthy();
  });
  it.each(['working', 'approval', 'complete', 'failed', 'cancelled', 'paused'] as const)('uses the same unclipped flow for %s records', state => {
    render(<AgentActivityViewport state={state}><p>first activity</p><p>last activity</p></AgentActivityViewport>);
    expect(screen.getByText('last activity')).toBeTruthy();
    expect(screen.getByTestId('agent-activity-viewport').parentElement?.getAttribute('data-layout')).toBe('flow');
    expect(screen.queryByRole('button', { name: '回到最新活动' })).toBeNull();
  });
});
