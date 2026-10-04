/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WebSearch, WebSearchToolTrail } from './WebSearch.js';
import { deferredContentReader } from './deferred-content-reader.js';
vi.mock('./deferred-content-reader.js', () => ({ deferredContentReader: { read: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const sources = Array.from({ length: 8 }, (_, i) => ({
  title: 'Page ' + i,
  domain: 'example.test',
  href: 'https://example.test/' + i,
}));
describe('event controlled web research trail', () => {
  it('opens all real sources, supports keyboard focus and overflow count', () => {
    const open = vi.fn();
    render(
      <WebSearch
        heading="Ran 3 searches"
        steps={[{ id: 'a', label: 'Searching', sources }]}
        onOpenUrl={open}
      />,
    );
    const toggle = screen.getByRole('button', { name: /Sources/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('link')).toHaveLength(8);
    fireEvent.click(screen.getByRole('link', { name: /Page 0/ }));
    expect(open).toHaveBeenCalledWith('https://example.test/0');
    fireEvent.click(toggle);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
  it('keeps a working tail until actual completion and does not start demo timers', () => {
    const view = render(
      <WebSearch
        steps={[{ id: 'a', label: 'Searching', status: 'running' }]}
        working="Searching the web"
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Searching the web');
    view.rerender(<WebSearch steps={[{ id: 'a', label: 'Searched', status: 'completed' }]} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('retains failure and inspectable raw arguments/output without fabricated results', () => {
    render(
      <WebSearchToolTrail
        items={[
          {
            kind: 'tool',
            name: 'web_search',
            toolCallId: 't',
            argumentsJson: '{"query":"test"}',
            result: '{"ok":false,"error":"offline"}',
            status: 'failed',
          },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /次网页检索/ }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /次网页检索/ }));
    expect(screen.getByRole('status').textContent).toBe('offline');
    expect(screen.queryByRole('button', { name: /来源/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看执行详情' }));
    expect(screen.getByText('{"query":"test"}')).toBeTruthy();
  });
});

const deferred = {
  reference: { source: 'event' as const, id: 'event-a', path: ['result'] },
  utf8Bytes: 300,
  utf16Length: 300,
  format: 'json' as const,
};
const chunk = (text: string, nextOffset?: number) => ({
  content: {
    text,
    offset: 0,
    utf16Length: 300,
    utf8Bytes: 300,
    version: 'a'.repeat(64),
    format: 'json' as const,
    ...(nextOffset === undefined ? {} : { nextOffset }),
  },
});
describe('canonical source result loading', () => {
  it('loads real deferred JSON sources and drops sources when the reference changes', async () => {
    vi.mocked(deferredContentReader.read)
      .mockResolvedValueOnce(
        chunk(JSON.stringify({ results: [{ title: 'old source', url: 'https://old.test' }] })),
      )
      .mockRejectedValueOnce(new Error('offline'));
    const item = {
      kind: 'tool' as const,
      name: 'web_search',
      toolCallId: 'one',
      argumentsJson: '{}',
      result: 'preview',
      status: 'completed' as const,
      resultRef: deferred,
    };
    const view = render(<WebSearchToolTrail conversationId="a" items={[item]} />);
    fireEvent.click(screen.getByRole('button', { name: /次网页检索/ }));
    await screen.findByRole('button', { name: '来源' });
    fireEvent.click(screen.getByRole('button', { name: '来源' }));
    expect(screen.getByRole('link', { name: /old source/ })).toBeTruthy();
    view.rerender(
      <WebSearchToolTrail
        conversationId="a"
        items={[
          {
            ...item,
            resultRef: { ...deferred, reference: { ...deferred.reference, id: 'event-b' } },
          },
        ]}
      />,
    );
    expect(screen.queryByRole('link', { name: /old source/ })).toBeNull();
    await waitFor(() => expect(deferredContentReader.read).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('0 results')).toBeNull();
  });
  it('aborts old-scope reads and bounds discovery to four chunks', async () => {
    let finish!: (r: ReturnType<typeof chunk>) => void;
    vi.mocked(deferredContentReader.read)
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            finish = r;
          }),
      )
      .mockResolvedValue(chunk('incomplete JSON', 20));
    const item = {
      kind: 'tool' as const,
      name: 'web_search',
      toolCallId: 'one',
      argumentsJson: '{}',
      status: 'completed' as const,
      resultRef: deferred,
    };
    const view = render(<WebSearchToolTrail conversationId="a" items={[item]} />);
    await waitFor(() => expect(deferredContentReader.read).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(deferredContentReader.read).mock.calls[0][1]!;
    view.rerender(<WebSearchToolTrail conversationId="b" items={[item]} />);
    expect(signal.aborted).toBe(true);
    await act(async () => finish(chunk('{"results":[{"url":"https://private.test"}]}')));
    await waitFor(() => expect(deferredContentReader.read).toHaveBeenCalledTimes(5));
    expect(screen.queryByRole('button', { name: '来源' })).toBeNull();
  });
});

it('reads a deferred result when a running event becomes completed', async () => {
  vi.mocked(deferredContentReader.read).mockResolvedValueOnce(
    chunk('{"results":[{"title":"completed source","url":"https://complete.test"}]}'),
  );
  const item = {
    kind: 'tool' as const,
    name: 'WebSearch',
    toolCallId: 'transition',
    argumentsJson: '{}',
    resultRef: deferred,
  };
  const view = render(
    <WebSearchToolTrail conversationId="a" items={[{ ...item, status: 'running' }]} />,
  );
  expect(deferredContentReader.read).not.toHaveBeenCalled();
  view.rerender(
    <WebSearchToolTrail conversationId="a" items={[{ ...item, status: 'completed' }]} />,
  );
  expect(screen.getByRole('button', { name: /次网页检索/ }).getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: /次网页检索/ }));
  await screen.findByRole('button', { name: '来源' });
  expect(screen.queryByRole('status')).toBeNull();
});
