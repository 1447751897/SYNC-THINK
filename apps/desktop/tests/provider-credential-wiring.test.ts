import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/provider-credential-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Provider Credential IPC wiring', () => {
  it('registers credential commands through typed transport and an injected clipboard port', () => {
    for (const command of [
      'provider.addCredential',
      'provider.removeCredential',
      'provider.clearCredentials',
      'provider.revealCredential',
      'provider.updateCredential',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`PROVIDER_CREDENTIAL_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerProviderCredentialHandlers({');
    expect(mainSource).toContain('requestProviderCredential:');
    expect(mainSource).toContain('readClipboardText: () => clipboard.readText()');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const method of [
      'addProviderCredential(',
      'removeProviderCredential(',
      'clearProviderCredentials(',
      'revealProviderCredential(',
      'updateProviderCredential(',
    ]) {
      expect(globalSource).toContain(method);
    }
  });
});
