/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentLimitsCard } from './agent-limits-card.js';
import { ContextRing } from './compose-toolbar.js';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const sections = [
  { type: 'messages' as const, tokens: 5_200 },
  { type: 'tools' as const, tokens: 960 },
  { type: 'system' as const, tokens: 420 },
  { type: 'agent' as const, tokens: 160 },
];
describe('AgentLimitsCard real counters and compact layout', () => {
  it('distinguishes calibrated input from estimated input and billed usage', () => {
    const { rerender } = render(<AgentLimitsCard used={600} limit={1000} />);
    fireEvent.click(screen.getByRole('button', { name: /窗口与压缩详情/ }));
    expect(screen.getByText('请求估算，非累计计费用量')).toBeTruthy();
    rerender(
      <AgentLimitsCard
        used={700}
        limit={1000}
        measurement={{
          source: 'provider-calibrated',
          estimatedTokens: 600,
          providerInputTokens: 700,
        }}
      />,
    );
    expect(screen.getByText('实际输入校准，增量估算')).toBeTruthy();
  });
  it('renders colored capacity buckets with percentages of capacity, not of used tokens', () => {
    render(
      <AgentLimitsCard used={6_740} limit={10_000} sections={sections} sessionTokens={20_000} />,
    );
    expect(screen.getByTestId('context-section-messages').textContent).toContain('52.0%');
    expect(screen.getByTestId('context-free-space').textContent).toContain('32.6%');
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('6740');
    expect(bar.querySelectorAll('span').length).toBe(4);
    expect((bar.firstChild as HTMLElement).style.width).toBe('52%');
    expect(screen.getByTestId('context-session-tokens').textContent).toBe('20k');
  });
  it('does not fabricate plan quotas, MCP server counts or skill/deferred buckets', () => {
    render(<AgentLimitsCard used={100} limit={1_000} />);
    expect(screen.getByTestId('agent-limits-unreported').textContent).toBe('尚未接入');
    expect(screen.queryByText('示例数据')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText(/5 小时|每周|MCP tools|Skills/)).toBeNull();
    expect(screen.getByTestId('context-unclassified').textContent).toContain('明细未上报');
  });
  it('folds buckets from header while capacity bar and usage remain visible', async () => {
    render(<AgentLimitsCard used={6_740} limit={10_000} sections={sections} />);
    const header = screen.getByTestId('agent-limits-breakdown-toggle');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('自动压缩')).toBeNull();
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /窗口与压缩详情/ })).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('context-section-messages')).toBeNull());
    expect(screen.getByRole('progressbar')).toBeTruthy();
    fireEvent.click(header);
    fireEvent.click(screen.getByRole('button', { name: /窗口与压缩详情/ }));
    expect(screen.getByTestId('context-compact-distance').textContent).toBe('1.8k');
  });
  it('keeps counters and disclosure controls intact after a rapid close and reopen', () => {
    vi.useFakeTimers();
    render(<AgentLimitsCard used={6_740} limit={10_000} sections={sections} />);
    const header = screen.getByTestId('agent-limits-breakdown-toggle');
    fireEvent.click(header);
    expect(screen.queryByRole('button', { name: /窗口与压缩详情/ })).toBeNull();
    fireEvent.click(header);
    act(() => vi.advanceTimersByTime(500));
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('context-section-messages').textContent).toContain('52.0%');
    fireEvent.click(screen.getByRole('button', { name: /窗口与压缩详情/ }));
    expect(screen.getByTestId('context-compact-distance').textContent).toBe('1.8k');
  });

  it('uses kernel categories rather than a host estimate when the kernel owns context', () => {
    render(
      <AgentLimitsCard
        used={300}
        limit={1_000}
        kernelSelfManaged
        kernelLabel="GPT"
        sections={sections}
        occupancySections={[
          { name: 'Messages', tokens: 180 },
          { name: 'MCP tools', tokens: 120 },
        ]}
      />,
    );
    expect(screen.getByTestId('context-occupancy-MCP tools').textContent).toContain('12.0%');
    expect(screen.queryByTestId('context-section-messages')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /窗口与压缩详情/ }));
    expect(screen.getByTestId('context-kernel-self-managed').textContent).toContain('GPT');
    expect(screen.queryByText('自动压缩')).toBeNull();
  });
  it('does not double count lagging kernel categories in the bar', () => {
    render(
      <AgentLimitsCard
        used={100}
        limit={1_000}
        occupancySections={[{ name: 'Messages', tokens: 200 }]}
      />,
    );
    expect(screen.getByText(/内核明细待同步/)).toBeTruthy();
    const bar = screen.getByRole('progressbar');
    expect(bar.querySelectorAll('span').length).toBe(1);
    expect((bar.firstChild as HTMLElement).style.width).toBe('10%');
    expect(screen.getByTestId('context-occupancy-Messages').textContent).toContain('200');
  });
  it('represents over-capacity usage honestly while constraining painted widths', () => {
    render(
      <AgentLimitsCard
        used={2_000}
        limit={1_000}
        occupancySections={[{ name: 'Messages', tokens: 2_000 }]}
      />,
    );
    expect(screen.getByTestId('agent-limits-breakdown-toggle').textContent).toContain('200%');
    expect(screen.getByRole('status').textContent).toContain('已超出');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1000');
    expect((screen.getByRole('progressbar').firstChild as HTMLElement).style.width).toBe('100%');
  });
  it('sanitizes invalid counters without displaying NaN/Infinity or an invented capacity', () => {
    render(
      <AgentLimitsCard used={NaN} limit={Infinity} sections={[{ type: 'tools', tokens: -50 }]} />,
    );
    expect(screen.getByTestId('agent-limits-card').textContent).not.toMatch(/NaN|Infinity/);
    expect(screen.getByTestId('context-free-space').textContent).toContain('未上报');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
  it('renders only explicitly supplied account quotas and actual reset labels', () => {
    render(
      <AgentLimitsCard
        used={200}
        limit={1_000}
        quotas={[
          {
            id: 'account',
            label: '请求额度',
            unit: 'requests',
            used: 12,
            limit: 40,
            resetLabel: '今天 18:00 重置',
          },
        ]}
      />,
    );
    expect(screen.queryByTestId('agent-limits-unreported')).toBeNull();
    expect(screen.getByText('今天 18:00 重置')).toBeTruthy();
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe('12 / 40');
    expect(screen.getByTestId('agent-limit-account').textContent).toContain('30%');
  });
});
describe('ContextRing accessible popover', () => {
  it('uses the reference card width and aligns its fixed position to physical pixels', () => {
    const viewport = { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1.25 };
    const original = Object.entries(viewport).map(
      ([key]) => [key, Object.getOwnPropertyDescriptor(window, key)] as const,
    );
    try {
      for (const [key, value] of Object.entries(viewport))
        Object.defineProperty(window, key, { configurable: true, value });
      render(<ContextRing used={100} limit={1_000} />);
      const trigger = screen.getByTestId('context-ring');
      trigger.getBoundingClientRect = () => ({
        x: 1294.333,
        y: 780.333,
        top: 780.333,
        left: 1294.333,
        right: 1316.333,
        bottom: 802.333,
        width: 22,
        height: 22,
        toJSON() {},
      });
      fireEvent.mouseEnter(trigger);
      const popup = screen.getByRole('dialog', { name: '上下文用量与额度' });
      expect(popup.style.width).toBe('448px');
      expect(Number.parseFloat(popup.style.left) * 1.25).toBe(1085);
      expect(Number.parseFloat(popup.style.bottom) * 1.25).toBe(160);
    } finally {
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(window, key, descriptor);
      }
    }
  });

  it('keeps the popup open when keyboard focus moves into a disclosure', () => {
    vi.useFakeTimers();
    render(<ContextRing used={100} limit={1_000} sections={sections} />);
    const trigger = screen.getByTestId('context-ring');
    fireEvent.focus(trigger);
    const disclosure = screen.getByTestId('agent-limits-breakdown-toggle');
    fireEvent.blur(trigger, { relatedTarget: disclosure });
    fireEvent.focus(disclosure);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('dialog', { name: '上下文用量与额度' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /窗口与压缩详情/ }));
    expect(screen.getByText('自动压缩')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('context-ring-tooltip')).toBeNull();
  });
  it('ArrowDown enters the card and Escape restores trigger focus', () => {
    render(<ContextRing used={100} limit={1_000} />);
    const trigger = screen.getByTestId('context-ring');
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('agent-limits-breakdown-toggle'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByTestId('context-ring-tooltip')).toBeNull();
  });
  it('dismisses on outside click without blocking the rest of the composer', () => {
    render(
      <>
        <ContextRing used={100} limit={1_000} />
        <button>其他操作</button>
      </>,
    );
    fireEvent.click(screen.getByTestId('context-ring'));
    fireEvent.pointerDown(screen.getByText('其他操作'));
    expect(screen.queryByTestId('context-ring-tooltip')).toBeNull();
  });
});

it('shows the same fixed-cost and output/safety reservations used by Native preflight', () => {
  render(
    <AgentLimitsCard
      used={1000}
      limit={10000}
      compactThreshold={0.85}
      budget={{
        contextWindow: 10000,
        reservedOutputTokens: 1000,
        safetyMarginTokens: 500,
        fixedInputTokens: 2000,
        availableInputTokens: 8500,
        availableHistoryTokens: 6500,
        compactTriggerTokens: 8500,
        retainedTailTokens: 1440,
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /窗口与压缩详情/ }));
  expect(screen.getByText('输出预留').parentElement?.textContent).toContain('1k');
  expect(screen.getByText('安全余量').parentElement?.textContent).toContain('500');
  expect(screen.getByText('固定输入成本').parentElement?.textContent).toContain('2k');
  expect(screen.getByText('可用历史预算').parentElement?.textContent).toContain('6.5k');
  expect(screen.getByText('自动压缩').parentElement?.textContent).toContain('85%');
});
