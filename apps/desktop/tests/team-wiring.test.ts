import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/team-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Team IPC wiring', () => {
  it('registers Team catalog and run-control commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:team-list', 'team.list'],
      ['runtime:team-create', 'team.create'],
      ['runtime:team-update', 'team.update'],
      ['runtime:team-delete', 'team.delete'],
      ['runtime:team-start-run', 'team.startRun'],
      ['runtime:team-set-run-status', 'team.setRunStatus'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerTeamHandlers({');
    expect(mainSource).toContain('requestTeam:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:team-list',
      'runtime:team-create',
      'runtime:team-update',
      'runtime:team-delete',
      'runtime:team-start-run',
      'runtime:team-set-run-status',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('listTeams()');
    expect(globalSource).toContain('createTeam(');
    expect(globalSource).toContain('updateTeam(');
    expect(globalSource).toContain('deleteTeam(');
    expect(globalSource).toContain('startTeamRun(');
    expect(globalSource).toContain('setTeamRunStatus(');
  });
});
