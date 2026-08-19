import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRuntimeEntry } from '../src/daemon/main.js';

describe('resolveRuntimeEntry', () => {
  const original = process.env.SYNC_THINK_RESOURCES_PATH;
  const originalEntry = process.env.SYNC_THINK_RUNTIME_ENTRY;
  const dirs: string[] = [];

  afterEach(() => {
    if (original === undefined) delete process.env.SYNC_THINK_RESOURCES_PATH;
    else process.env.SYNC_THINK_RESOURCES_PATH = original;
    if (originalEntry === undefined) delete process.env.SYNC_THINK_RUNTIME_ENTRY;
    else process.env.SYNC_THINK_RUNTIME_ENTRY = originalEntry;
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('prefers an explicit runtime entry override', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daemon-entry-'));
    dirs.push(dir);
    const entry = join(dir, 'runtime.js');
    writeFileSync(entry, '// fixture', 'utf8');
    process.env.SYNC_THINK_RUNTIME_ENTRY = entry;
    expect(resolveRuntimeEntry()).toBe(entry);
  });

  it('resolves the packaged resources/runtime entry independent of cwd', () => {
    const dir = mkdtempSync(join(tmpdir(), 'daemon-resources-'));
    dirs.push(dir);
    const runtimeDir = join(dir, 'runtime');
    mkdirSync(runtimeDir, { recursive: true });
    const entry = join(runtimeDir, 'main.js');
    writeFileSync(entry, '// packaged fixture', 'utf8');
    delete process.env.SYNC_THINK_RUNTIME_ENTRY;
    process.env.SYNC_THINK_RESOURCES_PATH = dir;
    expect(resolveRuntimeEntry()).toBe(entry);
  });
});
