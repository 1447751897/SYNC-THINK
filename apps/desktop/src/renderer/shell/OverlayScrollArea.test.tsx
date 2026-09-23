/**
 * @vitest-environment jsdom
 *
 * 这些用例锁的是「照搬 NewMax」的那几个关键点：原生滚动条两条渲染路径都被关掉、
 * thumb 的几何与 NewMax 的 DsSingleScrollArea 一致、滚动即点亮 / 停 1.2s 淡出、
 * 内容装得下时不画轨道。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_SCROLL_THUMB_MIN_SIZE,
  OVERLAY_SCROLL_THUMB_WIDTH,
  OVERLAY_SCROLL_THUMB_WIDTH_HOVER,
  OverlayScrollArea,
} from './OverlayScrollArea.js';

const shellCss = readFileSync(resolve(process.cwd(), 'src/renderer/shell/shell.css'), 'utf8');

interface MetricStub {
  clientSize: number;
  scrollSize: number;
}

/** jsdom 没有布局，滚动度量必须自己塞。 */
function stubScrollMetrics(metrics: MetricStub): void {
  const positions = new WeakMap<HTMLElement, number>();
  const isInner = (el: HTMLElement) => el.classList.contains('shell-overlay-scroll__inner');

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isInner(this) ? metrics.clientSize : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return isInner(this) ? metrics.scrollSize : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement) {
      return positions.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      positions.set(this, value);
    },
  });
}

/**
 * jsdom 不一定装了 PointerEvent；退回 MouseEvent 也照样能触发 React 的 onPointerDown，
 * 关键是要真的带上 clientY，否则拖拽位移会算成 NaN。
 */
