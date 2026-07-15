import { describe, it, expect } from 'vitest';
import { MAX_INLINE_ARTIFACT_CONTENT_BYTES } from '@sync-think/shared';
import { encodeFrame, decodeFrames, MAX_FRAME_BYTES, HEADER_BYTES, type Frame } from './framing.js';

describe('length-prefixed framing', () => {
  it('round-trips a request frame', () => {
    const f: Frame = { id: 'req-1', kind: 'request', type: 'task.appendMessage', payload: { text: 'hi' } };
    const buf = encodeFrame(f);
    expect(buf.readUInt32BE(0)).toBe(buf.length - HEADER_BYTES);
    const { frames, remaining } = decodeFrames(buf);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 'req-1', kind: 'request' });
    expect(remaining.length).toBe(0);
  });

  it('keeps leftover bytes between feeds (two frames split mid-stream)', () => {
    const f1: Frame = { id: 'a', kind: 'request', type: 'x', payload: { i: 1 } };
    const f2: Frame = { id: 'b', kind: 'event', type: 'evt', payload: { n: 2 } };
    const buf = Buffer.concat([encodeFrame(f1), encodeFrame(f2)]);

    // Choose split point strictly between the two frames: end-of-frame-1 exactly.
    const split = encodeFrame(f1).length;
    expect(split).toBeLessThan(buf.length);

    const first = decodeFrames(buf.subarray(0, split));
    expect(first.frames).toHaveLength(1);
    expect(first.remaining.length).toBe(0);

    // Feed the remainder; expect frame 2 to decode.
    const second = decodeFrames(buf.subarray(split));
    expect(second.frames).toHaveLength(1);
    expect(second.frames[0].id).toBe('b');
    expect(second.remaining.length).toBe(0);
  });

  it('handles partial header across feeds by retaining leftover', () => {
    const f1: Frame = { id: 'a', kind: 'request', type: 'x', payload: {} };
    const buf = encodeFrame(f1);
    // Feed only the first byte of the 4-byte length header.
    const first = decodeFrames(buf.subarray(0, 1));
    expect(first.frames).toHaveLength(0);
    expect(first.remaining.length).toBe(1);
    const second = decodeFrames(Buffer.concat([first.remaining, buf.subarray(1)]));
    expect(second.frames).toHaveLength(1);
    expect(second.remaining.length).toBe(0);
  });

  it('handles empty input', () => {
    const r = decodeFrames(Buffer.alloc(0));
    expect(r.frames).toHaveLength(0);
    expect(r.remaining.length).toBe(0);
  });

  it('rejects oversize frames hard', () => {
    const hugePayload = 'x'.repeat(MAX_FRAME_BYTES + 1);
    expect(() => encodeFrame({ id: 'big', kind: 'event', type: 't', payload: hugePayload })).toThrow();
  });

  it('encodes the worst-case escaped inline artifact comparison below the frame cap', () => {
    expect(MAX_INLINE_ARTIFACT_CONTENT_BYTES).toBe(48 * 1024);
    const escapedLeft = '\u0000'.repeat(MAX_INLINE_ARTIFACT_CONTENT_BYTES);
    const escapedRight = '\u0001'.repeat(MAX_INLINE_ARTIFACT_CONTENT_BYTES);
    const frame = encodeFrame({
      id: 'artifact-compare-boundary',
      kind: 'response',
      type: 'artifact.compare',
      payload: {
        artifactId: 'artifact-boundary',
        leftVersionId: 'version-left',
        rightVersionId: 'version-right',
        comparison: {
          kind: 'text',
          equal: false,
          hunks: [
            {
              leftStartLine: 1,
              rightStartLine: 1,
              removedLines: [escapedLeft],
              addedLines: [escapedRight],
            },
          ],
        },
      },
    });

    expect(frame.length - HEADER_BYTES).toBeLessThanOrEqual(MAX_FRAME_BYTES);
  });
});
