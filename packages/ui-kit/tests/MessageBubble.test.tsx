import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MessageBubble } from '../src/components/MessageBubble.js';

describe('MessageBubble layout', () => {
  it('defaults to split layout (user right / agent left semantics)', () => {
    render(<MessageBubble role="user">hello</MessageBubble>);
    const el = screen.getByTestId('message-bubble');
    expect(el.getAttribute('data-role')).toBe('user');
    expect(el.getAttribute('data-layout')).toBe('default');
  });

  it('supports single-column layout for long reading (§28)', () => {
    render(
      <MessageBubble role="user" layout="single">
        long text
      </MessageBubble>,
    );
    expect(screen.getByTestId('message-bubble').getAttribute('data-layout')).toBe('single');
  });

  it('marks streaming assistant turns for a11y', () => {
    render(
      <MessageBubble role="assistant" streaming agentLabel="SYNC-THINK">
        …
      </MessageBubble>,
    );
    const el = screen.getByTestId('message-bubble');
    expect(el.getAttribute('data-streaming')).toBe('1');
    expect(el.getAttribute('aria-label')).toMatch(/流式输出中|streaming/i);
  });

  it('renders assistant markdown with a compact Agent identity and no execution metadata', () => {
    const onAgentActivate = vi.fn();
    render(
      <MessageBubble
        role="assistant"
        agentLabel="执行智能体"
        agentIcon="workflow"
        agentColor="#227755"
        meta="internal-model-id"
        onAgentActivate={onAgentActivate}
      >
        {'## Result\n\n- first\n- second\n\n`run.completed`'}
      </MessageBubble>,
    );
    expect(screen.getByRole('heading', { name: 'Result' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('run.completed').tagName).toBe('CODE');
    expect(screen.getByText('执行智能体')).toBeTruthy();
    expect(screen.getByTestId('message-agent-avatar').getAttribute('data-icon')).toBe('workflow');
    expect(screen.getByTestId('message-agent-avatar').getAttribute('style')).toContain('#227755');
    fireEvent.click(screen.getByRole('button', { name: '打开智能体：执行智能体' }));
    expect(onAgentActivate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('internal-model-id')).toBeNull();
  });

  it('does not render Agent identity for user turns', () => {
    render(
      <MessageBubble role="user" agentLabel="不应显示">
        hello
      </MessageBubble>,
    );
    expect(screen.queryByTestId('message-agent-identity')).toBeNull();
  });
});

describe('MessageBubble Chinese a11y', () => {
  it('uses Chinese aria labels for streaming and roles', () => {
    const { rerender } = render(
      <MessageBubble role="assistant" streaming>
        hi
      </MessageBubble>,
    );
    expect(screen.getByLabelText('助手消息 · 流式输出中')).toBeTruthy();
    rerender(<MessageBubble role="user">hi</MessageBubble>);
    expect(screen.getByLabelText('用户消息')).toBeTruthy();
  });
});
