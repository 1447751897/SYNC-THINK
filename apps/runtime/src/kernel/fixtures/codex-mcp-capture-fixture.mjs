#!/usr/bin/env node
/**
 * Real-capture replay fixture: codex-cli 0.145.0 `exec --json` with an MCP tool.
 *
 * Every line in `codex-0.145.0-mcp-capture.jsonl` was captured from the real CLI
 * on 2026-08-14 (see .data/kernel-capture/codex-capture.mjs) and only trimmed
 * for size — item ids, `server`/`tool`/`arguments` and the usage fields are the
 * genuine wire shapes, so the mapper is verified against reality instead of a
 * hand-written guess.
 */
import { readFileSync } from 'node:fs';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const capturePath = fileURLToPath(new URL('./codex-0.145.0-mcp-capture.jsonl', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const lines = readFileSync(capturePath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    stdout.write(line + '\n');
    await sleep(2);
  }
}

await main();
