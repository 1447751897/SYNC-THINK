import { describe, expect, it } from 'vitest';
import type { Frame } from '@sync-think/protocol';
import {
  encodeAbort,
  encodeDispatchAck,
  encodeDispatchFrame,
  parseTaskFrame,
  type DispatchPayload,
} from '../src/daemon/protocol.js';

const TARGET_MODEL = { kind: 'model', modelId: 'm-1' } as const;

function dispatchPayload(overrides: Partial<DispatchPayload> = {}): DispatchPayload {
  return {
    taskId: 't_xxx',
    instruction: '执行巡检',
    target: TARGET_MODEL,
    skillVersionIds: ['s-1'],
    ...overrides,
  };
}

// ── encodeDispatchFrame：帧构造 ────────────────────────────────────────────

describe('encodeDispatchFrame', () => {
  it('produces a frame matching the spec contract', () => {
    const frame = encodeDispatchFrame(dispatchPayload());
    expect(frame.type).toBe('task.dispatch');
    expect(frame.kind).toBe('request');
    expect(frame.payload).toMatchObject({
      taskId: 't_xxx',
      instruction: '执行巡检',
      target: { kind: 'model', modelId: 'm-1' },
      skillVersionIds: ['s-1'],
    });
  });

  it('includes workspaceId when provided', () => {
    const frame = encodeDispatchFrame(dispatchPayload({ workspaceId: 'ws-1' }));
    expect((frame.payload as DispatchPayload).workspaceId).toBe('ws-1');
  });

  it('omits workspaceId when not provided', () => {
    const frame = encodeDispatchFrame(dispatchPayload());
    expect((frame.payload as DispatchPayload).workspaceId).toBeUndefined();
  });
});

// ── encodeDispatchAck / encodeAbort ────────────────────────────────────────

describe('ack/abort encoding', () => {
  it('encodes a dispatch ack with an optional rejection reason', () => {
    const frame = encodeDispatchAck('t_xxx', false, '会话忙');
    expect(frame.type).toBe('task.dispatch.ack');
    expect(frame.payload).toEqual({ taskId: 't_xxx', accepted: false, reason: '会话忙' });
  });

  it('encodes an abort with reason', () => {
    const frame = encodeAbort('t_xxx', 'app-closed');
    expect(frame.type).toBe('task.abort');
    expect(frame.payload).toEqual({ taskId: 't_xxx', reason: 'app-closed' });
  });
});

// ── parseTaskFrame：解析 + 白名单校验 ─────────────────────────────────────

describe('parseTaskFrame', () => {
  it('parses a valid dispatch frame', () => {
    const frame = encodeDispatchFrame(dispatchPayload());
    const parsed = parseTaskFrame(frame);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.frame.type).toBe('task.dispatch');
      expect(parsed.frame.payload.taskId).toBe('t_xxx');
    }
  });

  it('parses a valid ack frame', () => {
    const parsed = parseTaskFrame(encodeDispatchAck('t_xxx', false));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.frame.type).toBe('task.dispatch.ack');
  });

  it('parses a valid abort frame', () => {
    const parsed = parseTaskFrame(encodeAbort('t_xxx', 'app-closed'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.frame.type).toBe('task.abort');
      expect(parsed.frame.payload.reason).toBe('app-closed');
    }
  });

  it('rejects an unknown frame type', () => {
    const frame: Frame = { id: 'x', kind: 'request', type: 'task.unknown', payload: {} };
    const parsed = parseTaskFrame(frame);
    expect(parsed.ok).toBe(false);
  });

  it('rejects a dispatch missing required fields', () => {
    const frame: Frame = {
      id: 'x',
      kind: 'request',
      type: 'task.dispatch',
      payload: { taskId: 't_xxx' }, // 缺 instruction / target / skillVersionIds
    };
    const parsed = parseTaskFrame(frame);
    expect(parsed.ok).toBe(false);
  });

  it('rejects a dispatch with a malformed target', () => {
    const frame: Frame = {
      id: 'x',
      kind: 'request',
      type: 'task.dispatch',
      payload: { ...dispatchPayload(), target: { kind: 'unknown' } },
    };
    const parsed = parseTaskFrame(frame);
    expect(parsed.ok).toBe(false);
  });

  it('rejects a dispatch with non-array skillVersionIds', () => {
    const frame: Frame = {
      id: 'x',
      kind: 'request',
      type: 'task.dispatch',
      payload: { ...dispatchPayload(), skillVersionIds: 's-1' },
    };
    const parsed = parseTaskFrame(frame);
    expect(parsed.ok).toBe(false);
  });

  it('rejects an ack with non-boolean accepted', () => {
    const frame: Frame = {
      id: 'x',
      kind: 'request',
      type: 'task.dispatch.ack',
      payload: { taskId: 't_xxx', accepted: 'yes' },
    };
    const parsed = parseTaskFrame(frame);
    expect(parsed.ok).toBe(false);
  });

  it('rejects an ack with a non-string reason', () => {
    const frame: Frame = {
      id: 'x',
      kind: 'response',
      type: 'task.dispatch.ack',
      payload: { taskId: 't_xxx', accepted: false, reason: 42 },
    };
    expect(parseTaskFrame(frame).ok).toBe(false);
  });

  it('rejects an abort with empty reason', () => {
    const frame: Frame = {
      id: 'x',
      kind: 'request',
      type: 'task.abort',
      payload: { taskId: 't_xxx', reason: '' },
    };
    const parsed = parseTaskFrame(frame);
    expect(parsed.ok).toBe(false);
  });

  it('ignores unknown extra fields but keeps whitelisted ones (forward-compatible)', () => {
    const frame: Frame = {
      id: 'x',
      kind: 'request',
      type: 'task.dispatch',
      payload: { ...dispatchPayload(), extraField: 'future' },
    };
    const parsed = parseTaskFrame(frame);
    expect(parsed.ok).toBe(true);
  });
});
