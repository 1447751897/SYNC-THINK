/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WebSearch, WebSearchToolTrail } from './WebSearch.js';
import type { ResearchTool } from './web-research.js';

afterEach(cleanup);
const completed: ResearchTool = {
  kind: 'tool', name: 'web_fetch', toolCallId: 'read-page',
  argumentsJson: '{"url":"https://example.test/video"}',
  result: '{"ok":true,"url":"https://example.test/video","title":"Video evidence"}',
  status: 'completed',
};
const toggle = () => screen.getByRole('button', { name: /次网页检索/ });

describe('collapsible web search execution', () => {
  it('folds completed page reads to one count row and keeps sources and raw details available on demand', () => {
    render(<WebSearchToolTrail items={[completed]} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Read page')).toBeNull();
    expect(screen.queryByRole('button', { name: '来源' })).toBeNull();
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Read page')).toBeTruthy();
    expect(screen.getByText('https://example.test/video')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '来源' }));
    expect(screen.getByRole('link', { name: /Video evidence/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看执行详情' }));
    expect(screen.getByText(completed.argumentsJson)).toBeTruthy();
    fireEvent.click(toggle());
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(completed.argumentsJson)).toBeNull();
  });

  it('allows a live group to be folded without reopening on progress and folds it when search completes', () => {
    const running: ResearchTool = { ...completed, status: 'running', result: undefined };
    const view = render(<WebSearchToolTrail items={[running]} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle());
    view.rerender(<WebSearchToolTrail items={[{ ...running, progressOutput: 'new network output' }]} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle());
    view.rerender(<WebSearchToolTrail items={[completed]} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle());
    view.rerender(<WebSearchToolTrail items={[{ ...completed, result: completed.result + ' ' }]} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('folds failed searches but retains the failure count and real error for inspection', () => {
    render(<WebSearchToolTrail items={[{ ...completed, status: 'failed', result: '{"ok":false,"error":"offline"}' }]} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('1 项失败')).toBeTruthy();
    expect(screen.queryByText('offline')).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getByRole('status').textContent).toBe('offline');
    expect(screen.queryByRole('button', { name: '来源' })).toBeNull();
  });

  it('resets an already completed search opened during execution when the overall answer settles', () => {
    const view = render(<WebSearchToolTrail items={[completed]} settled={false} />);
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    view.rerender(<WebSearchToolTrail items={[completed]} settled />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle());
    expect(screen.getByText('Read page')).toBeTruthy();
  });

  it('does not show a running search tail after the parent run has ended, even with a stale tool status', () => {
    render(<WebSearchToolTrail items={[{ ...completed, status: 'running' }]} settled />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle());
    expect(screen.queryByText('正在检索网页')).toBeNull();
  });

  it('uses a real button with an associated detail region and keeps each search group independent', () => {
    render(<><WebSearchToolTrail items={[completed]} /><WebSearchToolTrail items={[{ ...completed, toolCallId: 'other-read' }]} /></>);
    const buttons = screen.getAllByRole('button', { name: /次网页检索/ });
    expect(buttons[0]?.getAttribute('aria-controls')).toBeTruthy();
    expect(buttons[0]?.getAttribute('aria-controls')).not.toBe(buttons[1]?.getAttribute('aria-controls'));
    fireEvent.click(buttons[0]!);
    expect(buttons[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(buttons[1]?.getAttribute('aria-expanded')).toBe('false');
  });

  it('resets expansion when the conversation scope changes', () => {
    const view = render(<WebSearchToolTrail conversationId="a" items={[completed]} />);
    fireEvent.click(toggle());
    view.rerender(<WebSearchToolTrail conversationId="b" items={[completed]} />);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
  });

  it('still opens original source URLs after expanding the group', () => {
    const onOpenUrl = vi.fn();
    render(<WebSearch heading="1 次网页检索" collapsible onOpenUrl={onOpenUrl} steps={[{
      id: 'source', label: 'Read page', status: 'completed',
      sources: [{ title: 'Original evidence', domain: 'example.test', href: 'https://example.test/original' }],
    }]} />);
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
    fireEvent.click(screen.getByRole('link', { name: /Original evidence/ }));
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.test/original');
  });
});
