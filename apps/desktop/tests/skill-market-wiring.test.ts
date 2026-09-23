import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/skill-market-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Skill Market IPC wiring', () => {
  it('registers Skill Market commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:skill-market-list', 'skill.market.list'],
      ['runtime:skill-market-install', 'skill.market.install'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerSkillMarketHandlers({');
    expect(mainSource).toContain('requestSkillMarket:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    expect(preloadSource).toContain("'runtime:skill-market-list'");
    expect(preloadSource).toContain("'runtime:skill-market-install'");
    expect(globalSource).toContain('listSkillMarket(');
    expect(globalSource).toContain('installSkillMarket(');
  });
});
