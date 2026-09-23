import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROMPT_DESIGN_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/prompt-design-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Prompt and design IPC wiring', () => {
  it('registers transformation commands through the typed boundary', () => {
    for (const command of ['prompt.enhance', 'prompt.enhance.cancel', 'design.generate']) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('PROMPT_DESIGN_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(PROMPT_DESIGN_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`PROMPT_DESIGN_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerPromptDesignHandlers({');
    expect(mainSource).toContain('requestPromptDesign:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    expect(globalSource).toContain('enhancePrompt(payload: PromptEnhancePayload)');
    expect(globalSource).toContain('cancelPromptEnhancement(');
    expect(globalSource).toContain('generateDesign(payload: DesignGeneratePayload)');
  });
});
