import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/provider-catalog-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Provider Catalog IPC wiring', () => {
  it('registers catalog commands through typed transport and an injected clipboard port', () => {
    for (const command of [
      'provider.create',
      'provider.update',
      'provider.list',
      'provider.reorder',
      'provider.delete',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`PROVIDER_CATALOG_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerProviderCatalogHandlers({');
    expect(mainSource).toContain('requestProviderCatalog:');
    expect(mainSource).toContain('readClipboardText: () => clipboard.readText()');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const method of [
      'createProvider(payload: RendererCreateProviderPayload)',
      'updateProvider(payload: RendererUpdateProviderPayload)',
      'listProviders(payload?: ListProvidersPayload)',
      'reorderProviders(payload: ReorderProvidersPayload)',
      'deleteProvider(payload: DeleteProviderPayload)',
    ]) {
      expect(globalSource).toContain(method);
    }
  });
});
