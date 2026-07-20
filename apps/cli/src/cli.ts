#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  APPLICATION_TOOL_DEFINITIONS,
  DEFAULT_FEATURES,
  getApplicationToolDefinition,
  type CommandType,
} from '@sync-think/protocol';
import { runSyncThinkMcpServer } from './mcp-server.js';
import { RuntimeCommandClient } from './runtime-command-client.js';

function usage(): string {
  return [
    'SYNC-THINK command client',
    '',
    'Usage:',
    '  sync-think tools',
    '  sync-think call <tool-or-command> [--json <json> | --input-file <path>] [--confirm <token>]',
    '  sync-think mcp',
    '',
    'Environment:',
    '  SYNC_THINK_INSTALL_ID       Runtime installation id (default: dev-0001)',
    '  SYNC_THINK_PIPE_SECRET      Runtime handshake secret when enabled',
  ].join('\n');
}

function confirmationTokenFromArgs(args: string[]): string | undefined {
  const index = args.indexOf('--confirm');
  if (index < 0) return undefined;
  const token = args[index + 1]?.trim();
  if (!token) throw new Error('--confirm requires a token');
  return token;
}

async function payloadFromArgs(args: string[]): Promise<unknown> {
  const jsonIndex = args.indexOf('--json');
  if (jsonIndex >= 0) {
    const raw = args[jsonIndex + 1];
    if (raw === undefined) throw new Error('--json requires a JSON value');
    return JSON.parse(raw) as unknown;
  }
  const fileIndex = args.indexOf('--input-file');
  if (fileIndex >= 0) {
    const path = args[fileIndex + 1];
    if (!path) throw new Error('--input-file requires a path');
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  }
  return {};
}

function resolveCommand(value: string): CommandType {
  const definition = getApplicationToolDefinition(value);
  if (definition) return definition.command;
  if ((DEFAULT_FEATURES as readonly string[]).includes(value)) return value as CommandType;
  throw new Error(`Unknown SYNC-THINK tool or command: ${value}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const installId = process.env.SYNC_THINK_INSTALL_ID ?? 'dev-0001';
  const helloSecret = process.env.SYNC_THINK_PIPE_SECRET;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === 'tools') {
    process.stdout.write(`${JSON.stringify(APPLICATION_TOOL_DEFINITIONS, null, 2)}\n`);
    return;
  }
  if (command === 'mcp') {
    await runSyncThinkMcpServer({ installId, helloSecret });
    return;
  }
  if (command !== 'call' || !args[1]) throw new Error(usage());

  const client = new RuntimeCommandClient({
    installId,
    helloSecret,
    appVersion: 'sync-think-cli/0.0.1',
    callerSurface: 'cli',
  });
  try {
    const callArgs = args.slice(2);
    const result = await client.request(resolveCommand(args[1]), await payloadFromArgs(callArgs), {
      confirmationToken: confirmationTokenFromArgs(callArgs),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    client.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
