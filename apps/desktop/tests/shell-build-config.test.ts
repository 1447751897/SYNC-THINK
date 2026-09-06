import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SHELL_BUDGET,
  assertGeneratedPath,
  assertProductionShellBuild,
  assertShellBudget,
  removeGeneratedDirectory,
  shellBuildOptions,
  summarizeShellBuild,
} from '../scripts/shell-build-config.mjs';

const desktopRoot = resolve(__dirname, '..');
const scratchRoot = resolve(desktopRoot, '../../.data/renderer-builds');
const directories: string[] = [];
function fixtureDirectory() {
  mkdirSync(scratchRoot, { recursive: true });
  const directory = mkdtempSync(join(scratchRoot, 'config-test-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) removeGeneratedDirectory(directory, scratchRoot);
});

describe('renderer build isolation and budget', () => {
  it('uses production by default and isolates development and QA output', () => {
    const production = shellBuildOptions([], desktopRoot);
    expect(production.mode).toBe('production');
    expect(production.optimized).toBe(true);
    expect(production.outdir).toBe(resolve(desktopRoot, 'dist/renderer-shell'));
    for (const mode of ['development', 'qa']) {
      const options = shellBuildOptions(['--mode', mode], desktopRoot);
      expect(options.outdir).toBe(join(scratchRoot, mode));
      expect(options.optimized).toBe(mode === 'qa');
    }
    expect(() => shellBuildOptions(['--mode', 'test'], desktopRoot)).toThrow('invalid_mode');
    expect(() => shellBuildOptions(['--unexpected', 'value'], desktopRoot)).toThrow(
      'invalid_arguments',
    );
  });

  it('restricts custom outputs and recursive cleanup to generated children', () => {
    expect(() => shellBuildOptions(['--outdir', '.data'], desktopRoot)).toThrow(
      'outside_generated',
    );
    expect(() => shellBuildOptions(['--outdir', '.data/renderer-builds'], desktopRoot)).toThrow(
      'outside_generated',
    );
    expect(() => assertGeneratedPath(join(scratchRoot, '../sync-think.db'), scratchRoot)).toThrow(
      'outside_generated',
    );
    const fixture = fixtureDirectory();
    writeFileSync(join(fixture, 'preserved.txt'), 'data');
    expect(() => removeGeneratedDirectory(join(fixture, 'preserved.txt'), scratchRoot)).toThrow(
      'not_directory',
    );
    expect(readFileSync(join(fixture, 'preserved.txt'), 'utf8')).toBe('data');
    const generated = join(fixture, 'generated');
    mkdirSync(generated);
    writeFileSync(join(generated, 'stale.js'), 'stale');
    removeGeneratedDirectory(generated, scratchRoot);
    expect(existsSync(generated)).toBe(false);
  });

  it('rejects junctions before touching their targets', () => {
    const fixture = fixtureDirectory();
    const destination = join(fixture, 'destination');
    mkdirSync(destination);
    writeFileSync(join(destination, 'keep.txt'), 'keep');
    const link = join(fixture, 'junction');
    symlinkSync(destination, link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => removeGeneratedDirectory(link, scratchRoot)).toThrow('symlink');
    expect(() => assertGeneratedPath(join(link, 'child'), scratchRoot)).toThrow('symlink');
    expect(readFileSync(join(destination, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('counts the transitive static graph, not just the tiny entry or all lazy chunks', () => {
    const fixture = fixtureDirectory();
    for (const file of ['shell.js', 'shared.js', 'settings.js'])
      writeFileSync(join(fixture, file), file);
    const summary = summarizeShellBuild(
      {
        inputs: { 'shell-entry.tsx': {}, 'SettingsPage.tsx': {} },
        outputs: {
          'shell.js': {
            bytes: 10,
            imports: [
              { path: 'shared.js', kind: 'import-statement' },
              { path: 'settings.js', kind: 'dynamic-import' },
            ],
          },
          'shared.js': { bytes: 20, imports: [{ path: 'shell.js', kind: 'import-statement' }] },
          'settings.js': { bytes: 30, imports: [{ path: 'shared.js', kind: 'import-statement' }] },
        },
      },
      fixture,
      fixture,
    );
    expect(summary.initialJsBytes).toBe(30);
    expect(summary.totalJsBytes).toBe(60);
    expect(
      summary.files.find((file: { path: string }) => file.path === 'settings.js')?.initial,
    ).toBe(false);
    expect(summary.initialGzipBytes).toBeGreaterThan(0);
    expect(() => assertShellBudget(summary)).not.toThrow();
    expect(() =>
      assertShellBudget({ ...summary, initialJsBytes: SHELL_BUDGET.initialJsBytes + 1 }),
    ).toThrow('budget_exceeded');
    expect(() => assertShellBudget({ ...summary, totalJsBytes: NaN })).toThrow('budget_exceeded');
  });

  it('rejects unmarked or development output at release preflight', () => {
    const fixture = fixtureDirectory();
    expect(() => assertProductionShellBuild(fixture)).toThrow();
    const manifest = {
      schemaVersion: 1,
      mode: 'development',
      shell: { initialJsBytes: 10, totalJsBytes: 20 },
    };
    writeFileSync(join(fixture, 'build-manifest.json'), JSON.stringify(manifest));
    expect(() => assertProductionShellBuild(fixture)).toThrow('production_required');
    writeFileSync(
      join(fixture, 'build-manifest.json'),
      JSON.stringify({ ...manifest, mode: 'production' }),
    );
    expect(assertProductionShellBuild(fixture).mode).toBe('production');
  });
});
