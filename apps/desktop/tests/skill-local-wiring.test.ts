import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/skill-local-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Skill Local IPC wiring', () => {
  it('registers local Skill commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:skill-local-scan', 'skill.local.scan'],
      ['runtime:skill-local-inspect', 'skill.local.inspect'],
      ['runtime:skill-local-import', 'skill.local.import'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerSkillLocalHandlers({');
    expect(mainSource).toContain('requestSkillLocal:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:skill-local-scan',
      'runtime:skill-local-inspect',
      'runtime:skill-local-import',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('skillLocalScan(');
    expect(globalSource).toContain('skillLocalInspect(');
    expect(globalSource).toContain('skillLocalImport(');
  });
});
