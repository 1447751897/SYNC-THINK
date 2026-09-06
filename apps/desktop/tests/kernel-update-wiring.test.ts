import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const contractSource = readFileSync(
  new URL('../src/kernel-update-contract.ts', import.meta.url),
  'utf8',
);

describe('private kernel update wiring', () => {
  it('broadcasts managed kernel state so composer versions refresh immediately', () => {
    expect(mainSource).toContain("target.send('desktop:kernel-update-state', snapshot)");
    expect(preloadSource).toContain("const channel = 'desktop:kernel-update-state'");
    expect(preloadSource).toContain('subscribeState:');
    expect(mainSource).toContain('bootstrapPrivateKernelsAtStartup');
    expect(preloadSource).toContain('desktop:kernel-update-check');
    expect(contractSource).toContain('checkForUpdates(payload?: {');
  });

  it('treats Pi as a private managed kernel alongside Codex and Claude Code', () => {
    expect(contractSource).toContain("export type ManagedKernelUpdateId = 'codex' | 'claude-code' | 'pi'");
    expect(mainSource).toContain("installUpdate('pi')");
    expect(mainSource).toContain('void bootstrapPrivateKernelsAtStartup()');
    expect(mainSource).toContain('item.kernelId !== \'pi\'');
  });
});
