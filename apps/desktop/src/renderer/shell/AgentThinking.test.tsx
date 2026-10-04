/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { URL as FileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentThinking } from './AgentThinking.js';
import { KeepAliveLayer } from './KeepAliveLayer.js';
import { InlineProcessFlow } from './InlineProcessFlow.js';
import type { InlineProcessItem } from './conversation-types.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance', 'Date'] });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false,
    addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-reduced-motion');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
function dotValues() {
  return [...screen.getByTestId('agent-thinking-indicator').querySelectorAll<HTMLElement>('.shell-agent-thinking__dots > span')]
    .map(dot => dot.style.opacity);
}
describe('BoardUI AgentThinking host adapter', () => {
  it.each(['wave', 'spin', 'stars', 'infinity'] as const)('renders %s with an accessible label and decorative indicator', variant => {
    render(<AgentThinking variant={variant} label="等待模型响应" showTimer={false} />);
    expect(screen.getByRole('status').getAttribute('data-variant')).toBe(variant);
    expect(screen.getByTestId('agent-thinking-label').textContent).toBe('等待模型响应');
    expect(screen.getByTestId('agent-thinking-indicator').getAttribute('aria-hidden')).toBe('true');
    const indicator = screen.getByTestId('agent-thinking-indicator');
    if (variant === 'wave' || variant === 'spin') expect(indicator.firstElementChild?.children).toHaveLength(9);
    if (variant === 'stars') expect(indicator.querySelectorAll('svg')).toHaveLength(5);
    if (variant === 'infinity') expect(indicator.querySelectorAll('path')).toHaveLength(2);
  });
  it.each(['wave', 'spin'] as const)('animates the real %s opacity pattern and cleans up its interval', variant => {
    const view = render(<AgentThinking variant={variant} showTimer={false} />);
    const initial = dotValues();
    act(() => vi.advanceTimersByTime(80));
    expect(dotValues()).not.toEqual(initial);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('prefers controlled run time without creating a second mounting clock', () => {
    const view = render(<AgentThinking variant="infinity" elapsedLabel="4秒" />);
    expect(screen.getByTestId('agent-thinking-timer').textContent).toBe('4秒');
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByTestId('agent-thinking-timer').textContent).toBe('4秒');
    view.rerender(<AgentThinking variant="infinity" elapsedLabel="6秒" />);
    expect(screen.getByTestId('agent-thinking-timer').textContent).toBe('6秒');
    expect(screen.getByTestId('agent-thinking-timer').getAttribute('aria-hidden')).toBe('true');
  });
  it('offers the upstream mount timer for standalone consumers and can hide it', () => {
    const view = render(<AgentThinking variant="infinity" />);
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByTestId('agent-thinking-timer').textContent).toBe('1.2s');
    view.rerender(<AgentThinking variant="infinity" showTimer={false} />);
    expect(screen.queryByTestId('agent-thinking-timer')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('lets an embedding status region own announcements without nesting live regions', () => {
    render(<AgentThinking announce={false} showTimer={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('agent-thinking').getAttribute('aria-live')).toBeNull();
  });
  it('suspends the standalone clock in a hidden document and resumes real elapsed time', () => {
    render(<AgentThinking variant="infinity" />);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(3000));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByTestId('agent-thinking-timer').textContent).toBe('3.0s');
    expect(vi.getTimerCount()).toBe(1);
  });
  it('uses theme tokens and supports a non-shimmering label', () => {
    render(<AgentThinking tone="accent" shimmer={false} showTimer={false} />);
    expect(screen.getByTestId('agent-thinking').style.getPropertyValue('--agent-thinking-tone')).toBe('var(--color-accent)');
    expect(screen.getByTestId('agent-thinking-label').className).not.toContain('--shimmer');
  });
  it('renders a static first frame for the operating system reduced-motion preference', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    render(<AgentThinking showTimer={false} />);
    expect(screen.getByTestId('agent-thinking').getAttribute('data-motion')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('responds to the app reduced-motion preference without remounting', async () => {
    render(<AgentThinking showTimer={false} />);
    act(() => vi.advanceTimersByTime(80));
    await act(async () => { document.documentElement.setAttribute('data-reduced-motion', 'true'); });
    expect(screen.getByTestId('agent-thinking').getAttribute('data-motion')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { document.documentElement.removeAttribute('data-reduced-motion'); });
    expect(screen.getByTestId('agent-thinking').getAttribute('data-motion')).toBe('true');
    expect(vi.getTimerCount()).toBe(1);
  });
  it('suspends dot updates when the document is hidden', () => {
    render(<AgentThinking showTimer={false} />);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByTestId('agent-thinking').getAttribute('data-motion')).toBe('false');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('suspends both clocks and animations in an inactive keep-alive layer', () => {
    const child = <AgentThinking />;
    const view = render(<KeepAliveLayer active>{child}</KeepAliveLayer>);
    expect(vi.getTimerCount()).toBe(2);
    view.rerender(<KeepAliveLayer active={false}>{child}</KeepAliveLayer>);
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<KeepAliveLayer active>{child}</KeepAliveLayer>);
    expect(vi.getTimerCount()).toBe(2);
  });
  it('includes static CSS fallbacks for sparkle, comet and text animations', () => {
    const css = readFileSync(new FileURL('./agent-thinking.css', import.meta.url), 'utf8');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain('[data-reduced-motion]');
    expect(css).toContain("[data-motion='false']");
    expect(css).not.toContain('--color-blue-500');
  });
});
describe('real execution activity integration', () => {
  it('replaces the legacy waiting pixels and uses the real run duration', () => {
    render(<InlineProcessFlow items={[]} streaming startedAt={new Date(Date.now() - 4000).toISOString()} runId="thinking-port" />);
    expect(screen.getByTestId('process-activity').getAttribute('data-variant')).toBe('wave');
    expect(screen.getByTestId('process-activity').style.getPropertyValue('--agent-thinking-tone')).toBe('var(--color-text)');
    expect(screen.getByTestId('process-activity-label').textContent).toBe('等待模型响应');
    expect(screen.getByTestId('process-activity-timer').textContent).toContain('4秒');
    expect(screen.queryByTestId('loading-pixel-grid')).toBeNull();
  });
  it.each<{ name: string; items: InlineProcessItem[]; kind: string; variant: string }>([
    { name: 'waiting for the first token', items: [], kind: 'waiting', variant: 'wave' },
    { name: 'thinking without a reasoning preview', items: [{ kind: 'reasoning', text: '', status: 'streaming' }], kind: 'thinking', variant: 'infinity' },
    { name: 'thinking with a descriptive preview', items: [{ kind: 'reasoning', text: '核对模型和工作区。', status: 'streaming' }], kind: 'thinking', variant: 'infinity' },
    { name: 'running a tool while reasoning is present', items: [
      { kind: 'reasoning', text: '准备检查文件。', status: 'streaming' },
      { kind: 'tool', toolCallId: 'activity-tool', name: 'read_file', argumentsJson: '{"path":"README.md"}', status: 'running' },
    ], kind: 'tool', variant: 'spin' },
    { name: 'waiting after a completed tool', items: [{ kind: 'tool', toolCallId: 'finished-tool', name: 'read_file', argumentsJson: '{}', status: 'completed', result: 'ok' }], kind: 'waiting', variant: 'wave' },
    { name: 'answering', items: [{ kind: 'text', text: '正在整理结论。', status: 'streaming' }], kind: 'answering', variant: 'wave' },
    { name: 'reporting a runtime status', items: [{ kind: 'status', statusType: 'retry', label: '正在重试' }], kind: 'status', variant: 'wave' },
  ])('selects the animation from the actual activity when $name', ({ items, kind, variant }) => {
    render(<InlineProcessFlow items={items} streaming runId="activity-variants" />);
    expect(screen.getByTestId('process-panel-activity').getAttribute('data-kind')).toBe(kind);
    expect(screen.getByTestId('process-activity').getAttribute('data-variant')).toBe(variant);
    if (kind === 'thinking') expect(screen.getByTestId('process-activity-label').textContent).toBe('正在思考中');
    const indicator = screen.getByTestId('agent-thinking-indicator');
    if (variant === 'infinity') expect(indicator.querySelectorAll('path')).toHaveLength(2);
    else expect(indicator.firstElementChild?.children).toHaveLength(9);
  });
  it.each([true, false])('keeps the bottom thinking label generic when showThinking is %s', showThinking => {
    const text = 'Coordinates x=415 and y=805, cy=464, with a radius of 92.';
    const view = render(<InlineProcessFlow items={[{ kind: 'reasoning', text, status: 'streaming' }]}
      streaming showThinking={showThinking} defaultOpen runId="thinking-label" />);
    expect(screen.getByTestId('process-activity').getAttribute('data-variant')).toBe('infinity');
    expect(screen.getByTestId('process-activity-label').textContent).toBe('正在思考中');
    expect(screen.getByTestId('process-activity-label').getAttribute('data-label')).toBe('正在思考中');
    expect(screen.getByTestId('process-panel-activity').textContent).not.toContain('x=415');
    if (showThinking) expect(screen.getByTestId('inline-process-reasoning').textContent).toContain('x=415');
    else expect(screen.queryByTestId('inline-process-reasoning')).toBeNull();
    view.rerender(<InlineProcessFlow items={[{ kind: 'reasoning', text: 'Next step: inspect the workspace.', status: 'streaming' }]}
      streaming showThinking={showThinking} defaultOpen runId="thinking-label" />);
    expect(screen.getByTestId('process-activity-label').textContent).toBe('正在思考中');
    expect(screen.getByTestId('process-panel-activity').textContent).not.toContain('inspect the workspace');
  });
  it('switches wave → infinity → spin → infinity → wave in one run without resetting its clock', () => {
    const startedAt = new Date(Date.now() - 4000).toISOString();
    const props = { streaming: true, runId: 'activity-transition', startedAt };
    const reasoning: InlineProcessItem = { kind: 'reasoning', text: '核对工作区。', status: 'streaming' };
    const tool: InlineProcessItem = { kind: 'tool', toolCallId: 'transition-tool', name: 'read_file', argumentsJson: '{}', status: 'running' };
    const view = render(<InlineProcessFlow {...props} items={[]} />);
    const expectActivity = (variant: string, seconds: number) => {
      expect(screen.getByTestId('process-activity').getAttribute('data-variant')).toBe(variant);
      expect(screen.getByTestId('process-activity-timer').textContent).toBe(`${seconds}秒`);
    };
    expectActivity('wave', 4);
    act(() => vi.advanceTimersByTime(1000));
    view.rerender(<InlineProcessFlow {...props} items={[reasoning]} />);
    expectActivity('infinity', 5);
    act(() => vi.advanceTimersByTime(1000));
    view.rerender(<InlineProcessFlow {...props} items={[reasoning, tool]} />);
    expectActivity('spin', 6);
    act(() => vi.advanceTimersByTime(1000));
    view.rerender(<InlineProcessFlow {...props} items={[reasoning, { ...tool, status: 'completed', result: 'ok' }]} />);
    expectActivity('infinity', 7);
    act(() => vi.advanceTimersByTime(1000));
    view.rerender(<InlineProcessFlow {...props} items={[{ ...tool, status: 'completed', result: 'ok' }]} />);
    expectActivity('wave', 8);
    view.rerender(<InlineProcessFlow {...props} items={[]} streaming={false} completedAt={new Date().toISOString()} />);
    expect(screen.queryByTestId('process-activity')).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps approval static instead of pretending the model is working', () => {
    render(<InlineProcessFlow items={[]} streaming waitingForApproval runId="approval-port" />);
    expect(screen.getByTestId('process-activity-label').textContent).toBe('等待你的批准');
    expect(screen.queryByTestId('process-activity')).toBeNull();
    expect(screen.queryByTestId('agent-thinking-indicator')).toBeNull();
  });
  it.each(['failed', 'paused', 'cancelled'] as const)('removes the active indicator when the run is %s', terminalState => {
    render(<InlineProcessFlow items={[]} streaming terminalState={terminalState} runId="terminal-port" />);
    expect(screen.queryByTestId('process-activity')).toBeNull();
  });
});