function pointerEvent(type: string, init: { clientY?: number; pointerId?: number }): Event {
  const ctor =
    (globalThis as unknown as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  return new ctor(type, { bubbles: true, cancelable: true, ...init });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OverlayScrollArea', () => {
  it('scrolls on wheel inside a popover even when an outer scroll lock owns the page', () => {
    stubScrollMetrics({ clientSize: 120, scrollSize: 440 });
    render(
      <OverlayScrollArea>
        <div>many rows</div>
      </OverlayScrollArea>,
    );
    const inner = screen.getByTestId('overlay-scroll-inner');
    fireEvent.wheel(inner, { deltaY: 90 });
    expect(inner.scrollTop).toBe(90);
    // The thumb is a sibling of the inner scroll element: wheel still works there.
    fireEvent.wheel(inner.parentElement!, { deltaY: 35 });
    expect(inner.scrollTop).toBe(125);
  });

  it('uses live theme colors for slash and model/reasoning popovers', () => {
    expect(shellCss).toMatch(
      /\.shell-mention-pop\.shell-slash-pop\.shell-composer-slash-menu\s*\{[^}]*--composer-surface: var\(--color-overlay\);[^}]*--composer-hover: var\(--color-hover\);/s,
    );
    expect(shellCss).toMatch(
      /\.shell-menu--reasoning-flyout\s*\{[^}]*--composer-surface: var\(--color-overlay\);/s,
    );
    expect(shellCss).toMatch(/\.shell-composer-slash-menu__viewport\s*\{[^}]*flex: 1 1 auto;/s);
    expect(shellCss).toMatch(/\.ability-hub__scroll\s*\{[^}]*overflow: hidden;/s);
    expect(shellCss).toMatch(/\.model-list-select__menu\s*\{[^}]*overflow: hidden;/s);
  });

  it('keeps the native scrollbar off on both Chromium rendering paths', () => {
    // 只关一条会漏出系统滚动条：scrollbar-width 管标准路径，::-webkit-scrollbar 管 webkit 路径。
    expect(shellCss).toMatch(/\.shell-overlay-scroll__inner\s*\{[^}]*scrollbar-width:\s*none;/s);
    expect(shellCss).toMatch(
      /\.shell-overlay-scroll__inner::-webkit-scrollbar\s*\{[^}]*display:\s*none;/s,
    );
    // 模型菜单的滚动容器不能再声明 scrollbar-width，否则上面的 webkit 规则整体失效。
    expect(shellCss).not.toMatch(/\.shell-menu__scroll\s*\{[^}]*scrollbar-width/s);
    expect(shellCss).not.toMatch(/shell-menu--model[\s\S]{0,200}scrollbar-width:\s*thin/s);
  });

  it('uses a rounded composer scrollbar instead of the native Windows track', () => {
    expect(shellCss).toMatch(
      /\.shell-composer-editor__surface \.cm-scroller\s*\{[^}]*scrollbar-width:\s*auto;[^}]*scrollbar-color:\s*auto;/s,
    );
    expect(shellCss).toMatch(
      /\.shell-composer-editor__surface \.cm-scroller::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px;/s,
    );
    expect(shellCss).toMatch(
      /\.shell-composer-editor__surface \.cm-scroller::-webkit-scrollbar-thumb:hover\s*\{/s,
    );
    expect(shellCss).toMatch(
      /\.shell-newmax-composer \.shell-compose__input\s*\{[^}]*scrollbar-width:\s*auto;[^}]*scrollbar-color:\s*auto;/s,
    );
  });

  it('sizes and places the thumb with NewMax geometry', async () => {
    stubScrollMetrics({ clientSize: 200, scrollSize: 800 });
    render(
      <OverlayScrollArea innerClassName="shell-menu__scroll">
        <div>content</div>
      </OverlayScrollArea>,
    );

    const track = await screen.findByTestId('overlay-scroll-track');
    const thumb = screen.getByTestId('overlay-scroll-thumb');
    // 200 / 800 * 200 = 50
    expect(thumb.style.height).toBe('50px');
    expect(thumb.style.width).toBe(`${OVERLAY_SCROLL_THUMB_WIDTH}px`);
    expect(thumb.style.opacity).toBe('0');
    expect(track.style.width).toBe('12px');

    // 滚到底：offset = (600 / 600) * (200 - 50) = 150
    const inner = screen.getByTestId('overlay-scroll-inner');
    inner.scrollTop = 600;
    fireEvent.scroll(inner);
    expect(thumb.style.top).toBe('150px');
  });

  it('never lets the thumb shrink below the NewMax minimum', async () => {
    stubScrollMetrics({ clientSize: 200, scrollSize: 20_000 });
    render(<OverlayScrollArea>{null}</OverlayScrollArea>);

    const thumb = await screen.findByTestId('overlay-scroll-thumb');
    expect(thumb.style.height).toBe(`${OVERLAY_SCROLL_THUMB_MIN_SIZE}px`);
  });

  it('paints the thumb while scrolling and fades it out after the NewMax delay', async () => {
    // 这里刻意不用 fake timers：组件用 requestAnimationFrame 做首次测量，
    // 假时钟下 rAF 不推进，await 帧会直接把用例挂到超时。
    stubScrollMetrics({ clientSize: 200, scrollSize: 800 });
    render(<OverlayScrollArea>{null}</OverlayScrollArea>);

    const thumb = await screen.findByTestId('overlay-scroll-thumb');
    expect(thumb.style.opacity).toBe('0');

    const inner = screen.getByTestId('overlay-scroll-inner');
    inner.scrollTop = 120;
    fireEvent.scroll(inner);
    expect(thumb.style.opacity).toBe('1');

    // 1.2s 内再滚一次会重新计时（NewMax 的 showThumb 每次都 clearTimeout），不该提前淡出。
    await new Promise((resolveWait) => setTimeout(resolveWait, 700));
    inner.scrollTop = 240;
    fireEvent.scroll(inner);
    expect(thumb.style.opacity).toBe('1');

    await waitFor(() => expect(thumb.style.opacity).toBe('0'), { timeout: 3000 });
  });

  it('grows the thumb on track hover like NewMax does', async () => {
    stubScrollMetrics({ clientSize: 200, scrollSize: 800 });
    render(<OverlayScrollArea>{null}</OverlayScrollArea>);

    const track = await screen.findByTestId('overlay-scroll-track');
    const thumb = screen.getByTestId('overlay-scroll-thumb');
    expect(thumb.style.width).toBe(`${OVERLAY_SCROLL_THUMB_WIDTH}px`);

    fireEvent.mouseEnter(track);
    expect(thumb.style.width).toBe(`${OVERLAY_SCROLL_THUMB_WIDTH_HOVER}px`);
    expect(thumb.style.opacity).toBe('1');

    fireEvent.mouseLeave(track);
    expect(thumb.style.width).toBe(`${OVERLAY_SCROLL_THUMB_WIDTH}px`);
  });

  it('draws no track when the content already fits', async () => {
    stubScrollMetrics({ clientSize: 200, scrollSize: 200 });
    render(<OverlayScrollArea>{null}</OverlayScrollArea>);

    await waitFor(() => {
      expect(screen.queryByTestId('overlay-scroll-track')).toBeNull();
    });
  });

  it('shows the content fade only on the side that still has content', async () => {
    stubScrollMetrics({ clientSize: 200, scrollSize: 800 });
    render(<OverlayScrollArea>{null}</OverlayScrollArea>);

    const start = await screen.findByTestId('overlay-scroll-fade-start');
    const end = screen.getByTestId('overlay-scroll-fade-end');
    expect(start.className).not.toContain('is-visible');
    await waitFor(() => expect(end.className).toContain('is-visible'));

    const inner = screen.getByTestId('overlay-scroll-inner');
    inner.scrollTop = 600;
    fireEvent.scroll(inner);
    expect(start.className).toContain('is-visible');
    expect(end.className).not.toContain('is-visible');
  });

  it('drags the thumb to scroll the inner element', async () => {
    stubScrollMetrics({ clientSize: 200, scrollSize: 800 });
    render(<OverlayScrollArea>{null}</OverlayScrollArea>);

    const thumb = await screen.findByTestId('overlay-scroll-thumb');
    const inner = screen.getByTestId('overlay-scroll-inner');

    fireEvent(thumb, pointerEvent('pointerdown', { clientY: 0, pointerId: 1 }));
    fireEvent(document, pointerEvent('pointermove', { clientY: 75 }));
    fireEvent(document, pointerEvent('pointerup', { pointerId: 1 }));

    // maxThumbOffset 150、maxScroll 600 → 75 / 150 * 600 = 300
    expect(inner.scrollTop).toBe(300);
  });

  it('forwards the scroll element to the caller', async () => {
    stubScrollMetrics({ clientSize: 200, scrollSize: 800 });
    const scrollRef = { current: null as HTMLDivElement | null };
    render(<OverlayScrollArea scrollRef={scrollRef}>{null}</OverlayScrollArea>);

    await waitFor(() => {
      expect(scrollRef.current).toBe(screen.getByTestId('overlay-scroll-inner'));
    });
  });
});
