import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MessageBubble } from '../src/components/MessageBubble.js';

const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8');

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

  it('shows a compact thinking state until the first streamed text arrives', () => {
    const { rerender } = render(
      <MessageBubble role="assistant" streaming agentLabel="Architect" />,
    );

    expect(screen.getByTestId('message-thinking').textContent).toContain('Architect 正在思考');

    rerender(
      <MessageBubble role="assistant" streaming agentLabel="Architect">
        第一段已经到达
      </MessageBubble>,
    );

    expect(screen.queryByTestId('message-thinking')).toBeNull();
    expect(screen.getByText('第一段已经到达')).toBeTruthy();
    expect(screen.getByTestId('message-bubble').getAttribute('data-streaming')).toBe('1');
  });

  it('renders assistant markdown with Agent, model, time, and truthful token metadata', () => {
    const onAgentActivate = vi.fn();
    render(
      <MessageBubble
        role="assistant"
        agentLabel="执行智能体"
        agentIcon="workflow"
        agentColor="#227755"
        meta="internal-model-id"
        modelLabel="claude-opus-4"
        occurredAt="14:23"
        tokenLabel="2,891 tok"
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
    expect(screen.getByText('claude-opus-4')).toBeTruthy();
    expect(screen.getByText('14:23')).toBeTruthy();
    expect(screen.getByText('2,891 tok')).toBeTruthy();
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

  it('renders the effective @ target without changing the persisted message body', () => {
    render(
      <MessageBubble role="user" mentionLabel="前端实现官">
        请处理首页
      </MessageBubble>,
    );

    expect(screen.getByTestId('message-mention').textContent).toBe('@前端实现官');
    expect(screen.getByText('请处理首页')).toBeTruthy();
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

describe('MessageBubble motion and typography contracts', () => {
  it('scales the user timestamp with the application preference', () => {
    expect(css).toMatch(
      /\.st-message-bubble__user-time\s*\{[^}]*font-size: calc\(9\.5px \* var\(--st-user-font-scale, 1\)\)/s,
    );
    expect(css).toMatch(
      /\.st-compose__input\s*\{[^}]*font-size: calc\(14\.5px \* var\(--st-user-font-scale, 1\)\)/s,
    );
  });

  it('renders assistant preformatted Chinese content with readable wrapped typography', () => {
    expect(css).toMatch(
      /\.st-message-bubble\[data-role='assistant'\] \.st-message-bubble__body pre\s*\{[^}]*font-family: var\(--st-typo-font-family-body[^}]*font-size: calc\(13px \* var\(--st-user-font-scale, 1\)\)[^}]*line-height: 1\.7/s,
    );
    expect(css).toMatch(
      /\.st-message-bubble\[data-role='assistant'\] \.st-message-bubble__body pre code\s*\{[^}]*white-space: pre-wrap[^}]*overflow-wrap: anywhere/s,
    );
  });

  it('stops the thinking spinner when reduced motion is requested', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.st-message-bubble__thinking > svg\s*\{[^}]*animation: none/s,
    );
    const reducedMotionIndex = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    expect(reducedMotionIndex).toBeGreaterThan(css.lastIndexOf('animation: st-message-enter'));
    expect(reducedMotionIndex).toBeGreaterThan(
      css.lastIndexOf('animation: st-message-thinking-spin'),
    );
    expect(reducedMotionIndex).toBeGreaterThan(css.lastIndexOf('animation: st-menu-rise'));
  });
});
