/** @vitest-environment jsdom */
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAssistantTurnNavigationItems,
  buildCompactNavigationTops,
  ConversationMinimapRail,
  type ConversationNavigationItem,
} from './ConversationMinimapRail.js';

function rect(top: number, height: number, left = 0, width = 800): DOMRect {
  return {
    x: left,
    y: top,
    top,
    right: left + width,
    bottom: top + height,
    left,
    width,
    height,
    toJSON: () => ({}),
  };
}

const sourceItems: ConversationNavigationItem[] = [
  {
    id: 'user-1',
    role: 'user',
    text: '请修复流式输出',
    timestamp: '2026-08-08T08:00:00.000Z',
  },
  {
    id: 'assistant-1',
    role: 'assistant',
    text: '正在分析流式输出',
    commentaryText: '先检查显示队列，再验证滚动状态。',
    timestamp: '2026-08-08T08:00:05.000Z',
  },
  {
    id: 'system-1',
    role: 'system',
    text: '正在重新连接运行时',
    processStatus: '切换到 fallback 模型',
    timestamp: '2026-08-08T08:00:10.000Z',
  },
  {
    id: 'user-2',
    role: 'user',
    text: '继续验证导航定位',
    timestamp: '2026-08-08T08:01:00.000Z',
  },
  {
    id: 'assistant-2',
    role: 'assistant',
    text: '导航定位已经验证完成',
    timestamp: '2026-08-08T08:01:05.000Z',
  },
];
const items = buildAssistantTurnNavigationItems(sourceItems);

