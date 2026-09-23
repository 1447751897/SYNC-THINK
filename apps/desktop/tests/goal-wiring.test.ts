import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/goal-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Goal IPC wiring', () => {
  it('registers Goal commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:goal-set', 'goal.set'],
      ['runtime:goal-get', 'goal.get'],
      ['runtime:goal-clear', 'goal.clear'],
      ['runtime:goal-pause', 'goal.pause'],
      ['runtime:goal-resume', 'goal.resume'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerGoalHandlers({');
    expect(mainSource).toContain('requestGoal:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:goal-set',
      'runtime:goal-get',
      'runtime:goal-clear',
      'runtime:goal-pause',
      'runtime:goal-resume',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('setGoal(');
    expect(globalSource).toContain('getGoal(');
    expect(globalSource).toContain('clearGoal(');
    expect(globalSource).toContain('goalPause(');
    expect(globalSource).toContain('goalResume(');
  });
});
