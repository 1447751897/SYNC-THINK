import { describe, it, expect } from 'vitest';
import { SseLineReader, parseSseJson } from './sse-lines.js';
import { encodeSseFrame } from './wire-types.js';

describe('SseLineReader', () => {
  it('parses event/data pairs split across arbitrary chunk boundaries', () => {
    const reader = new SseLineReader();
    const out = [
      ...reader.push('event: message_st'),
      ...reader.push('art\ndata: {"a":'),
      ...reader.push('1}\n\n'),
    ];
    expect(out).toEqual([{ event: 'message_start', data: '{"a":1}' }]);
  });

  it('parses bare data lines and preserves [DONE]', () => {
    const reader = new SseLineReader();
    const out = reader.push('data: {"x":1}\n\ndata: [DONE]\n\n');
    expect(out).toEqual([{ data: '{"x":1}' }, { data: '[DONE]' }]);
  });

  it('joins multi-line data fields with newlines', () => {
    const reader = new SseLineReader();
    expect(reader.push('data: line1\ndata: line2\n\n')).toEqual([{ data: 'line1\nline2' }]);
  });

  it('ignores comments, heartbeats and id/retry fields', () => {
    const reader = new SseLineReader();
    expect(reader.push(': keep-alive\nid: 7\nretry: 100\ndata: {"ok":1}\n\n')).toEqual([
      { data: '{"ok":1}' },
    ]);
  });

  it('tolerates CRLF line endings', () => {
    const reader = new SseLineReader();
    expect(reader.push('event: ping\r\ndata: {}\r\n\r\n')).toEqual([
      { event: 'ping', data: '{}' },
    ]);
  });

  it('flushes a trailing message the upstream never terminated', () => {
    const reader = new SseLineReader();
    expect(reader.push('data: {"tail":1}')).toEqual([]);
    expect(reader.flush()).toEqual([{ data: '{"tail":1}' }]);
  });

  it('returns nothing on flush when the buffer is clean', () => {
    const reader = new SseLineReader();
    reader.push('data: {"a":1}\n\n');
    expect(reader.flush()).toEqual([]);
  });
});

describe('parseSseJson', () => {
  it('parses objects and rejects [DONE] / malformed payloads', () => {
    expect(parseSseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseSseJson('[DONE]')).toBeUndefined();
    expect(parseSseJson('not json')).toBeUndefined();
    expect(parseSseJson('   ')).toBeUndefined();
  });
});

describe('encodeSseFrame', () => {
  it('emits an event line only when the dialect needs one', () => {
    expect(encodeSseFrame({ event: 'message_stop', data: '{}' })).toBe(
      'event: message_stop\ndata: {}\n\n',
    );
    expect(encodeSseFrame({ data: '[DONE]' })).toBe('data: [DONE]\n\n');
  });
});
