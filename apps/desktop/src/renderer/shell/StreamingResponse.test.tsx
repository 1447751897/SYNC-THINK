/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import {
  StreamingResponse,
  responseStatus,
  type StreamingResponseStatus,
} from './StreamingResponse.js';
import { MarkdownContent } from './MarkdownContent.js';
import type { AnswerSource } from './answer-sources.js';

afterEach(cleanup);
const sources: AnswerSource[] = [
  { key: 'file:readme', kind: 'file', path: 'README.md', label: 'README.md', action: 'read' },
  {
    key: 'external:docs',
    kind: 'external',
    url: 'https://beui.dev/',
    host: 'beui.dev',
    label: 'Be UI',
  },
];

describe('response footer details', () => {
  it('renders extra actions only in the completed footer, with details below it', () => {
    const props = {
      additionalActions: <button aria-label="查看执行详情">详情</button>,
      details: <section aria-label="执行详情">工具调用记录</section>,
    };
    const view = render(<StreamingResponse status="streaming" variant="bubble" {...props}>正在回答</StreamingResponse>);
    const bubble = view.container.querySelector('.shell-response__content')!;
    expect(screen.queryByRole('button', { name: '查看执行详情' })).toBeNull();
    view.rerender(<StreamingResponse status="complete" variant="bubble" {...props}>正在回答</StreamingResponse>);
    const footer = screen.getByTestId('response-footer');
    expect(within(footer).getByRole('button', { name: '查看执行详情' })).toBeTruthy();
    const details = screen.getByRole('region', { name: '执行详情' });
    expect(details.parentElement).toBe(footer.parentElement);
    expect(footer.nextElementSibling).toBe(details);
    expect(bubble.querySelector('button, section')).toBeNull();
    expect(view.container.querySelector('.shell-response__content')).toBe(bubble);
  });
});

