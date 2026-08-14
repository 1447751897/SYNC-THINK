#!/usr/bin/env node
/**
 * Real-capture replay fixture: claude 2.1.222 stream-json with
 * `--include-partial-messages`.
 *
 * `claude-2.1.222-partial-capture.jsonl` was captured from the real CLI on
 * 2026-08-14 (see .data/kernel-capture/cc-capture.mjs) and only trimmed for
 * size + session id. It therefore proves the mapper against genuine shapes:
 *   stream_event content_block_delta (thinking_delta / input_json_delta / text_delta)
 *   assistant messages (tool_use + usage)
 *   top-level `user` tool_result (string content form)
 *
 * The fixture waits for the host's first stdin line (initialize) before
 * replaying, matching the real kernel's "no output until the turn starts".
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const capturePath = fileURLToPath(
  new URL('./claude-2.1.222-partial-capture.jsonl', import.meta.url),
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let started = false;
const rl = createInterface({ input: stdin, terminal: false });
rl.on('line', () => {
  if (started) return;
  started = true;
  void replay();
});

async function replay() {
  const lines = readFileSync(capturePath, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    stdout.write(line + '\n');
    await sleep(2);
  }
  rl.close();
}
