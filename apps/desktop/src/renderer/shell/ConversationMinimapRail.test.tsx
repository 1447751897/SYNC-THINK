/** @vitest-environment jsdom */
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function renderRailFixture(navigationItems = items, visibleItems = sourceItems) {
  const scrollerRef = createRef<HTMLDivElement>();
  const onNavigate = vi.fn();
  const view = render(
    <div>
      <div ref={scrollerRef}>
        {visibleItems.map((item) => (
          <div key={item.id} data-message-id={item.id}>
            {item.text}
          </div>
        ))}
      </div>
      <ConversationMinimapRail
        items={navigationItems}
        scrollerRef={scrollerRef}
        onNavigate={onNavigate}
      />
    </div>,
  );
  const scroller = scrollerRef.current!;
  Object.defineProperties(scroller, {
    clientHeight: { configurable: true, value: 400 },
    scrollHeight: { configurable: true, value: 1800 },
    scrollTop: { configurable: true, writable: true, value: 0 },
    getBoundingClientRect: { configurable: true, value: () => rect(100, 400) },
  });
  for (const node of scroller.querySelectorAll<HTMLElement>('[data-message-id]')) {
    node.getBoundingClientRect = () => rect(750 - scroller.scrollTop, 100);
  }
  const rail = screen.getByRole('navigation', { name: '对话消息导航' });
  rail.getBoundingClientRect = () => rect(100, 384, 6, 32);
  fireEvent(window, new Event('resize'));
  fireEvent.scroll(scroller);
  return { ...view, scroller, rail, onNavigate };
}

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
    vi.unstubAllGlobals();
  });

  it('sizes ticks from its own rail, not from the shrinking message scroller', async () => {
    const observers = new Map<Element, ResizeObserverCallback>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe = (target: Element) => observers.set(target, this.callback);
        unobserve = (target: Element) => observers.delete(target);
        disconnect = () => {};
      },
    );
    const { rail, scroller } = renderRailFixture();
    const tickTops = () =>
      Array.from(rail.querySelectorAll<HTMLElement>('.shell-conversation-minimap__tick'), (tick) =>
        tick.style.getPropertyValue('--minimap-tick-top'),
      );
    await waitFor(() =>
      expect(tickTops()).toEqual(
        buildCompactNavigationTops(items.length, 384).map((top) => `${top}px`),
      ),
    );
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 180 });
    fireEvent.scroll(scroller);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(tickTops()).toEqual(
      buildCompactNavigationTops(items.length, 384).map((top) => `${top}px`),
    );
    rail.getBoundingClientRect = () => rect(100, 584, 6, 32);
    const resize = observers.get(rail);
    expect(resize).toBeTypeOf('function');
    await act(async () => resize?.([], {} as ResizeObserver));
    expect(tickTops()).toEqual(
      buildCompactNavigationTops(items.length, 584).map((top) => `${top}px`),
    );
  });

  it('keeps the first question anchor across consecutive user messages', () => {
    const result = buildAssistantTurnNavigationItems([
      sourceItems[0]!,
      { ...sourceItems[0]!, id: 'follow-up', text: '补充：检查滚动位置' },
      sourceItems[1]!,
    ]);
    expect(result[0]).toMatchObject({
      promptId: 'user-1',
      promptText: '请修复流式输出\n补充：检查滚动位置',
    });
  });

  it('cancels a pending jump when the user resumes scrolling', async () => {
    const { scroller, onNavigate } = renderRailFixture();
    fireEvent.click(screen.getByTestId('conversation-minimap-assistant-1'));
    expect(scroller.querySelectorAll('[data-navigation-target="true"]')).toHaveLength(1);
    fireEvent.wheel(scroller, { deltaY: -100 });
    await waitFor(() => expect(scroller.dataset.navigationSettling).toBeUndefined());
    expect(scroller.querySelectorAll('[data-navigation-target="true"]')).toHaveLength(0);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('reports wheel navigation so the chat releases its automatic bottom pin', () => {
    const { rail, scroller, onNavigate } = renderRailFixture();
    scroller.scrollTop = 900;
    fireEvent.wheel(rail, { deltaY: -120 });
    expect(scroller.scrollTop).toBe(780);
    expect(onNavigate).toHaveBeenLastCalledWith(expect.any(String), 780);
  });

  it('waits for consecutive stable layout frames before ending a jump', async () => {
    const { scroller, onNavigate } = renderRailFixture();
    await waitFor(() =>
      expect(
        screen
          .getByTestId('conversation-minimap-assistant-1')
          .style.getPropertyValue('--minimap-tick-top'),
      ).not.toBe('16px'),
    );
    let navigationFrame = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
      window.setTimeout(() => {
        if (scroller.dataset.navigationSettling === 'true') navigationFrame += 1;
        callback(performance.now());
      }, 0),
    );
    const prompt = scroller.querySelector<HTMLElement>('[data-message-id="user-1"]')!;
    prompt.getBoundingClientRect = () =>
      rect(
        100 + (navigationFrame < 4 ? 700 : navigationFrame < 6 ? 900 : 1200) - scroller.scrollTop,
        100,
      );
    fireEvent.click(screen.getByTestId('conversation-minimap-assistant-1'));
    await waitFor(() => expect(scroller.dataset.navigationSettling).toBeUndefined());
    expect(onNavigate).toHaveBeenLastCalledWith('assistant-1', 1100);
  });

  it('previews and clicks the nearest turn across the wider transparent track', async () => {
    const { rail, onNavigate } = renderRailFixture();
    const tick = screen.getByTestId('conversation-minimap-assistant-1');
    await waitFor(() => expect(tick.style.getPropertyValue('--minimap-tick-top')).not.toBe('16px'));
    const clientY = 100 + Number.parseFloat(tick.style.getPropertyValue('--minimap-tick-top')) + 6;
    fireEvent.mouseMove(rail, { clientX: 35, clientY });
    expect(within(await screen.findByRole('tooltip')).getByText('请修复流式输出')).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.click(rail, { clientX: 35, clientY });
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('assistant-1', 550));
    fireEvent.mouseMove(rail, { clientX: 35, clientY: 101 });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('uses a short execution state rather than streaming prose or commentary in the preview', async () => {
    renderRailFixture([
      {
        ...items[0]!,
        streaming: true,
        processStatus: '正在验证滚动定位',
        text: '正在输出的长正文',
      },
      items[1]!,
    ]);
    fireEvent.focus(screen.getByTestId('conversation-minimap-assistant-1'));
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText('正在验证滚动定位')).toBeTruthy();
    expect(within(tooltip).queryByText('正在输出的长正文')).toBeNull();
    expect(tooltip.querySelector('.shell-conversation-minimap__detail')).toBeNull();
    fireEvent.keyDown(screen.getByRole('navigation'), { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('falls back to the assistant anchor when the paired question is outside the loaded page', async () => {
    const { onNavigate } = renderRailFixture(
      items,
      sourceItems.filter((item) => item.role === 'assistant'),
    );
    fireEvent.click(screen.getByTestId('conversation-minimap-assistant-1'));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('assistant-1', 550));
  });

  it('does not infer a completed answer from commentary', async () => {
    renderRailFixture([{ ...items[0]!, text: '', processStatus: undefined }, items[1]!]);
    fireEvent.focus(screen.getByTestId('conversation-minimap-assistant-1'));
    expect(within(await screen.findByRole('tooltip')).getByText('暂无回答摘要')).toBeTruthy();
    expect(within(screen.getByRole('tooltip')).queryByText(items[0]!.commentaryText!)).toBeNull();
  });

  it('creates one tick per assistant turn and pairs the preceding user prompt', () => {
    expect(items).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        promptText: '请修复流式输出',
        promptId: 'user-1',
      }),
      expect.objectContaining({
        id: 'assistant-2',
        role: 'assistant',
        promptText: '继续验证导航定位',
        promptId: 'user-2',
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

  it('previews the question and answer without commentary, then jumps to the question', async () => {
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
      name: '跳转到第 1 轮：请修复流式输出',
    });
    fireEvent.mouseEnter(assistantTick);

    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText('请修复流式输出')).toBeTruthy();
    expect(within(tooltip).getByText('正在分析流式输出')).toBeTruthy();
    expect(within(tooltip).queryByText('先检查显示队列，再验证滚动状态。')).toBeNull();
    expect(assistantTick.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.click(assistantTick);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('assistant-1', 0));
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
    rail.getBoundingClientRect = () => rect(100, 384, 0, 24);
    fireEvent(window, new Event('resize'));
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
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith('assistant-1', 800));

    fireEvent.mouseMove(rail, {
      clientY:
        100 + Number.parseFloat(secondTick.style.getPropertyValue('--minimap-tick-top') || '0'),
    });
    await waitFor(() =>
      expect(within(screen.getByRole('tooltip')).getByText('继续验证导航定位')).toBeTruthy(),
    );
    expect(within(screen.getByRole('tooltip')).getByText('导航定位已经验证完成')).toBeTruthy();
    fireEvent.click(secondTick);
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith('assistant-2', 1120));
  });

  it('warms only the target content-visibility row before a long-thread jump', async () => {
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
          node.dataset.messageId === 'user-1'
            ? 520
            : node.dataset.messageId === 'user-2'
              ? 1_120
              : 20;
        const realTop =
          node.dataset.messageId === 'user-1'
            ? 1_420
            : node.dataset.messageId === 'user-2'
              ? 1_720
              : 20;
        const contentTop = node.dataset.navigationTarget === 'true' ? realTop : estimatedTop;
        return rect(100 + contentTop - scroller.scrollTop, 100);
      };
    }

    fireEvent.scroll(scroller);
    fireEvent.click(
      await screen.findByRole('button', {
        name: '跳转到第 1 轮：请修复流式输出',
      }),
    );

    expect(scroller.dataset.navigationSettling).toBe('true');
    expect(scroller.querySelectorAll('[data-navigation-target="true"]')).toHaveLength(1);
    expect(
      scroller.querySelector('[data-navigation-target="true"]')?.getAttribute('data-message-id'),
    ).toBe('user-1');
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('assistant-1', 1_320));
    await waitFor(() => expect(scroller.dataset.navigationSettling).toBeUndefined());
    expect(scroller.querySelectorAll('[data-navigation-target="true"]')).toHaveLength(0);
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
    rail.getBoundingClientRect = () => rect(100, 384, 0, 24);
    fireEvent(window, new Event('resize'));
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

  it('keeps the current turn active until its following question reaches the reading focus', async () => {
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

    scroller.scrollTop = 900;
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
