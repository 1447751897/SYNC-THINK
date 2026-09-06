/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationNavigationGeometry } from './conversation-navigation-geometry.js';

let resizeCallback: ResizeObserverCallback;
const observedTargets = new Set<Element>();
const geometries: ConversationNavigationGeometry[] = [];

function fixture(initialHeight = 200) {
  const scroller = document.createElement('div');
  const content = document.createElement('div');
  scroller.append(content);
  document.body.append(scroller);
  const heights = [100, 100, 100, 100, 100, 100];
  Object.defineProperties(scroller, {
    clientWidth: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: initialHeight },
    scrollHeight: {
      configurable: true,
      get: () => heights.reduce((total, height) => total + height, 0) + 40,
    },
  });
  scroller.getBoundingClientRect = vi.fn(
    () => ({ top: 80, height: 200, width: scroller.clientWidth }) as DOMRect,
  );
  content.getBoundingClientRect = vi.fn(
    () =>
      ({
        top: 80 - scroller.scrollTop,
        height: heights.reduce((total, height) => total + height, 0),
      }) as DOMRect,
  );
  const nodes = heights.map((_, index) => {
    const node = document.createElement('div');
    node.dataset.messageId = `message-${index}`;
    node.getBoundingClientRect = vi.fn(
      () =>
        ({
          top:
            120 -
            scroller.scrollTop +
            heights.slice(0, index).reduce((total, height) => total + height, 0),
          height: heights[index]!,
          width: 800,
        }) as DOMRect,
    );
    content.append(node);
    return node;
  });
  const onMeasure = vi.fn();
  const geometry = new ConversationNavigationGeometry(scroller, onMeasure);
  geometries.push(geometry);
  geometry.setItems([
    { id: 'first', promptId: 'message-0' },
    { id: 'second', promptId: 'message-2' },
    { id: 'third', promptId: 'message-4' },
  ]);
  const readCount = () =>
    nodes.reduce(
      (total, node) => total + vi.mocked(node.getBoundingClientRect).mock.calls.length,
      0,
    );
  const resized = (...targets: HTMLDivElement[]) =>
    resizeCallback(
      targets.map(
        (target) =>
          ({
            target,
            borderBoxSize: [
              {
                blockSize:
                  target === content
                    ? heights.reduce((total, height) => total + height, 0)
                    : heights[nodes.indexOf(target)]!,
                inlineSize: 800,
              },
            ],
          }) as unknown as ResizeObserverEntry,
      ),
      {} as ResizeObserver,
    );
  return { scroller, content, nodes, heights, geometry, onMeasure, readCount, resized };
}

beforeEach(() => {
  observedTargets.clear();
  vi.useFakeTimers();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe(target: Element) {
        observedTargets.add(target);
      }
      disconnect() {
        observedTargets.clear();
      }
    },
  );
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) =>
    window.setTimeout(() => callback(performance.now()), 1),
  );
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) =>
    window.clearTimeout(handle),
  );
});

afterEach(() => {
  for (const geometry of geometries) geometry.dispose();
  geometries.length = 0;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ConversationNavigationGeometry', () => {
  it('observes a hidden pane and initializes its cache when it becomes visible', async () => {
    const current = fixture(0);
    expect(current.readCount()).toBe(0);
    expect(observedTargets.has(current.scroller)).toBe(true);
    Object.defineProperty(current.scroller, 'clientHeight', { value: 200 });
    resizeCallback(
      [
        {
          target: current.scroller,
          borderBoxSize: [{ blockSize: 200, inlineSize: 800 }],
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
    await vi.advanceTimersByTimeAsync(2);
    expect(current.readCount()).toBe(6);
    expect(current.onMeasure.mock.calls.at(-1)?.[0].activeId).toBe('first');
  });
  it('never remeasures message rectangles while scrolling a stable layout', async () => {
    const current = fixture();
    const initialReads = current.readCount();
    for (const scrollTop of [10, 210, 310, 440]) {
      current.scroller.scrollTop = scrollTop;
      current.scroller.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(2);
    }
    expect(current.readCount()).toBe(initialReads);
    expect(current.onMeasure).toHaveBeenLastCalledWith({
      height: 200,
      activeId: 'third',
      navigating: false,
    });
  });

  it('updates earlier row heights incrementally without remeasuring following messages', async () => {
    const current = fixture();
    const reads = current.readCount();
    current.scroller.scrollTop = 220;
    current.scroller.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(2);
    expect(current.onMeasure.mock.calls.at(-1)?.[0].activeId).toBe('second');
    current.heights[1] = 300;
    current.resized(current.nodes[1]!, current.content);
    await vi.advanceTimersByTimeAsync(2);
    expect(current.readCount()).toBe(reads);
    expect(current.onMeasure.mock.calls.at(-1)?.[0].activeId).toBe('first');
  });

  it('does not rebuild the index for text-only updates or duplicate layout keys', () => {
    const current = fixture();
    const reads = current.readCount();
    current.geometry.setItems([
      { id: 'first', promptId: 'message-0' },
      { id: 'second', promptId: 'message-2' },
      { id: 'third', promptId: 'message-4' },
    ]);
    expect(current.readCount()).toBe(reads);
    expect(current.geometry.findNode({ id: 'second', promptId: 'message-2' })).toBe(
      current.nodes[2],
    );
    expect(current.readCount()).toBe(reads);
  });

  it('measures only the changed row when border-box observer data is absent', async () => {
    const current = fixture();
    const reads = current.readCount();
    current.heights[1] = 180;
    resizeCallback(
      [{ target: current.nodes[1], borderBoxSize: [] } as unknown as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    await vi.advanceTimersByTimeAsync(2);
    expect(current.readCount()).toBe(reads + 1);
    await vi.advanceTimersByTimeAsync(10);
    expect(current.readCount()).toBe(reads + 1);
  });

  it('rebuilds for width changes and structural gaps rather than using stale positions', async () => {
    const current = fixture();
    const reads = current.readCount();
    Object.defineProperty(current.scroller, 'clientWidth', { value: 600 });
    current.resized(current.content);
    await vi.advanceTimersByTimeAsync(2);
    expect(current.readCount()).toBe(reads * 2);
    resizeCallback(
      [
        {
          target: current.content,
          borderBoxSize: [{ blockSize: 900, inlineSize: 600 }],
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
    await vi.advanceTimersByTimeAsync(2);
    expect(current.readCount()).toBe(reads * 3);
  });

  it('refreshes node identity after prepend and disconnects all work on disposal', async () => {
    const current = fixture();
    const prepended = document.createElement('div');
    prepended.dataset.messageId = 'older';
    prepended.getBoundingClientRect = () => ({ top: 80, height: 40 }) as DOMRect;
    current.content.prepend(prepended);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2);
    expect(current.geometry.findNode({ id: 'older' })).toBe(prepended);
    const reads = current.readCount();
    current.geometry.schedule();
    current.geometry.dispose();
    current.scroller.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(10);
    expect(current.readCount()).toBe(reads);
  });
});
