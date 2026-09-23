import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDER_MODEL_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/provider-model-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Provider Model IPC wiring', () => {
  it('registers model commands through typed transport', () => {
    for (const command of [
      'provider.addModels',
      'provider.setModelPriorities',
      'provider.updateModel',
      'provider.removeModel',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('PROVIDER_MODEL_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(PROVIDER_MODEL_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`PROVIDER_MODEL_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerProviderModelHandlers({');
    expect(mainSource).toContain('requestProviderModel:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const method of [
      'addModels(payload: AddModelsPayload)',
      'setModelPriorities(payload: SetModelPrioritiesPayload)',
      'updateModel(payload: UpdateModelPayload)',
      'removeProviderModel(payload: RemoveModelPayload)',
    ]) {
      expect(globalSource).toContain(method);
    }
  });
});
