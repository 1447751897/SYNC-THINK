// Quick pipe client probe for dev:runtime:pipe-test. Connects, completes the
// protocol handshake, and verifies runtime.healthcheck without replaying the
// durable event history or mutating conversation data.
import { connect } from 'node:net';
import {
  PROTOCOL_VERSION,
  decodeFrames,
  encodeFrame,
  pipePathPortable,
} from '@sync-think/protocol';

const installId = process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001';
const allowNoToken = process.env.SYNC_THINK_DEV_NO_TOKEN ?? '1';
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
        features: ['runtime.healthcheck'],
      },
    }),
  );
});

let pending = Buffer.alloc(0);
const timeout = setTimeout(() => {
  console.error('pipe smoke timeout');
  sock.destroy();
  process.exitCode = 1;
}, 8_000);

function finish(exitCode) {
  clearTimeout(timeout);
  sock.end();
  process.exitCode = exitCode;
}

sock.on('data', (b) => {
  const decoded = decodeFrames(Buffer.concat([pending, b]));
  pending = decoded.remaining;
  for (const frame of decoded.frames) {
    console.log('RX', JSON.stringify(frame));
    if (frame.id === 'probe' && frame.type === '__hello') {
      if (frame.error) {
        console.error('pipe handshake failed', frame.error.message ?? frame.error.code);
        finish(1);
        return;
      }
      sock.write(
        encodeFrame({
          id: 'hc',
          kind: 'request',
          type: 'runtime.healthcheck',
          payload: {},
        }),
      );
      continue;
    }
    if (frame.id === 'hc' && frame.type === 'runtime.healthcheck') {
      if (frame.error || frame.payload?.ok !== true) {
        console.error(
          'runtime healthcheck failed',
          frame.error?.message ?? frame.error?.code ?? 'not healthy',
        );
        finish(1);
        return;
      }
      console.log('PIPE_SMOKE_OK');
      finish(0);
      return;
    }
  }
});
sock.on('error', (e) => {
  console.error('pipe error', e.message);
  clearTimeout(timeout);
  process.exitCode = 1;
});
