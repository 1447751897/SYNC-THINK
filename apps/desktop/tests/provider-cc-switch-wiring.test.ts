import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/provider-cc-switch-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Provider CC Switch IPC wiring', () => {
  it('registers preview and import through typed transport', () => {
    expect(handlerSource).toContain("'provider.previewCcSwitchImport'");
    expect(handlerSource).toContain("'provider.importCcSwitch'");
    expect(mainSource).not.toContain("request('provider.previewCcSwitchImport'");
    expect(mainSource).not.toContain("request('provider.importCcSwitch'");
    expect(preloadSource).toContain('PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS,');
    for (const key of Object.keys(PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`PROVIDER_CC_SWITCH_RUNTIME_IPC_CHANNELS.${key}`);
    }
    expect(mainSource).toContain('registerProviderCcSwitchHandlers({');
    expect(mainSource).toContain('requestProviderCcSwitch:');
  });

  it('keeps the existing Renderer bridge contract', () => {
    expect(globalSource).toContain('previewCcSwitchImport(');
    expect(globalSource).toContain('importCcSwitch(');
    expect(globalSource).toContain('Promise<PreviewCcSwitchImportResponse>');
    expect(globalSource).toContain('Promise<ImportCcSwitchResponse>');
  });
});
