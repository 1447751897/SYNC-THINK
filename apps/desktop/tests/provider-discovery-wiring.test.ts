import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/provider-discovery-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Provider Discovery IPC wiring', () => {
  it('registers discovery commands through typed transport and a clipboard port', () => {
    for (const command of [
      'provider.discoverModels',
      'provider.probeModels',
      'provider.probeCapabilities',
      'provider.confirmCapabilities',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`PROVIDER_DISCOVERY_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerProviderDiscoveryHandlers({');
    expect(mainSource).toContain('requestProviderDiscovery:');
    expect(mainSource).toContain('readClipboardText: () => clipboard.readText()');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const method of [
      'discoverModels(payload: DiscoverModelsPayload)',
      'probeModels(payload: RendererProbeModelsPayload)',
      'probeCapabilities(payload: ProbeCapabilitiesPayload)',
      'confirmCapabilities(',
    ]) {
      expect(globalSource).toContain(method);
    }
  });
});
