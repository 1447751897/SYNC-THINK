import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/scheduled-task-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Scheduled Task IPC wiring', () => {
  it('registers Scheduled Task commands through the typed boundary', () => {
    for (const [channel, command] of [
      ['runtime:scheduled-task-create', 'scheduledTask.create'],
      ['runtime:scheduled-task-list', 'scheduledTask.list'],
      ['runtime:scheduled-task-update', 'scheduledTask.update'],
      ['runtime:scheduled-task-delete', 'scheduledTask.delete'],
      ['runtime:scheduled-task-trigger', 'scheduledTask.trigger'],
      ['runtime:scheduled-task-history', 'scheduledTask.history'],
    ]) {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(mainSource).toContain('registerScheduledTaskHandlers({');
    expect(mainSource).toContain('requestScheduledTask:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const channel of [
      'runtime:scheduled-task-create',
      'runtime:scheduled-task-list',
      'runtime:scheduled-task-update',
      'runtime:scheduled-task-delete',
      'runtime:scheduled-task-trigger',
      'runtime:scheduled-task-history',
    ]) {
      expect(preloadSource).toContain(`'${channel}'`);
    }
    expect(globalSource).toContain('createScheduledTask(');
    expect(globalSource).toContain('listScheduledTasks(');
    expect(globalSource).toContain('updateScheduledTask(');
    expect(globalSource).toContain('deleteScheduledTask(');
    expect(globalSource).toContain('triggerScheduledTask(');
    expect(globalSource).toContain('scheduledTaskHistory(');
  });
});
