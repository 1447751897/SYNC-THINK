/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextRing } from './compose-toolbar.js';

afterEach(() => cleanup());

describe('ContextRing', () => {
  it('shows the runtime context breakdown as category token counts only', () => {
    render(
      <ContextRing
        used={12_500}
        limit={10_000}
        usageRatio={1.25}
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

    expect(screen.getByText('本次上下文构成')).toBeTruthy();
    expect(screen.getByTestId('context-section-system').textContent).toContain('系统指令');
    expect(screen.getByTestId('context-section-system').textContent).toContain('1k');
    expect(screen.getByTestId('context-section-agent').textContent).toContain('智能体 / 小队');
    expect(screen.getByTestId('context-section-project').textContent).toContain('项目上下文');
    expect(screen.getByTestId('context-section-summary').textContent).toContain('压缩摘要');
    expect(screen.getByTestId('context-section-messages').textContent).toContain('消息');
    expect(screen.getByTestId('context-section-tools').textContent).toContain('工具');
    expect(screen.queryByText(/prompt body|hidden reasoning/i)).toBeNull();
  });
});
