import { ErrorCode, type AppError } from '@sync-think/shared';

// Length-prefixed JSON for request/response on the named pipe (TD-006 §3).
// Frames bigger than MAX_OUTPUT_BYTES must be transported as an artifact
// reference, not pushed through the pipe.

export const MAX_FRAME_BYTES = 1 * 1024 * 1024; // 1 MiB cap on wire frames

export const HEADER_BYTES = 4; // uint32 BE length

// Envelope carrying every message on the pipe.
export interface Frame<T = unknown> {
  /** Mirrors request id for requests; server messages use the matching id. */
  id: string;
  kind: 'request' | 'response' | 'event';
  type: string;
  payload: T;
  /** Present on responses/events when an error occurred processing the request. */
  error?: AppError;
}

// Encode: write 4-byte BE length followed by UTF-8 JSON of the Frame.
export function encodeFrame<T>(frame: Frame<T>): Buffer {
  const json = Buffer.from(JSON.stringify(frame), 'utf8');
  if (json.length > MAX_FRAME_BYTES) {
    // Caller must instead emit an artifactRef. No silent truncation.
    throw Object.assign(new Error('frame exceeds max'), {
      appError: { code: ErrorCode.PROTOCOL_FRAME_MALFORMED, message: 'frame too large', } satisfies AppError,
    });
  }
  const out = Buffer.allocUnsafe(HEADER_BYTES + json.length);
  out.writeUInt32BE(json.length, 0);
  json.copy(out, HEADER_BYTES);
  return out;
}

// Streaming decoder: feed accumulated bytes, returns parsed frames +
// unconsumed leftover. Caller must retain leftover between feeds.
export interface DecodeStatus {
  frames: Frame[];
  remaining: Buffer;
}

export function decodeFrames(input: Buffer): DecodeStatus {
  const frames: Frame[] = [];
  let buf = Buffer.from(input); // copy to avoid aliasing
  while (buf.length >= HEADER_BYTES) {
    const len = buf.readUInt32BE(0);
    if (len <= 0 || len > MAX_FRAME_BYTES) {
      throw Object.assign(new Error('invalid frame length'), {
        appError: { code: ErrorCode.PROTOCOL_FRAME_MALFORMED, message: 'invalid frame length' } satisfies AppError,
      });
    }
    if (buf.length < HEADER_BYTES + len) break;
    const json = buf.subarray(HEADER_BYTES, HEADER_BYTES + len);
    frames.push(JSON.parse(json.toString('utf8')));
    buf = buf.subarray(HEADER_BYTES + len);
  }
  return { frames, remaining: buf };
}
