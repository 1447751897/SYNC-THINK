import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/policy-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Policy IPC wiring', () => {
  it('registers save and list through the typed Policy boundary', () => {
    expect(handlerSource).toContain("host.handle('runtime:policy-save'");
    expect(handlerSource).toContain("host.handle('runtime:policy-list'");
    expect(handlerSource).toContain("host.requestPolicy('policy.save'");
    expect(handlerSource).toContain("host.requestPolicy('policy.list'");
    expect(mainSource).toContain('registerPolicyHandlers({');
    expect(mainSource).toContain('requestPolicy:');
    expect(mainSource).not.toContain("request('policy.save'");
    expect(mainSource).not.toContain("request('policy.list'");
  });

  it('keeps the existing Renderer bridge payload and response contracts', () => {
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:policy-save', payload)");
    expect(preloadSource).toContain("ipcRenderer.invoke('runtime:policy-list', payload)");
    expect(globalSource).toContain('savePolicy(payload: SavePolicyPayload)');
    expect(globalSource).toContain('listPolicies(payload: ListPoliciesPayload)');
    expect(globalSource).toContain('Promise<SavePolicyResponse>');
    expect(globalSource).toContain('Promise<ListPoliciesResponse>');
  });
});
