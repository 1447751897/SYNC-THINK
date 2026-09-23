import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/participation-mode-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Participation Mode IPC wiring', () => {
  it('registers the command through the typed execution-policy boundary', () => {
    expect(handlerSource).toContain("'task.setParticipationMode'");
    expect(mainSource).not.toContain("request('task.setParticipationMode'");
    expect(preloadSource).toContain('PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS,');
    expect(preloadSource).toContain('PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS.set');
    expect(mainSource).toContain('registerParticipationModeHandlers({');
    expect(mainSource).toContain('requestParticipationMode:');
  });

  it('keeps the existing Renderer bridge contract', () => {
    expect(globalSource).toContain('setParticipationMode(');
    expect(globalSource).toContain('payload: SetParticipationModePayload');
    expect(globalSource).toContain('Promise<SetParticipationModeResponse>');
    expect(PARTICIPATION_MODE_RUNTIME_IPC_CHANNELS.set).toBe('runtime:mode-set');
  });
});
