import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunProcessView } from '@sync-think/protocol';
import {
  RunProcessHistoryLoader,
  RunProcessHistoryRequestPool,
  type RunProcessLoadFailure,
} from './run-process-history-loader.js';

function processView(runId: string): RunProcessView {
  return {
    runId: runId as RunProcessView['runId'],
    steps: [],
    fileChanges: [],
    running: false,
    doneCount: 0,
    errorCount: 0,
  };
}

function deferred() {
  let resolve!: (value: RunProcessView) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RunProcessView>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function fixture(load = vi.fn<(runId: string) => Promise<RunProcessView | null>>()) {
  const onLoad = vi.fn();
  const onFailure =
    vi.fn<(context: string, runId: string, failure?: RunProcessLoadFailure) => void>();
  const loader = new RunProcessHistoryLoader({ load, onLoad, onFailure });
  return { loader, load, onLoad, onFailure };
}

const requests = (...runIds: string[]) => runIds.map((runId, priority) => ({ runId, priority }));
const flush = async () => {
  for (let iteration = 0; iteration < 6; iteration += 1) await Promise.resolve();
};

afterEach(() => vi.useRealTimers());

describe('RunProcessHistoryLoader', () => {
  it('shares physical slots across keyed component replacements and concurrent panes', async () => {
    const pool = new RunProcessHistoryRequestPool();
    const pending = new Map(
      ['old-1', 'old-2', 'old-3', 'new-1', 'pane-1'].map((runId) => [runId, deferred()]),
    );
    const load = vi.fn((runId: string) => pending.get(runId)!.promise);
    const onLoad = vi.fn();
    const options = { load, onLoad, onFailure: vi.fn() };
    const oldLoader = new RunProcessHistoryLoader(options, pool);
    oldLoader.setRequests('old', requests('old-1', 'old-2', 'old-3'));
    oldLoader.suspend();
    const nextLoader = new RunProcessHistoryLoader(options, pool);
    const paneLoader = new RunProcessHistoryLoader(options, pool);
    nextLoader.setRequests('new', requests('new-1'));
    paneLoader.setRequests('pane', requests('pane-1'));
    expect(load).toHaveBeenCalledTimes(3);
    pending.get('old-1')!.resolve(processView('old-1'));
    await flush();
    expect(load).toHaveBeenCalledTimes(4);
    expect(onLoad).not.toHaveBeenCalled();
    nextLoader.suspend();
    pending.get('old-2')!.resolve(processView('old-2'));
    await flush();
    expect(load.mock.calls.at(-1)).toEqual(['pane-1']);
    paneLoader.suspend();
  });
  it('caps physical requests at three and reprioritizes the waiting queue', async () => {
    const pending = new Map(Array.from({ length: 8 }, (_, index) => [`run-${index}`, deferred()]));
    const { loader, load } = fixture(vi.fn((runId) => pending.get(runId)!.promise));
    const runIds = [...pending.keys()];
    loader.setRequests('chat', requests(...runIds));
    expect(load.mock.calls.map(([runId]) => runId)).toEqual(runIds.slice(0, 3));
    loader.setRequests('chat', requests('run-7', ...runIds));
    expect(load).toHaveBeenCalledTimes(3);
    pending.get('run-0')!.resolve(processView('run-0'));
    await flush();
    expect(load.mock.calls.at(-1)).toEqual(['run-7']);
    expect(load).toHaveBeenCalledTimes(4);
    loader.suspend();
  });

  it('keeps old physical slots occupied across conversation changes and ignores old responses', async () => {
    const pending = [deferred(), deferred(), deferred(), deferred()];
    const { loader, load, onLoad } = fixture(
      vi
        .fn()
        .mockImplementationOnce(() => pending[0]!.promise)
        .mockImplementationOnce(() => pending[1]!.promise)
        .mockImplementationOnce(() => pending[2]!.promise)
        .mockImplementationOnce(() => pending[3]!.promise),
    );
    loader.setRequests('old-chat', requests('old-1', 'old-2', 'old-3'));
    loader.setRequests('new-chat', requests('new-1'));
    expect(load).toHaveBeenCalledTimes(3);
    pending[0]!.resolve(processView('old-1'));
    await flush();
    expect(onLoad).not.toHaveBeenCalled();
    expect(load.mock.calls.at(-1)).toEqual(['new-1']);
    pending[3]!.resolve(processView('new-1'));
    await flush();
    expect(onLoad).toHaveBeenCalledWith('new-chat', processView('new-1'));
    loader.suspend();
  });

  it('does not free a request slot or replace a live snapshot when it is fulfilled by streaming', async () => {
    const pending = new Map(['one', 'two', 'three', 'four'].map((runId) => [runId, deferred()]));
    const { loader, load, onLoad } = fixture(vi.fn((runId) => pending.get(runId)!.promise));
    loader.setRequests('chat', requests(...pending.keys()));
    loader.accept('one');
    loader.setRequests('chat', requests(...pending.keys()), new Set(['one']));
    expect(load).toHaveBeenCalledTimes(3);
    pending.get('one')!.resolve(processView('one'));
    await flush();
    expect(onLoad).not.toHaveBeenCalled();
    expect(load.mock.calls.at(-1)).toEqual(['four']);
    loader.suspend();
  });

  it('invalidates a pre-terminal response without issuing a duplicate in-flight request', async () => {
    const first = deferred();
    const second = deferred();
    const { loader, load, onLoad } = fixture(
      vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    );
    loader.setRequests('chat', requests('one'));
    loader.invalidate('one');
    loader.setRequests('chat', requests('one'));
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve(processView('one'));
    await flush();
    expect(onLoad).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(2);
    second.resolve(processView('one'));
    await flush();
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('retries a connection failure at 500 and 1000 ms, then stops after three attempts', async () => {
    vi.useFakeTimers();
    const { loader, load, onFailure } = fixture(
      vi.fn().mockRejectedValue(new Error('Runtime request timed out: conversation.getRunProcess')),
    );
    loader.setRequests('chat', requests('one'));
    await flush();
    expect(onFailure).toHaveBeenLastCalledWith('chat', 'one', {
      kind: 'connection',
      attempts: 1,
      retrying: true,
    });
    loader.setRequests('chat', requests('one'));
    await vi.advanceTimersByTimeAsync(499);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(2);
    loader.setRequests('chat', requests('one'));
    await vi.advanceTimersByTimeAsync(999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    loader.setRequests('chat', requests('one'));
    expect(load).toHaveBeenCalledTimes(3);
    expect(onFailure).toHaveBeenLastCalledWith('chat', 'one', {
      kind: 'connection',
      attempts: 3,
      retrying: false,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['History worker queue is full', 'busy', true],
    ['SQLITE_BUSY: database is locked', 'busy', true],
    ['Runtime is not connected', 'connection', true],
    ['Runtime connection closed', 'connection', true],
    ['Runtime connection unavailable', 'connection', true],
    ['history.timeout', 'connection', true],
    ['history.worker-exit:1', 'connection', true],
    ['history.closed', 'connection', true],
    ['history.unexpected-result', 'invalid', false],
    ['Unexpected frame size exceeds maximum', 'unavailable', false],
    ['Run not found', 'unavailable', false],
    ['Malformed response', 'invalid', false],
    ['unclassified backend failure', 'unknown', false],
  ] as const)('classifies %s without unlimited retries', async (message, kind, retrying) => {
    vi.useFakeTimers();
    const { loader, onFailure } = fixture(vi.fn().mockRejectedValue(new Error(message)));
    loader.setRequests('chat', requests('one'));
    await flush();
    expect(onFailure).toHaveBeenLastCalledWith('chat', 'one', { kind, attempts: 1, retrying });
    loader.suspend();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows manual recovery without duplicate starts and clears the visible failure', async () => {
    const next = deferred();
    const { loader, load, onFailure, onLoad } = fixture(
      vi.fn().mockRejectedValueOnce(new Error('unknown')).mockReturnValue(next.promise),
    );
    loader.setRequests('chat', requests('one'));
    await flush();
    loader.retry('one');
    loader.retry('one');
    expect(load).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenLastCalledWith('chat', 'one', undefined);
    next.resolve(processView('one'));
    await flush();
    expect(onLoad).toHaveBeenCalledWith('chat', processView('one'));
  });

  it('clears timers on removal or suspension without forgetting the physical request limit', async () => {
    vi.useFakeTimers();
    const { loader, load, onFailure } = fixture(
      vi.fn().mockRejectedValue(new Error('Runtime disconnected')),
    );
    loader.setRequests('chat', requests('one', 'two'));
    await flush();
    expect(vi.getTimerCount()).toBe(2);
    loader.setRequests('chat', requests('two'));
    expect(vi.getTimerCount()).toBe(1);
    expect(onFailure).toHaveBeenCalledWith('chat', 'one', undefined);
    loader.suspend();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    loader.setRequests('new-chat', requests('one'));
    expect(load).toHaveBeenCalledTimes(3);
    loader.suspend();
  });

  it.each([null, processView('wrong-run')])(
    'shows an invalid response instead of retrying on every render',
    async (response) => {
      const { loader, load, onLoad, onFailure } = fixture(vi.fn().mockResolvedValue(response));
      loader.setRequests('chat', requests('one'));
      await flush();
      loader.setRequests('chat', requests('one'));
      expect(load).toHaveBeenCalledTimes(1);
      expect(onLoad).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenLastCalledWith('chat', 'one', {
        kind: 'invalid',
        attempts: 1,
        retrying: false,
      });
    },
  );
});
