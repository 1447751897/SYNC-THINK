/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentActivityViewport, agentActivityState } from './AgentActivity.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import type { InlineProcessItem } from './conversation-types.js';

const tool: InlineProcessItem = { kind: 'tool', toolCallId: 'command-1', name: 'command_execution', argumentsJson: '{"command":"pnpm test"}', status: 'running', progressOutput: 'running tests' };
let resize: () => void;
beforeEach(() => {
  resize = () => {};
  vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mockScroll() {
  const viewport = screen.getByTestId('agent-activity-viewport');
  let height = 900;
  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 280 });
  act(() => resize());
  fireEvent.scroll(viewport);
  return { viewport, grow: () => { height += 100; act(() => resize()); } };
}

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
    expect(screen.getByTestId('inline-process-tool-result').textContent).toContain('exit code 1');
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

describe('activity reading position', () => {
  it('follows new output, pauses after scrolling up, and resumes explicitly', () => {
    render(<AgentActivityViewport state="working" runId="a"><p>activity</p></AgentActivityViewport>);
    const { viewport, grow } = mockScroll();
    expect(viewport.scrollTop).toBe(620);
    fireEvent.wheel(viewport, { deltaY: -180 });
    viewport.scrollTop = 300; fireEvent.scroll(viewport); grow();
    expect(viewport.scrollTop).toBe(300);
    fireEvent.click(screen.getByRole('button', { name: '回到最新活动' }));
    expect(viewport.scrollTop).toBe(720);
    grow(); expect(viewport.scrollTop).toBe(820);
  });
  it('does not drag a reader away from an opened tool when that tool grows', () => {
    const inspect = vi.fn();
    render(<AgentActivityViewport state="working" onInspect={inspect}><button>查看命令</button></AgentActivityViewport>);
    const { viewport, grow } = mockScroll();
    fireEvent.click(screen.getByRole('button', { name: '查看命令' }));
    grow(); expect(viewport.scrollTop).toBe(620); expect(inspect).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '回到最新活动' })).toBeTruthy();
  });
  it('keeps an earlier reading position open when a final answer arrives', () => {
    const { rerender } = render(<InlineProcessFlow items={[tool]} streaming runId="a" />);
    const { viewport } = mockScroll();
    fireEvent.wheel(viewport, { deltaY: -180 }); viewport.scrollTop = 300; fireEvent.scroll(viewport);
    rerender(<InlineProcessFlow items={[{ ...tool, status: 'completed', result: 'passed' }]} answerStarted runId="a" />);
    expect(screen.getByTestId('process-panel-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('agent-activity-viewport')).toBe(viewport);
  });
  it('resumes following after a restored approval and resets when changing runs', () => {
    const { rerender } = render(<AgentActivityViewport state="approval" runId="a"><p>activity</p></AgentActivityViewport>);
    const { viewport } = mockScroll(); expect(viewport.scrollTop).toBe(0);
    rerender(<AgentActivityViewport state="working" runId="a"><p>activity</p></AgentActivityViewport>);
    expect(viewport.scrollTop).toBe(620);
    fireEvent.wheel(viewport, { deltaY: -100 }); viewport.scrollTop = 300; fireEvent.scroll(viewport);
    rerender(<AgentActivityViewport state="working" runId="b"><p>activity</p></AgentActivityViewport>);
    expect(viewport.scrollTop).toBe(620);
  });
  it('lets keyboard users pause follow and leaves completed records scrollable', () => {
    const { rerender } = render(<AgentActivityViewport state="working"><p>activity</p></AgentActivityViewport>);
    const { viewport, grow } = mockScroll(); fireEvent.keyDown(viewport, { key: 'Home' });
    viewport.scrollTop = 0; fireEvent.scroll(viewport); grow(); expect(viewport.scrollTop).toBe(0);
    rerender(<AgentActivityViewport state="complete"><p>activity</p></AgentActivityViewport>);
    expect(screen.queryByRole('button', { name: '回到最新活动' })).toBeNull();
    expect(screen.getByRole('region', { name: '执行活动记录' })).toBeTruthy();
  });
});
