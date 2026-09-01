import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');

describe('prompt enhancement desktop wiring', () => {
  it('forwards enhancement and cancellation through strict main-process handlers', () => {
    expect(mainSource).toContain("ipcMain.handle('runtime:prompt-enhance'");
    expect(mainSource).toContain("'prompt.enhance'");
    expect(mainSource).toContain('parsePromptEnhancePayload(value)');
    expect(mainSource).toContain("ipcMain.handle('runtime:prompt-enhance-cancel'");
    expect(mainSource).toContain("'prompt.enhance.cancel'");
    expect(mainSource).toContain('parsePromptEnhanceCancelPayload(value)');
  });

  it('exposes only the typed enhancement bridge methods to the renderer', () => {
    expect(preloadSource).toContain('enhancePrompt:');
    expect(preloadSource).toContain("'runtime:prompt-enhance'");
    expect(preloadSource).toContain('cancelPromptEnhancement:');
    expect(preloadSource).toContain("'runtime:prompt-enhance-cancel'");
  });
});
