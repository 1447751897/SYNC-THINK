import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDesktopDiagnosticsBundle,
  DesktopCrashJournal,
  scrubDiagnosticValue,
  writeDesktopDiagnosticsBundle,
} from './diagnostics-export.js';

describe('desktop diagnostics export', () => {
  it('deep-scrubs secret-shaped values, sensitive keys, home paths, and binary data', () => {
    const cyclic: Record<string, unknown> = {
      apiKey: 'sk-this-key-must-not-survive',
      authorization: 'Bearer abc.def.ghi',
      message: 'token=top-secret at C:\\Users\\tester\\project',
      bytes: Buffer.from('secret bytes'),
    };
    cyclic.self = cyclic;

    expect(scrubDiagnosticValue(cyclic, { homeDirectory: 'C:\\Users\\tester' })).toEqual({
      apiKey: '[REDACTED]',
      authorization: '[REDACTED]',
      message: '[REDACTED] at %USERPROFILE%\\project',
      bytes: '[BINARY 12 bytes]',
      self: '[CIRCULAR]',
    });
  });

  it('creates a privacy-declared bundle without raw prompts or messages', () => {
    const bundle = createDesktopDiagnosticsBundle({
      now: new Date('2026-08-02T10:00:00.000Z'),
      homeDirectory: 'C:\\Users\\tester',
      application: { version: '0.0.1', token: 'secret-token' },
      runtime: { pid: 42, cwd: 'C:\\Users\\tester\\app' },
      diagnostics: [{ summary: 'provider failed with sk-abcdefghijklmnop' }],
      knownLimitations: ['External provider availability varies.'],
      recoveryInstructions: ['Restart Runtime, then retry.'],
    });

    expect(bundle.generatedAt).toBe('2026-08-02T10:00:00.000Z');
    expect(bundle.privacy).toMatchObject({
      scrubbed: true,
      secretValuesIncluded: false,
      rawPromptsIncluded: false,
      rawMessageContentIncluded: false,
    });
    expect(JSON.stringify(bundle)).not.toContain('secret-token');
    expect(JSON.stringify(bundle)).not.toContain('sk-abcdefghijklmnop');
    expect(bundle.runtime).toMatchObject({ cwd: '%USERPROFILE%\\app' });
  });

  it('writes an atomic JSON export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-diagnostics-export-'));
    const target = join(root, 'support.json');
    const bundle = createDesktopDiagnosticsBundle({ application: { version: '0.0.1' } });
    await writeDesktopDiagnosticsBundle(target, bundle);
    const persisted = JSON.parse(await readFile(target, 'utf8')) as { schemaVersion: number };
    expect(persisted.schemaVersion).toBe(1);
  });
});

describe('DesktopCrashJournal', () => {
  it('persists scrubbed evidence and enforces count retention', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-crash-journal-'));
    let now = new Date('2026-08-02T10:00:00.000Z');
    const journal = new DesktopCrashJournal({ root, maxRecords: 2, now: () => now });

    await journal.append({ source: 'renderer', kind: 'gone', summary: 'sk-abcdefghijklmnop', detail: { password: 'open-sesame' } });
    now = new Date('2026-08-02T10:01:00.000Z');
    await journal.append({ source: 'worker', kind: 'crash', summary: 'second', detail: {} });
    now = new Date('2026-08-02T10:02:00.000Z');
    await journal.append({ source: 'main', kind: 'rejection', summary: 'third', detail: {} });

    const records = await journal.list();
    expect(records).toHaveLength(2);
    expect(records.map((record) => record.summary)).toEqual(['third', 'second']);
    expect(JSON.stringify(records)).not.toContain('open-sesame');
    expect(JSON.stringify(records)).not.toContain('sk-abcdefghijklmnop');
  });

  it('removes records older than the bounded retention window and ignores corrupt files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sync-think-crash-retention-'));
    const journal = new DesktopCrashJournal({
      root,
      retentionDays: 2,
      now: () => new Date('2026-08-02T10:00:00.000Z'),
    });
    const old = join(root, 'old.json');
    await writeFile(old, '{broken', 'utf8');
    await utimes(old, new Date('2026-07-20T00:00:00.000Z'), new Date('2026-07-20T00:00:00.000Z'));
    await journal.prune();
    expect(await journal.list()).toEqual([]);
  });
});
