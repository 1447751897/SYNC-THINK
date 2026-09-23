import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/web-search-provider-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Web Search Provider IPC wiring', () => {
  it('registers all commands through typed transport', () => {
    for (const command of [
      'webSearch.providers.list',
      'webSearch.providers.save',
      'webSearch.providers.reorder',
      'webSearch.providers.test',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS,');
    for (const key of Object.keys(WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`WEB_SEARCH_PROVIDER_RUNTIME_IPC_CHANNELS.${key}`);
    }
    expect(mainSource).toContain('registerWebSearchProviderHandlers({');
    expect(mainSource).toContain('requestWebSearchProvider:');
  });

  it('keeps the existing Renderer bridge contract', () => {
    expect(globalSource).toContain('listWebSearchProviders(');
    expect(globalSource).toContain('saveWebSearchProvider(');
    expect(globalSource).toContain('reorderWebSearchProviders(');
    expect(globalSource).toContain('testWebSearchProvider(');
  });
});
