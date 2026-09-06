/** @vitest-environment jsdom */
import { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunProcessHistoryLoader } from './run-process-history-loader.js';
import { useRunProcessHistoryRequests } from './use-run-process-history.js';

let observerCallback: IntersectionObserverCallback;
const load = vi.fn();
const loader = new RunProcessHistoryLoader({ load, onLoad: vi.fn(), onFailure: vi.fn() });
let renders = 0;

function Harness({ conversationId = 'chat' }: { conversationId?: string }) {
  renders += 1;
  const scrollerRef = useRef<HTMLDivElement>(null);
  useRunProcessHistoryRequests({
    loader,
    conversationId,
    enabled: true,
    scrollerRef,
    durableRunIds: ['one', 'two', 'three', 'four'],
    activeRunIds: [],
    available: new Map(),
  });
  return (
    <div ref={scrollerRef}>
      {['one', 'two', 'three', 'four'].map((runId) => (
        <div key={runId} data-process-run-id={runId}>
          {runId}
        </div>
      ))}
    </div>
  );
}

beforeEach(() => {
  renders = 0;
  load.mockReset().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  loader.suspend();
  vi.unstubAllGlobals();
});

describe('historical process viewport scheduling', () => {
  it('reprioritizes visibility without rerendering the message list owner', () => {
    const result = render(<Harness />);
    const before = renders;
    const target = result.container.querySelector('[data-process-run-id="one"]')!;
    act(() =>
      observerCallback(
        [{ target, isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    expect(renders).toBe(before);
  });
});
