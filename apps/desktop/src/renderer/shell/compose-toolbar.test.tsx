/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextRing } from './compose-toolbar.js';

afterEach(() => cleanup());

describe('ContextRing', () => {
  it('shows the complete runtime context window, compact threshold, and saved summary', () => {
    render(
      <ContextRing
        used={12_500}
        limit={10_000}
        usageRatio={1.25}
        compactThreshold={0.7}
        compactedAt="2026-08-04T09:30:00.000Z"
        sessionTokens={48_000}
        sections={[
          { type: 'system', tokens: 1_000 },
          { type: 'agent', tokens: 2_000 },
          { type: 'project', tokens: 3_000 },
          { type: 'summary', tokens: 500 },
          { type: 'messages', tokens: 5_000 },
          { type: 'tools', tokens: 1_000 },
        ]}
      />,
    );

    const ring = screen.getByTestId('context-ring');
    expect(ring.getAttribute('aria-label')).toContain('125%');
    fireEvent.mouseEnter(ring);

    expect(screen.getByText('当前上下文窗口')).toBeTruthy();
    expect(screen.getByText('当前模型实际可见的完整上下文窗口')).toBeTruthy();
    expect(screen.getByText('当前对话上下文构成')).toBeTruthy();
    expect(screen.getByTestId('context-used-value').getAttribute('title')).toBe('12,500 Token');
    expect(screen.getByText('自动压缩')).toBeTruthy();
    expect(screen.getByText(/7k/)).toBeTruthy();
    expect(screen.getByTestId('context-compact-distance').textContent).toBe('已达阈值');
    expect(screen.getByTestId('context-compacted-at').textContent).not.toBe('尚未发生');
    expect(screen.getByTestId('context-section-system').textContent).toContain('系统指令');
    expect(screen.getByTestId('context-section-system').textContent).toContain('1k');
    expect(
      screen.getByTestId('context-section-system').querySelector('strong')?.getAttribute('title'),
    ).toBe('1,000 Token');
    expect(screen.getByTestId('context-section-agent').textContent).toContain('智能体 / 小队');
    expect(screen.getByTestId('context-section-project').textContent).toContain('项目上下文');
    expect(screen.getByTestId('context-section-summary').textContent).toContain('已保存摘要');
    expect(screen.getByTestId('context-section-messages').textContent).toContain('消息历史');
    expect(screen.getByTestId('context-section-tools').textContent).toContain('工具定义');
    expect(screen.getByText('累计 Token 消耗')).toBeTruthy();
    expect(screen.getByText('48k')).toBeTruthy();
    expect(screen.queryByText(/prompt body|hidden reasoning/i)).toBeNull();
  });

  it('opens on click and reports remaining capacity before automatic compact', () => {
    render(
      <ContextRing
        used={17_000}
        limit={400_000}
        usageRatio={0.0425}
        compactThreshold={0.7}
        sections={[
          { type: 'system', tokens: 2_000 },
          { type: 'agent', tokens: 27 },
          { type: 'project', tokens: 79 },
          { type: 'summary', tokens: 0 },
          { type: 'messages', tokens: 9_000 },
          { type: 'tools', tokens: 5_894 },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId('context-ring'));

    expect(screen.getByText('达到 70% 时，在发送下一条消息前自动压缩')).toBeTruthy();
    expect(screen.getByTestId('context-compact-distance').textContent).toBe('263k');
    expect(screen.getByTestId('context-compacted-at').textContent).toBe('尚未发生');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('400000');
  });

  it('marks cumulative token usage as unreported instead of fabricating zero', () => {
    render(
      <ContextRing
        used={9_000}
        limit={400_000}
        usageRatio={0.0225}
        compactThreshold={0.7}
        sections={[]}
      />,
    );

    fireEvent.click(screen.getByTestId('context-ring'));

    expect(screen.getByText('当前上下文窗口')).toBeTruthy();
    expect(screen.getByText('累计 Token 消耗')).toBeTruthy();
    expect(screen.getByTestId('context-session-tokens').textContent).toBe('尚未上报');
  });
});
