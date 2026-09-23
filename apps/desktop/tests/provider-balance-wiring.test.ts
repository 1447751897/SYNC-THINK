import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/provider-balance-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Provider Balance IPC wiring', () => {
  it('registers the balance query through typed transport', () => {
    expect(handlerSource).toContain("'provider.balance'");
    expect(mainSource).not.toContain("request('provider.balance'");
    expect(preloadSource).toContain('PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS,');
    expect(preloadSource).toContain('PROVIDER_BALANCE_RUNTIME_IPC_CHANNELS.query');
    expect(mainSource).toContain('registerProviderBalanceHandlers({');
    expect(mainSource).toContain('requestProviderBalance:');
  });

  it('keeps the existing Renderer bridge contract', () => {
    expect(globalSource).toContain('queryProviderBalance(');
    expect(globalSource).toContain("import('@sync-think/protocol').ProviderBalancePayload");
    expect(globalSource).toContain("import('@sync-think/protocol').ProviderBalanceResponse");
  });
});
