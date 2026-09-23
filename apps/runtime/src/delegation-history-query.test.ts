import { describe, expect, it, vi } from 'vitest';
import type { DelegatedRunRecord } from '@sync-think/shared';
import { DelegationHistoryQuery } from './delegation-history-query.js';

function record(id: string): DelegatedRunRecord {
  return {
    childRunId: id, parentRunId: 'parent', threadId: 'thread', agentId: 'reviewer',
    name: 'Reviewer', status: 'completed', toolCount: 1, sequence: 1, updatedAt: 'now',
  };
}
function fixture(stored: DelegatedRunRecord[], legacy: DelegatedRunRecord[] = []) {
  const ports = {
    listLegacy: vi.fn((thread: string) => legacy.filter((item) => item.threadId === thread)),
    listStored: vi.fn((thread: string) => stored.filter((item) => item.threadId === thread)),
    getLegacy: vi.fn((thread: string, id: string) =>
      legacy.find((item) => item.threadId === thread && item.childRunId === id)),
    getStored: vi.fn((id: string) => stored.find((item) => item.childRunId === id)),
    reconcile: vi.fn((item: DelegatedRunRecord) => item),
  };
  return { ports, query: new DelegationHistoryQuery(ports) };
}

describe('DelegationHistoryQuery', () => {
  it('prefers canonical state and reconciles only running records', () => {
    const f = fixture([
      { ...record('A'), status: 'cancelled' }, { ...record('B'), status: 'running' },
    ], [{ ...record('A'), status: 'running', sequence: 0 }, record('C')]);
    f.ports.reconcile.mockImplementation((item) => ({ ...item, status: 'failed' }));
    expect(f.query.listByThread('thread').map(({ childRunId, status }) => ({ childRunId, status })))
      .toEqual([
        { childRunId: 'A', status: 'cancelled' }, { childRunId: 'B', status: 'failed' },
        { childRunId: 'C', status: 'completed' },
      ]);
    expect(f.ports.reconcile.mock.calls.map(([item]) => item.childRunId)).toEqual(['B']);
  });

  it('pages 50 tasks in stable timestamp/ID order without returning reports in the list', () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      ...record(String(i).padStart(2, '0')), result: i === 50 ? 'Report' : '  ',
    })).reverse();
    const f = fixture(items);
    const first = f.query.query('thread', {});
    expect(first).toMatchObject({ ok: true, total: 51, nextOffset: 50 });
    expect(first.tasks).toHaveLength(50);
    expect((first.tasks as DelegatedRunRecord[])[0]).toMatchObject({ childRunId: '00', hasResult: false });
    expect((first.tasks as DelegatedRunRecord[])[0]).not.toHaveProperty('result');
    const last = f.query.query('thread', { offset: 50 });
    expect(last).toMatchObject({ tasks: [{ childRunId: '50', hasResult: true }] });
    expect(last).not.toHaveProperty('nextOffset');
    expect(f.query.query('thread', { offset: 100 })).toMatchObject({ tasks: [] });
  });

  it('orders different timestamps before using child IDs to break ties', () => {
    const f = fixture([record('A'), { ...record('Z'), updatedAt: 'before' }]);
    expect(f.query.listByThread('thread').map((item) => item.childRunId)).toEqual(['Z', 'A']);
  });

  it.each([-1, 1.5, '50', Number.MAX_SAFE_INTEGER + 1])('defaults invalid offset %s to zero', (offset) => {
    const f = fixture([{ ...record('A'), result: 'Report' }]);
    expect(f.query.query('thread', { offset })).toMatchObject({ tasks: [{ childRunId: 'A' }] });
    expect(f.query.query('thread', { childRunId: 'A', offset })).toMatchObject({ result: 'Report' });
  });

  it('pages reports in 8000-character chunks and scopes lookup to the requested thread', () => {
    const f = fixture([{ ...record('A'), result: 'x'.repeat(8_000) + 'tail' }]);
    expect(f.query.query('thread', { childRunId: 'A' }))
      .toMatchObject({ result: 'x'.repeat(8_000), resultCharacters: 8_004, nextOffset: 8_000 });
    const end = f.query.query('thread', { childRunId: 'A', offset: 8_000 });
    expect(end).toMatchObject({ result: 'tail', resultCharacters: 8_004 });
    expect(end).not.toHaveProperty('nextOffset');
    expect(f.query.query('other', { childRunId: 'A' }))
      .toEqual({ ok: false, error: 'Delegated task not found in this conversation.' });
    expect(f.ports.getStored).toHaveBeenLastCalledWith('A');
    expect(f.ports.getLegacy).not.toHaveBeenCalled();
    expect(f.ports.listLegacy).not.toHaveBeenCalled();
    expect(f.ports.listStored).not.toHaveBeenCalled();
  });

  it('uses exact legacy lookup only when canonical state is absent', () => {
    const f = fixture([], [{ ...record('A'), result: 'Legacy report' }]);
    expect(f.query.query('thread', { childRunId: 'A' })).toMatchObject({
      result: 'Legacy report',
    });
    expect(f.ports.getStored).toHaveBeenCalledWith('A');
    expect(f.ports.getLegacy).toHaveBeenCalledWith('thread', 'A');
    expect(f.ports.listLegacy).not.toHaveBeenCalled();
    expect(f.ports.listStored).not.toHaveBeenCalled();
  });

  it('propagates a failed repair so retry can produce a current result', () => {
    const f = fixture([{ ...record('A'), status: 'running' }]);
    f.ports.reconcile.mockImplementationOnce(() => { throw new Error('repair failed'); });
    expect(() => f.query.query('thread', {})).toThrow('repair failed');
    f.ports.reconcile.mockImplementationOnce((item) => ({ ...item, status: 'cancelled' }));
    expect(f.query.query('thread', {})).toMatchObject({ tasks: [{ status: 'cancelled' }] });
  });
});