describe('StreamingResponse', () => {
  it.each(['plain', 'bubble'] as const)('keeps rich content mounted and one action row when a %s response completes', (variant) => {
    const props = { onCopy: vi.fn(), onRetry: vi.fn(), onFeedbackChange: vi.fn(), sources };
    const view = (status: StreamingResponseStatus, text: string) => (
      <StreamingResponse {...props} status={status} variant={variant}>
        <MarkdownContent text={text} streaming={status === 'streaming'} />
      </StreamingResponse>
    );
    const text = '回答正文\n\n' + '```typescript\nconst count = 1;\n```';
    const rendered = render(view('streaming', text));
    const contentNode = rendered.container.querySelector('.shell-response__content');
    const codeNode = rendered.container.querySelector('.shell-md-code');
    expect(codeNode).toBeTruthy();
    expect(screen.queryByTestId('response-footer')).toBeNull();
    rendered.rerender(view('complete', text));
    expect(rendered.container.querySelector('.shell-response__content')).toBe(contentNode);
    expect(rendered.container.querySelector('.shell-md-code')).toBe(codeNode);
    expect(screen.getAllByTestId('response-footer')).toHaveLength(1);
    expect(contentNode?.contains(screen.getByTestId('response-footer'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    expect(props.onCopy).toHaveBeenCalledOnce();
    expect(props.onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('status', { name: '回答生成状态' }).textContent).toBe('回答已完成');
  });

  it('only announces state changes rather than announcing every text chunk', () => {
    const { rerender, container } = render(
      <StreamingResponse status="streaming">开始</StreamingResponse>,
    );
    expect(screen.getByRole('status', { name: '回答生成状态' }).textContent).toBe('正在生成回答');
    rerender(<StreamingResponse status="streaming">开始输出第二段</StreamingResponse>);
    expect(screen.getByRole('status', { name: '回答生成状态' }).textContent).toBe('正在生成回答');
    expect(container.querySelector('.shell-response__content')?.hasAttribute('aria-live')).toBe(
      false,
    );
  });

  it.each(['error', 'cancelled', 'paused'] as const)(
    'preserves partial text and exposes only supported recovery for %s',
    (status) => {
      const onRetry = vi.fn(),
        onContinue = vi.fn();
      render(
        <StreamingResponse
          status={status}
          onRetry={onRetry}
          onContinue={onContinue}
          onFeedbackChange={vi.fn()}
          notice={<p>具体原因</p>}
        >
          已经生成的回答
        </StreamingResponse>,
      );
      expect(screen.getByText('已经生成的回答')).toBeTruthy();
      expect(screen.getByText('具体原因')).toBeTruthy();
      expect(screen.queryByRole('button', { name: '有帮助' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '重试回答' }));
      expect(onRetry).toHaveBeenCalledOnce();
      if (status !== 'error') {
        fireEvent.click(screen.getByRole('button', { name: '继续回答' }));
        expect(onContinue).toHaveBeenCalledOnce();
      } else expect(screen.queryByRole('button', { name: '继续回答' })).toBeNull();
    },
  );

  it('hides completion actions while waiting for approval and exposes no fake actions', () => {
    const { rerender } = render(
      <StreamingResponse status="waiting" onCopy={vi.fn()} onRetry={vi.fn()} sources={sources}>
        等待确认的内容
      </StreamingResponse>,
    );
    expect(screen.queryByTestId('response-footer')).toBeNull();
    expect(screen.getByRole('status', { name: '回答生成状态' }).textContent).toBe('等待审批');
    rerender(<StreamingResponse status="complete">纯文本</StreamingResponse>);
    expect(screen.queryByTestId('response-footer')).toBeNull();
  });

  it('disables pending copy and retry and permits a failed copy to be attempted again', () => {
    const onCopy = vi.fn();
    const { rerender } = render(
      <StreamingResponse
        status="complete"
        onCopy={onCopy}
        copyState="copying"
        onRetry={vi.fn()}
        busy
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '读取原文中' }));
    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '重新生成' }).hasAttribute('disabled')).toBe(true);
    rerender(<StreamingResponse status="complete" onCopy={onCopy} copyState="error" />);
    expect(screen.getByRole('alert').textContent).toContain('读取或复制失败');
    fireEvent.click(screen.getByRole('button', { name: '重试复制' }));
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('keeps feedback scoped to each response and supports toggling it off', () => {
    function Reply({ label }: { label: string }) {
      const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);
      return (
        <StreamingResponse status="complete" feedback={feedback} onFeedbackChange={setFeedback}>
          {label}
        </StreamingResponse>
      );
    }
    render(
      <>
        <Reply label="成员甲" />
        <Reply label="成员乙" />
      </>,
    );
    const rows = screen.getAllByTestId('streaming-response');
    const first = within(rows[0]!).getByRole('button', { name: '有帮助' }),
      second = within(rows[1]!).getByRole('button', { name: '有帮助' });
    fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('false');
  });

  it('retains source expansion across updates and routes sources to existing app navigation', () => {
    const onOpenFile = vi.fn(),
      onOpenUrl = vi.fn();
    const element = (
      <StreamingResponse
        status="complete"
        sources={sources}
        onOpenFile={onOpenFile}
        onOpenUrl={onOpenUrl}
      >
        带来源的回答
      </StreamingResponse>
    );
    const { rerender } = render(element);
    const trigger = screen.getByRole('button', { name: '查看 2 个来源' });
    expect(
      document.getElementById(trigger.getAttribute('aria-controls')!)?.getAttribute('aria-hidden'),
    ).toBe('true');
    fireEvent.click(trigger);
    rerender(
      <StreamingResponse
        status="complete"
        sources={sources}
        onOpenFile={onOpenFile}
        onOpenUrl={onOpenUrl}
        copyState="copied"
      >
        带来源的回答
      </StreamingResponse>,
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '打开来源 README.md' }));
    fireEvent.click(screen.getByRole('button', { name: '打开来源 Be UI' }));
    expect(onOpenFile).toHaveBeenCalledWith('README.md');
    expect(onOpenUrl).toHaveBeenCalledWith('https://beui.dev/');
  });

  it('resolves terminal and approval states before a possibly stale streaming flag', () => {
    expect(responseStatus({ streaming: true, terminalState: 'failed' })).toBe('error');
    expect(responseStatus({ streaming: true, terminalState: 'cancelled' })).toBe('cancelled');
    expect(responseStatus({ streaming: true, terminalState: 'paused' })).toBe('paused');
    expect(responseStatus({ streaming: true, waitingForApproval: true })).toBe('waiting');
    expect(responseStatus({ streaming: true })).toBe('streaming');
    expect(responseStatus({})).toBe('complete');
  });
});


it('allows an explicitly resumable failed answer to continue without changing generic-error recovery', () => {
  const onContinue = vi.fn();
  render(<StreamingResponse status="error" continueFailed onContinue={onContinue}>已保留的进度</StreamingResponse>);
  fireEvent.click(screen.getByRole('button', { name: '继续回答' }));
  expect(onContinue).toHaveBeenCalledOnce();
});
