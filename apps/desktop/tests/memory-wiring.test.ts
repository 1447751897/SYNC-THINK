import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
const handlerSource = readFileSync(
  new URL('../src/main/memory-handlers.ts', import.meta.url),
  'utf8',
);
const preloadSource = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');

const memoryCommands = [
  ['listMemory', 'runtime:memory-list', 'memory.list', 'parseListMemoryPayload'],
  ['decideMemory', 'runtime:memory-decide', 'memory.decide', 'parseDecideMemoryPayload'],
  ['rollbackMemory', 'runtime:memory-rollback', 'memory.rollback', 'parseRollbackMemoryPayload'],
] as const;

describe('Desktop Memory wiring', () => {
  it.each(memoryCommands)(
    'routes %s through its strict parser to %s',
    (method, channel, command, parser) => {
      expect(handlerSource).toContain(`host.handle('${channel}'`);
      expect(handlerSource).toContain(`host.requestMemory('${command}'`);
      expect(handlerSource).toContain(`${parser}(value)`);
      expect(preloadSource).toContain(`${method}:`);
      expect(preloadSource).toContain(`'${channel}'`);
    },
  );

  it('registers the Memory boundary from the Main composition root', () => {
    expect(mainSource).toContain('registerMemoryHandlers({');
    expect(mainSource).toContain('requestMemory:');
    expect(mainSource).not.toContain("request('memory.");
  });
});
