import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseProjectTerminalCommand,
  resolveProjectTerminalCwd,
} from './project-terminal.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('parseProjectTerminalCommand', () => {
  it('splits an executable and quoted argv without invoking a shell', () => {
    expect(parseProjectTerminalCommand('node -e "console.log(\'hello world\')"')).toEqual({
      kind: 'exec',
      command: 'node',
      args: ['-e', "console.log('hello world')"],
    });
  });

  it('preserves quoted Windows paths, escaped quotes, and empty arguments', () => {
    expect(
      parseProjectTerminalCommand(
        'node "C:\\Program Files\\app.js" "\\\\server\\share\\app.js" --label "say \\"hi\\"" ""',
      ),
    ).toEqual({
      kind: 'exec',
      command: 'node',
      args: [
        'C:\\Program Files\\app.js',
        '\\\\server\\share\\app.js',
        '--label',
        'say "hi"',
        '',
      ],
    });
  });

  it('recognizes a relative cd built-in', () => {
    expect(parseProjectTerminalCommand('cd "src/app"')).toEqual({
      kind: 'cd',
      path: 'src/app',
    });
  });

  it.each(['pnpm test && echo injected', 'node app.js | more', 'git status\nwhoami'])(
    'rejects shell metacharacters outside quotes: %s',
    (commandLine) => {
      expect(() => parseProjectTerminalCommand(commandLine)).toThrow(/metacharacter/i);
    },
  );

  it('rejects unterminated quotes and empty commands', () => {
    expect(() => parseProjectTerminalCommand('node "unterminated')).toThrow(/quote/i);
    expect(() => parseProjectTerminalCommand('   ')).toThrow(/command/i);
    expect(() => parseProjectTerminalCommand('node \u001b[2J')).toThrow(/control character/i);
  });

  it('resolves cd against the current project cwd and rejects an escape', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-terminal-cwd-'));
    roots.push(root);
    mkdirSync(join(root, 'src', 'app'), { recursive: true });

    await expect(resolveProjectTerminalCwd(root, 'src', 'app')).resolves.toEqual({
      root: await realpath(root),
      cwd: 'src/app',
    });
    await expect(resolveProjectTerminalCwd(root, '', '..')).rejects.toThrow(/project root/i);
    await expect(resolveProjectTerminalCwd(root, '', root)).rejects.toThrow(/relative/i);
  });

  it('rejects a cd target whose real path escapes through a linked directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sync-think-terminal-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'sync-think-terminal-outside-'));
    roots.push(root, outside);
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(resolveProjectTerminalCwd(root, '', 'linked')).rejects.toThrow(/project root/i);
  });
});
