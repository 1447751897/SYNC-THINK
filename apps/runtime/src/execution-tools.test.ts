import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { invokeExecutionTool } from './execution-tools.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('conversation execution tools', () => {
  it('reads and writes only inside the persisted task execution root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-execution-tools-'));
    tempDirs.push(root);
    writeFileSync(join(root, 'input.txt'), 'hello');
    const read = JSON.parse(
      await invokeExecutionTool({
        name: 'read_file',
        arguments: { path: 'input.txt' },
        executionRoot: root,
      }),
    ) as Record<string, unknown>;
    expect(JSON.stringify(read)).toContain('hello');

    await invokeExecutionTool({
      name: 'write_file',
      arguments: { path: 'output.txt', content: 'done' },
      executionRoot: root,
    });
    expect(readFileSync(join(root, 'output.txt'), 'utf8')).toBe('done');
    await expect(
      invokeExecutionTool({
        name: 'read_file',
        arguments: { path: '..\\outside.txt' },
        executionRoot: root,
      }),
    ).rejects.toThrow();
  });
});
