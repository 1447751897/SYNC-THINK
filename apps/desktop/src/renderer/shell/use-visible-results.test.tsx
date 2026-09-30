/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useVisibleResults } from './use-visible-results.js';
function View({
  active = true,
  ready = true,
  runIds = ['run-1'],
  viewed,
}: {
  active?: boolean;
  ready?: boolean;
  runIds?: string[];
  viewed: (ids: readonly string[]) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useVisibleResults({ viewport, active, ready, runIds, onViewed: viewed });
  return (
    <div ref={viewport}>
      <div>结果</div>
    </div>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('acknowledges loaded results in the active foreground view, not unseen future runs', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const viewed = vi.fn();
  const result = render(<View viewed={viewed} ready={false} />);
  expect(viewed).not.toHaveBeenCalled();
  result.rerender(<View viewed={viewed} />);
  expect(viewed).toHaveBeenLastCalledWith(['run-1']);
  result.rerender(<View viewed={viewed} runIds={['run-1', 'run-2']} />);
  expect(viewed).toHaveBeenLastCalledWith(['run-1', 'run-2']);
});
it('waits for focus and visible document, and ignores background conversations', () => {
  const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const viewed = vi.fn();
  const result = render(<View viewed={viewed} />);
  expect(viewed).not.toHaveBeenCalled();
  focused.mockReturnValue(true);
  visibility.mockReturnValue('hidden');
  act(() => window.dispatchEvent(new Event('focus')));
  expect(viewed).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(viewed).toHaveBeenCalledTimes(1);
  result.rerender(<View viewed={viewed} active={false} />);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(viewed).toHaveBeenCalledTimes(1);
});
it('does not acknowledge while reading old messages away from the latest result', () => {
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const viewed = vi.fn();
  const { container } = render(<View viewed={viewed} />);
  viewed.mockClear();
  const viewport = container.firstElementChild!;
  Object.defineProperties(viewport, {
    scrollHeight: { value: 1200 },
    clientHeight: { value: 300 },
    scrollTop: { value: 0, writable: true },
  });
  act(() => viewport.dispatchEvent(new Event('scroll')));
  expect(viewed).not.toHaveBeenCalled();
  viewport.scrollTop = 900;
  act(() => viewport.dispatchEvent(new Event('scroll')));
  expect(viewed).toHaveBeenCalledWith(['run-1']);
});
