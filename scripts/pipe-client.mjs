// Quick pipe client probe for dev:runtime:pipe-test. Connects, sends Hello,
// echoes the response. Useful for smoke-testing the runtime process.
import { connect } from 'node:net';
import {
  PROTOCOL_VERSION,
  decodeFrames,
  encodeFrame,
  pipePathPortable,
} from '@sync-think/protocol';

const installId = process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001';
const allowNoToken = process.env.SYNC_THINK_DEV_NO_TOKEN ?? '1';
const expectedTaskVersion = Number.parseInt(
  process.env.SYNC_THINK_EXPECTED_TASK_VERSION ?? '0',
  10,
);

const sock = connect(pipePathPortable(installId), () => {
  sock.write(
    encodeFrame({
      id: 'probe',
      kind: 'request',
      type: '__hello',
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        appVersion: '0.0.1',
        installId,
        nonce: Math.random().toString(36).slice(2),
        features: [
          'task.appendMessage',
          'runtime.subscribeEvents',
          'runtime.continueEventReplay',
          'runtime.healthcheck',
        ],
      },
    }),
  );
});

let pending = Buffer.alloc(0);
let sawHealthcheck = false;
let sawAppend = false;
let sawEvent = false;
let appendSent = false;
const timeout = setTimeout(() => {
  console.error('pipe smoke timeout');
  process.exit(1);
}, 8_000);

function send(frame) {
  sock.write(encodeFrame(frame));
}

sock.on('data', (b) => {
  const decoded = decodeFrames(Buffer.concat([pending, b]));
  pending = decoded.remaining;
  for (const frame of decoded.frames) {
    console.log('RX', JSON.stringify(frame));
    if (frame.id === 'probe' && frame.type === '__hello' && !frame.error) {
      send({ id: 'hc', kind: 'request', type: 'runtime.healthcheck', payload: {} });
      send({ id: 'sub', kind: 'request', type: 'runtime.subscribeEvents', payload: { afterCursor: 0 } });
    }
    if (frame.id === 'hc' && frame.type === 'runtime.healthcheck') {
      sawHealthcheck = true;
    }
    if (
      frame.kind === 'response' &&
      !frame.error &&
      (frame.type === 'runtime.subscribeEvents' ||
        frame.type === 'runtime.continueEventReplay')
    ) {
      const page = frame.payload;
      if (!page.replayComplete) {
        send({
          id: `continue-${page.nextCursor}`,
          kind: 'request',
          type: 'runtime.continueEventReplay',
          payload: { streamId: page.streamId, afterCursor: page.nextCursor },
        });
      } else if (!appendSent) {
        appendSent = true;
        send({
          id: 'append',
          kind: 'request',
          type: 'task.appendMessage',
          payload: {
            threadId: 'thread-dev-smoke',
            expectedTaskVersion,
            role: 'user',
            text: 'pipe smoke message',
          },
        });
      }
    }
    if (frame.id === 'append' && frame.type === 'task.appendMessage' && !frame.error) {
      sawAppend = true;
    }
    if (frame.kind === 'event' && frame.type === 'runtime.event') {
      sawEvent = true;
    }
  }
  if (sawHealthcheck && sawAppend && sawEvent) {
    console.log('PIPE_SMOKE_OK');
    clearTimeout(timeout);
    sock.end();
    process.exit(0);
  }
});
sock.on('error', (e) => {
  console.error('pipe error', e.message);
  process.exit(1);
});
