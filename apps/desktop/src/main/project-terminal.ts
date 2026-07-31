import { realpath, stat } from 'node:fs/promises';
import * as path from 'node:path';

const MAX_COMMAND_LINE_LENGTH = 16_384;
const MAX_ARGUMENTS = 128;

export type ParsedProjectTerminalCommand =
  | { kind: 'exec'; command: string; args: string[] }
  | { kind: 'cd'; path: string };

function tokenizeCommandLine(commandLine: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | null = null;
  let tokenStarted = false;
  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index]!;
    if (character === '\\' && quote === 'double') {
      const next = commandLine[index + 1];
      if (next === '"') {
        current += next;
        index += 1;
      } else {
        current += character;
      }
      tokenStarted = true;
      continue;
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      tokenStarted = true;
      continue;
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      tokenStarted = true;
      continue;
    }
    if (!quote && /[;&|<>$`\r\n]/.test(character)) {
      throw new Error('Terminal command contains a shell metacharacter outside quotes');
    }
    const characterCode = character.charCodeAt(0);
    if (character !== '\t' && (characterCode < 0x20 || characterCode === 0x7f)) {
      throw new Error('Terminal command contains an unsupported control character');
    }
    if (!quote && /\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(current);
        current = '';
        tokenStarted = false;
      }
      continue;
    }
    current += character;
    tokenStarted = true;
  }
  if (quote) throw new Error('Terminal command has an unterminated quote');
  if (tokenStarted) tokens.push(current);
  return tokens;
}

export function parseProjectTerminalCommand(commandLine: string): ParsedProjectTerminalCommand {
  const raw = String(commandLine ?? '').trim();
  if (!raw || raw.length > MAX_COMMAND_LINE_LENGTH || raw.includes('\0')) {
    throw new Error('Invalid terminal command');
  }
  const tokens = tokenizeCommandLine(raw);
  if (!tokens[0] || tokens.length > MAX_ARGUMENTS + 1) {
    throw new Error('Invalid terminal command arguments');
  }
  const command = tokens[0];
  const args = tokens.slice(1);
  if (command.toLowerCase() === 'cd') {
    if (args.length !== 1 || !args[0]) throw new Error('cd requires one relative path');
    return { kind: 'cd', path: args[0] };
  }
  return { kind: 'exec', command, args };
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export async function resolveProjectTerminalCwd(
  projectRoot: string,
  currentCwd: string,
  requestedPath: string,
): Promise<{ root: string; cwd: string }> {
  const requested = String(requestedPath ?? '').trim();
  if (!requested || path.isAbsolute(requested) || path.win32.isAbsolute(requested)) {
    throw new Error('Terminal cd path must be relative');
  }
  const root = await realpath(path.resolve(projectRoot));
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error('Terminal project root must be a directory');
  const current = currentCwd.trim().replace(/\\/g, '/') || '.';
  if (path.isAbsolute(current) || path.win32.isAbsolute(current)) {
    throw new Error('Terminal cwd must be project-relative');
  }
  const candidate = path.resolve(root, current, requested);
  if (!isPathInside(candidate, root)) throw new Error('Terminal cd path escapes project root');
  const target = await realpath(candidate);
  if (!isPathInside(target, root)) throw new Error('Terminal cd path escapes project root');
  const targetInfo = await stat(target);
  if (!targetInfo.isDirectory()) throw new Error('Terminal cd target is not a directory');
  const cwd = path.relative(root, target).replace(/\\/g, '/');
  return { root, cwd };
}
