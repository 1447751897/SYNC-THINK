import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RUN_CONTROL_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/run-control-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Run control IPC wiring', () => {
  it('registers both cancel surfaces through the same typed wire contract', () => {
    for (const command of ['run.getGraph', 'run.pause', 'run.resume', 'run.cancel']) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('RUN_CONTROL_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(RUN_CONTROL_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`RUN_CONTROL_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerRunControlHandlers({');
    expect(mainSource).toContain('requestRunControl:');
  });

  it('keeps the existing Renderer bridge methods', () => {
    for (const method of [
      'cancelRun(payload: CancelRunPayload)',
      'getRunGraph(payload: RunGetGraphPayload)',
      'pauseOrchestrationRun(',
      'resumeOrchestrationRun(',
      'cancelOrchestrationRun(',
    ]) {
      expect(globalSource).toContain(method);
    }
  });
});