describe('ConversationMinimapRail', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 0),
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: (handle: number) => window.clearTimeout(handle),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('creates one tick per assistant turn and pairs the preceding user prompt', () => {
    expect(items).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        promptText: '请修复流式输出',
      }),
      expect.objectContaining({
        id: 'assistant-2',
        role: 'assistant',
        promptText: '继续验证导航定位',
      }),
    ]);
    expect(items.map((item) => item.id)).not.toContain('user-1');
    expect(items.map((item) => item.id)).not.toContain('system-1');
  });

  it('centers assistant turns and progressively tightens their spacing as the thread grows', () => {
    const sparse = buildCompactNavigationTops(4, 600);
    const medium = buildCompactNavigationTops(12, 600);
    const dense = buildCompactNavigationTops(40, 600);

    const midpoint = (tops: number[]) => ((tops[0] ?? 0) + (tops.at(-1) ?? 0)) / 2;
    const firstGap = (tops: number[]) => (tops[1] ?? 0) - (tops[0] ?? 0);

    expect(buildCompactNavigationTops(1, 600)).toEqual([300]);
    expect(midpoint(sparse)).toBeCloseTo(300);
    expect(midpoint(medium)).toBeCloseTo(300);
    expect(midpoint(dense)).toBeCloseTo(300);
    expect(firstGap(sparse)).toBeGreaterThan(firstGap(medium));
    expect(firstGap(medium)).toBeGreaterThan(firstGap(dense));
    expect(sparse[0]).toBeGreaterThan(16);
    expect(dense.at(-1)).toBeLessThan(584);
  });

  it('compresses oversized threads to the available centered track without overflowing', () => {
    const tops = buildCompactNavigationTops(120, 360);

    expect(tops).toHaveLength(120);
    expect(tops[0]).toBeCloseTo(16);
    expect(tops.at(-1)).toBeCloseTo(344);
    expect(((tops[0] ?? 0) + (tops.at(-1) ?? 0)) / 2).toBeCloseTo(180);
  });

  it('shows message details on hover and reports the measured jump target on click', async () => {
    const scrollerRef = createRef<HTMLDivElement>();
    const onNavigate = vi.fn();
    render(
      <div>
        <div ref={scrollerRef}>
          {sourceItems.map((item) => (
            <div key={item.id} data-message-id={item.id}>
              {item.text}
            </div>
          ))}
        </div>
        <ConversationMinimapRail items={items} scrollerRef={scrollerRef} onNavigate={onNavigate} />
      </div>,
    );

    const scroller = scrollerRef.current!;
    const contentTops = new Map([
      ['user-1', 20],
      ['assistant-1', 520],
      ['system-1', 1120],
      ['user-2', 1320],
      ['assistant-2', 1520],
    ]);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1800 },
      scrollTop: { configurable: true, writable: true, value: 0 },
      getBoundingClientRect: { configurable: true, value: () => rect(100, 400) },
    });
    for (const node of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const contentTop = contentTops.get(node.dataset.messageId!)!;
      node.getBoundingClientRect = () => rect(100 + contentTop - scroller.scrollTop, 100);
    }
    fireEvent.scroll(scroller);

    const assistantTick = await screen.findByRole('button', {
      name: '跳转到助手回答：正在分析流式输出',
    });
    fireEvent.mouseEnter(assistantTick);

    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText('请修复流式输出')).toBeTruthy();
    expect(within(tooltip).getByText('正在分析流式输出')).toBeTruthy();
    expect(within(tooltip).getByText('先检查显示队列，再验证滚动状态。')).toBeTruthy();

    fireEvent.click(assistantTick);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('assistant-1', 420));
  });

  it('selects the nearest visual tick inside the centered adaptive group', async () => {
    const scrollerRef = createRef<HTMLDivElement>();
    const onNavigate = vi.fn();
    render(
      <div>
        <div ref={scrollerRef}>
          {sourceItems.map((item) => (
            <div key={item.id} data-message-id={item.id}>
              {item.text}
            </div>
          ))}
        </div>
        <ConversationMinimapRail items={items} scrollerRef={scrollerRef} onNavigate={onNavigate} />
      </div>,
    );

    const scroller = scrollerRef.current!;
    const contentTops = new Map([
      ['user-1', 900],
      ['assistant-1', 1000],
      ['system-1', 1200],
      ['user-2', 1220],
      ['assistant-2', 1010],
    ]);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1600 },
      scrollTop: { configurable: true, writable: true, value: 0 },
      getBoundingClientRect: { configurable: true, value: () => rect(100, 400) },
    });
    for (const node of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const contentTop = contentTops.get(node.dataset.messageId!)!;
      node.getBoundingClientRect = () => rect(100 + contentTop - scroller.scrollTop, 100);
    }

    const rail = screen.getByRole('navigation', { name: '对话消息导航' });
    rail.getBoundingClientRect = () => rect(100, 600, 0, 24);
    fireEvent.scroll(scroller);

    const firstTick = screen.getByTestId('conversation-minimap-assistant-1');
    const secondTick = screen.getByTestId('conversation-minimap-assistant-2');
    await waitFor(() =>
      expect(firstTick.style.getPropertyValue('--minimap-tick-top')).not.toBe('16px'),
    );

    fireEvent.mouseMove(rail, {
      clientY:
        100 + Number.parseFloat(firstTick.style.getPropertyValue('--minimap-tick-top') || '0'),
    });
    await waitFor(() =>
      expect(within(screen.getByRole('tooltip')).getByText('请修复流式输出')).toBeTruthy(),
    );
    expect(within(screen.getByRole('tooltip')).getByText('请修复流式输出')).toBeTruthy();
    fireEvent.click(firstTick);
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith('assistant-1', 900));

    fireEvent.mouseMove(rail, {
      clientY:
        100 + Number.parseFloat(secondTick.style.getPropertyValue('--minimap-tick-top') || '0'),
    });
    await waitFor(() =>
      expect(within(screen.getByRole('tooltip')).getByText('继续验证导航定位')).toBeTruthy(),
    );
    expect(within(screen.getByRole('tooltip')).getByText('导航定位已经验证完成')).toBeTruthy();
    fireEvent.click(secondTick);
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith('assistant-2', 910));
  });

  it('warms content-visibility rows before measuring a long-thread jump', async () => {
    const scrollerRef = createRef<HTMLDivElement>();
    const onNavigate = vi.fn();
    render(
      <div>
        <div ref={scrollerRef}>
          {sourceItems.map((item) => (
            <div key={item.id} data-message-id={item.id}>
              {item.text}
            </div>
          ))}
        </div>
        <ConversationMinimapRail items={items} scrollerRef={scrollerRef} onNavigate={onNavigate} />
      </div>,
    );

    const scroller = scrollerRef.current!;
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 2_000 },
      scrollTop: { configurable: true, writable: true, value: 0 },
      getBoundingClientRect: { configurable: true, value: () => rect(100, 400) },
    });
    for (const node of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
      node.getBoundingClientRect = () => {
        const estimatedTop =
          node.dataset.messageId === 'assistant-1'
            ? 520
            : node.dataset.messageId === 'assistant-2'
              ? 1_120
              : 20;
        const realTop =
          node.dataset.messageId === 'assistant-1'
            ? 1_420
            : node.dataset.messageId === 'assistant-2'
              ? 1_720
              : 20;
        const contentTop = scroller.dataset.navigationSettling === 'true' ? realTop : estimatedTop;
        return rect(100 + contentTop - scroller.scrollTop, 100);
      };
    }

    fireEvent.scroll(scroller);
    fireEvent.click(
      await screen.findByRole('button', {
        name: '跳转到助手回答：正在分析流式输出',
      }),
    );

    expect(scroller.dataset.navigationSettling).toBe('true');
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('assistant-1', 1_320));
    await waitFor(() => expect(scroller.dataset.navigationSettling).toBeUndefined());
  });

  it('keeps the clicked item active after the navigation scroll event settles', async () => {
    const scrollerRef = createRef<HTMLDivElement>();
    render(
      <div>
        <div ref={scrollerRef}>
          {sourceItems.map((item) => (
            <div key={item.id} data-message-id={item.id}>
              {item.text}
            </div>
          ))}
        </div>
        <ConversationMinimapRail
          items={items}
          scrollerRef={scrollerRef}
          onNavigate={(_itemId, targetScrollTop) => {
            const scroller = scrollerRef.current!;
            scroller.scrollTop = targetScrollTop;
            fireEvent.scroll(scroller);
          }}
        />
      </div>,
    );

    const scroller = scrollerRef.current!;
    const contentTops = new Map([
      ['user-1', 900],
      ['assistant-1', 1_000],
      ['system-1', 1_200],
      ['user-2', 1_300],
      ['assistant-2', 1_500],
    ]);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_800 },
      scrollTop: { configurable: true, writable: true, value: 0 },
      getBoundingClientRect: { configurable: true, value: () => rect(100, 400) },
    });
    for (const node of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const contentTop = contentTops.get(node.dataset.messageId!)!;
      node.getBoundingClientRect = () => rect(100 + contentTop - scroller.scrollTop, 100);
    }

    fireEvent.scroll(scroller);
    const rail = screen.getByRole('navigation', { name: '对话消息导航' });
    rail.getBoundingClientRect = () => rect(100, 600, 0, 24);
    const expectedPositions = buildCompactNavigationTops(2, 384).map((top) => `${top}px`);
    await waitFor(() =>
      expect(
        Array.from(
          rail.querySelectorAll<HTMLElement>('.shell-conversation-minimap__tick'),
          (tick) => tick.style.getPropertyValue('--minimap-tick-top'),
        ),
      ).toEqual(expectedPositions),
    );
    const positionsBeforeNavigation = Array.from(
      rail.querySelectorAll<HTMLElement>('.shell-conversation-minimap__tick'),
      (tick) => tick.style.getPropertyValue('--minimap-tick-top'),
    );
    fireEvent.mouseEnter(screen.getByTestId('conversation-minimap-assistant-1'));
    await waitFor(() =>
      expect(within(screen.getByRole('tooltip')).getByText('请修复流式输出')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('conversation-minimap-assistant-1'));

    await waitFor(() =>
      expect(screen.getByTestId('conversation-minimap-assistant-1').dataset.active).toBe('true'),
    );
    expect(
      Array.from(rail.querySelectorAll<HTMLElement>('.shell-conversation-minimap__tick'), (tick) =>
        tick.style.getPropertyValue('--minimap-tick-top'),
      ),
    ).toEqual(positionsBeforeNavigation);
  });

  it('tracks the message nearest the reading focus while scrolling', async () => {
    const scrollerRef = createRef<HTMLDivElement>();
    render(
      <div>
        <div ref={scrollerRef}>
          {sourceItems.map((item) => (
            <div key={item.id} data-message-id={item.id}>
              {item.text}
            </div>
          ))}
        </div>
        <ConversationMinimapRail items={items} scrollerRef={scrollerRef} onNavigate={vi.fn()} />
      </div>,
    );

    const scroller = scrollerRef.current!;
    const contentTops = new Map([
      ['user-1', 20],
      ['assistant-1', 520],
      ['system-1', 1120],
      ['user-2', 1220],
      ['assistant-2', 1520],
    ]);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1600 },
      scrollTop: { configurable: true, writable: true, value: 0 },
      getBoundingClientRect: { configurable: true, value: () => rect(100, 400) },
    });
    for (const node of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const contentTop = contentTops.get(node.dataset.messageId!)!;
      node.getBoundingClientRect = () => rect(100 + contentTop - scroller.scrollTop, 100);
    }

    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(screen.getByTestId('conversation-minimap-assistant-1').dataset.active).toBe('true'),
    );

    scroller.scrollTop = 1_200;
    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(screen.getByTestId('conversation-minimap-assistant-2').dataset.active).toBe('true'),
    );
  });

  it('keeps the first and last navigation items active at scroll boundaries', async () => {
    const scrollerRef = createRef<HTMLDivElement>();
    render(
      <div>
        <div ref={scrollerRef}>
          {sourceItems.map((item) => (
            <div key={item.id} data-message-id={item.id}>
              {item.text}
            </div>
          ))}
        </div>
        <ConversationMinimapRail items={items} scrollerRef={scrollerRef} onNavigate={vi.fn()} />
      </div>,
    );

    const scroller = scrollerRef.current!;
    const contentTops = new Map([
      ['user-1', 20],
      ['assistant-1', 105],
      ['system-1', 1500],
      ['user-2', 1520],
      ['assistant-2', 1580],
    ]);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1600 },
      scrollTop: { configurable: true, writable: true, value: 0 },
      getBoundingClientRect: { configurable: true, value: () => rect(100, 400) },
    });
    for (const node of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const contentTop = contentTops.get(node.dataset.messageId!)!;
      node.getBoundingClientRect = () => rect(100 + contentTop - scroller.scrollTop, 100);
    }

    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(screen.getByTestId('conversation-minimap-assistant-1').dataset.active).toBe('true'),
    );

    scroller.scrollTop = 1200;
    fireEvent.scroll(scroller);
    await waitFor(() =>
      expect(screen.getByTestId('conversation-minimap-assistant-2').dataset.active).toBe('true'),
    );
  });
});
