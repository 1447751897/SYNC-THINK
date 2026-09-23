import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/skill-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('installed Skill IPC wiring', () => {
  it('registers installed Skill commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:skill-import', 'skill.import'],
      ['runtime:skill-import-remote', 'skill.importRemote'],
      ['runtime:skill-list', 'skill.list'],
      ['runtime:skill-delete', 'skill.delete'],
      ['runtime:skill-get', 'skill.get'],
      ['runtime:skill-set-enabled', 'skill.setEnabled'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(handlerSource).toContain('timeoutMs: 30_000');
    expect(mainSource).toContain('registerSkillHandlers({');
    expect(mainSource).toContain('requestSkill:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:skill-import',
      'runtime:skill-import-remote',
      'runtime:skill-list',
      'runtime:skill-delete',
      'runtime:skill-get',
      'runtime:skill-set-enabled',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('importSkill(');
    expect(globalSource).toContain('importRemoteSkill(');
    expect(globalSource).toContain('listSkills(');
    expect(globalSource).toContain('deleteSkill(');
    expect(globalSource).toContain('getSkill(');
    expect(globalSource).toContain('setSkillEnabled(');
  });
});
