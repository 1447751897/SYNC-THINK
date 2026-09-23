import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TASK_RUNTIME_IPC_CHANNELS } from '../src/runtime-bridge-contract.js';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(new URL('../src/main/task-handlers.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
const globalSource = readFileSync(new URL('../src/renderer/global.d.ts', import.meta.url), 'utf8');

describe('Task directory IPC wiring', () => {
  it('registers task directory commands through the typed boundary', () => {
    for (const command of [
      'task.create',
      'task.list',
      'task.open',
      'task.search',
      'task.archive',
      'task.unarchive',
    ]) {
      expect(handlerSource).toContain(`'${command}'`);
      expect(mainSource).not.toContain(`request('${command}'`);
    }
    expect(preloadSource).toContain('TASK_RUNTIME_IPC_CHANNELS,');
    for (const channelKey of Object.keys(TASK_RUNTIME_IPC_CHANNELS)) {
      expect(preloadSource).toContain(`TASK_RUNTIME_IPC_CHANNELS.${channelKey}`);
    }
    expect(mainSource).toContain('registerTaskHandlers({');
    expect(mainSource).toContain('requestTask:');
  });

  it('keeps the existing Renderer bridge contracts', () => {
    for (const method of [
      'createTask(payload: CreateTaskPayload)',
      'listTasks(payload: ListTasksPayload)',
      'openTask(payload: OpenTaskPayload)',
      'searchTasks(payload: SearchTasksPayload)',
      'archiveTask(',
      'unarchiveTask(',
    ]) {
      expect(globalSource).toContain(method);
    }
  });
});
