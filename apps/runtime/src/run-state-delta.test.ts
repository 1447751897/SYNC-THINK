import { describe, expect, it } from 'vitest';
import {
  applyRunStateDelta,
  createRunStateDelta,
  diffRunStateSnapshots,
  prepareRunState,
} from './run-state-delta.js';

describe('lossless incremental run state', () => {
  it('owns prepared snapshots and keeps emitted operation values separate from the next baseline', () => {
    const original = { text: 'stable', items: [] as Array<{ id: string; value: number }> };
    const previous = prepareRunState(original);
    original.items.push({ id: 'outside', value: 3 });
    const next = prepareRunState({ text: 'stable', items: [{ id: 'inside', value: 4 }] });
    const delta = diffRunStateSnapshots(previous, next);
    expect(applyRunStateDelta(previous.value, delta)).toEqual(next.value);
    const inserted = delta.operations.find((operation) => operation.type === 'splice');
    if (!inserted || inserted.type !== 'splice') throw new Error('Missing fixture splice');
    (inserted.values[0] as { value: number }).value = 99;
    expect(next.value.items).toEqual([{ id: 'inside', value: 4 }]);
    expect(previous.value.items).toEqual([]);
  });

  it('round-trips scalar changes, removals, nested objects and appended Unicode text', () => {
    const previous = {
      id: 'run-1',
      model: 'a',
      obsolete: true,
      text: '状态🙂'.repeat(10000),
      metadata: { count: 1, value: null },
      items: ['a'],
    };
    const next = {
      id: 'run-1',
      model: 'b',
      text: previous.text + '继续\n完整内容',
      metadata: { count: 2, value: false },
      items: ['a', 'b'],
    };
    const delta = createRunStateDelta(previous, next);
    expect(applyRunStateDelta(previous, delta)).toEqual(next);
    expect(JSON.stringify(delta).length).toBeLessThan(1500);
    expect(previous.metadata.count).toBe(1);
    expect(previous.items).toEqual(['a']);
  });

  it('does not rewrite unchanged large tool bodies when bounded timelines drop earlier rows', () => {
    const timeline = Array.from({ length: 300 }, (_, sequence) => ({
      id: `segment-${sequence}`,
      sequence,
      output: `output-${sequence}:` + 'x'.repeat(3000),
      status: 'completed',
    }));
    const previous = { timeline };
    const next = {
      timeline: [
        ...timeline.slice(1, 150),
        ...timeline.slice(151),
        { id: 'segment-300', sequence: 300, output: 'new result', status: 'completed' },
      ],
    };
    const delta = createRunStateDelta(previous, next);
    expect(applyRunStateDelta(previous, delta)).toEqual(next);
    expect(JSON.stringify(delta)).not.toContain('output-200:');
    expect(JSON.stringify(delta).length).toBeLessThan(1500);
  });

  it('appends to a long native tool history without repeating unchanged results', () => {
    const previous = {
      events: Array.from({ length: 20000 }, (_, sequence) => ({
        kind: 'tool-result',
        toolId: `tool-${sequence}`,
        sequence,
        result: `unchanged-${sequence}`,
      })),
    };
    const next = {
      events: [
        ...previous.events,
        { kind: 'tool-result', toolId: 'tool-20000', sequence: 20000, result: 'new result' },
      ],
    };
    const delta = createRunStateDelta(previous, next);
    expect(applyRunStateDelta(previous, delta)).toEqual(next);
    expect(JSON.stringify(delta).length).toBeLessThan(500);
  });

  it('updates a streaming tail and a completed tool without copying their neighbors', () => {
    const previous = {
      timeline: [
        { id: 'first', text: 'stable'.repeat(10000) },
        { id: 'tail', text: 'growing'.repeat(10000), status: 'streaming' },
      ],
    };
    const next = {
      timeline: [
        previous.timeline[0],
        { ...previous.timeline[1], text: previous.timeline[1].text + '追加', status: 'completed' },
        { id: 'tool', name: 'read_file', result: 'full result' },
      ],
    };
    const delta = createRunStateDelta(previous, next);
    expect(applyRunStateDelta(previous, delta)).toEqual(next);
    expect(JSON.stringify(delta).length).toBeLessThan(1200);
  });

  it('handles reordered keyed rows and ordinary arrays without mutating either source', () => {
    const previous = {
      keyed: [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ],
      simple: [1, 2, 3],
    };
    const next = {
      keyed: [
        { id: 'b', value: 3 },
        { id: 'a', value: 1 },
      ],
      simple: [4, 5],
    };
    const before = JSON.stringify(previous);
    expect(applyRunStateDelta(previous, createRunStateDelta(previous, next))).toEqual(next);
    expect(JSON.stringify(previous)).toBe(before);
  });

  it('rejects the wrong baseline, unsupported version and corrupted result', () => {
    const previous = { text: 'a'.repeat(1000) };
    const next = { text: previous.text + 'b' };
    const delta = createRunStateDelta(previous, next);
    expect(() => applyRunStateDelta({ text: 'different' }, delta)).toThrow(
      'run-state.base-mismatch',
    );
    expect(() => applyRunStateDelta(previous, { ...delta, version: 999 })).toThrow(
      'run-state.invalid-delta',
    );
    expect(() => applyRunStateDelta(previous, { ...delta, resultHash: '0'.repeat(64) })).toThrow(
      'run-state.result-mismatch',
    );
  });

  it('rejects out-of-range paths and inherited-property traversal, while preserving JSON object keys', () => {
    const previous = JSON.parse('{"own":{"__proto__":{"value":1}},"items":[]}');
    const next = JSON.parse('{"own":{"__proto__":{"value":2}},"items":[null]}');
    const delta = createRunStateDelta(previous, next);
    expect(applyRunStateDelta(previous, delta)).toEqual(next);
    expect(() =>
      applyRunStateDelta(previous, {
        ...delta,
        operations: [{ type: 'set', path: ['__proto__', 'polluted'], value: true }],
      }),
    ).toThrow('run-state.invalid-path');
    expect(() =>
      applyRunStateDelta(previous, {
        ...delta,
        operations: [{ type: 'splice', path: ['items'], index: 4, deleteCount: 0, values: [] }],
      }),
    ).toThrow('run-state.invalid-operation');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('uses canonical object order for integrity hashes', () => {
    const delta = createRunStateDelta({ text: 'same', value: 1 }, { text: 'changed', value: 1 });
    expect(applyRunStateDelta({ value: 1, text: 'same' }, delta)).toEqual({
      value: 1,
      text: 'changed',
    });
  });
});
