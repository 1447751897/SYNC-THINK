#!/usr/bin/env node
/**
 * Codex exec JSONL fixture for kernel adapter tests.
 *
 * Mimics the verified wire protocol of codex-cli 0.145.0 `exec --json`:
 *   - thread.started → turn.started
 *   - item.started/item.completed pairs (command_execution, reasoning,
 *     agent_message) with atomic items (no partial/delta events)
 *   - turn.completed with usage, then exit
 *
 * Also exercises the adapter's tolerance paths: a plain-text warning line
 * (real codex prints "Reading additional input from stdin..." before the JSON
 * stream) and an unknown event type — both must be ignored, never fatal (§4.1).
 *
 * The spawn args in argv are ignored; the fixture is driven purely by its own
 * scripted sequence (codex exec stdin is 'ignore'). Set FIXTURE_FAIL=1 to emit
 * the real failure sequence (error item → error event → turn.failed) instead.
 */
import { env, stderr, stdout } from 'node:process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixtureMode = env.FIXTURE_MODE ?? '';

function emit(value) {
  stdout.write(JSON.stringify(value) + '\n');
}

async function main() {
  emit({ type: 'thread.started', thread_id: 'thread_fixture_1' });

  if (fixtureMode === 'exit-without-terminal') {
    stderr.write('Codex fixture exploded: OPENAI_API_KEY=sk-fixture-secret-123456789\n');
    process.exitCode = 9;
    stdout.end();
    return;
  }

  if (fixtureMode === 'terminal-without-newline') {
    stdout.write(
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          input_tokens: 3,
          output_tokens: 2,
        },
      }),
    );
    stdout.end();
    return;
  }

  if (fixtureMode === 'transient-reconnect-then-success') {
    emit({ type: 'turn.started' });
    emit({
      type: 'error',
      message:
        'Reconnecting... 1/5 (stream disconnected before completion: Our servers are currently overloaded. Please try again later.)',
    });
    await sleep(20);
    emit({
      type: 'item.completed',
      item: {
        id: 'msg_after_reconnect',
        type: 'agent_message',
        text: 'recovered after reconnect',
        status: 'completed',
      },
    });
    emit({
      type: 'turn.completed',
      usage: {
        input_tokens: 8,
        output_tokens: 4,
      },
    });
    stdout.end();
    return;
  }

  if (env.FIXTURE_FAIL === '1') {
    // Real failure sequence captured from codex 0.145.0: metadata error item,
    // then the authoritative error event (JSON-wrapped API error), then
    // turn.failed with the nested error object.
    await sleep(10);
    emit({
      type: 'item.completed',
      item: { id: 'item_0', type: 'error', message: 'Model metadata for gpt-5 not found.' },
    });
    emit({ type: 'turn.started' });
    await sleep(10);
    emit({
      type: 'error',
      message:
        '{"error":{"code":"unsupported_value","message":"Unsupported value: max","param":"reasoning.effort","type":"invalid_request_error"}}',
    });
    emit({
      type: 'turn.failed',
      error: {
        message:
          '{"error":{"code":"unsupported_value","message":"Unsupported value: max","param":"reasoning.effort","type":"invalid_request_error"}}',
      },
    });
    stdout.end();
    return;
  }

  emit({ type: 'turn.started' });
  await sleep(10);

  // Plain-text line that real codex can print before the JSON stream.
  stdout.write('Reading additional input from stdin...\n');
  await sleep(10);

  emit({
    type: 'item.started',
    item: { id: 'call_fixture_1', type: 'command_execution', command: 'echo hello' },
  });
  await sleep(10);
  emit({
    type: 'item.completed',
    item: {
      id: 'call_fixture_1',
      type: 'command_execution',
      command: 'echo hello',
      status: 'completed',
      aggregated_output: 'hello\n',
      exit_code: 0,
    },
  });
  await sleep(10);

  // Unknown event types are ignored + logged, never fatal.
  emit({ type: 'future_unknown_event_type', payload: { version: 999 } });
  await sleep(10);

  emit({
    type: 'item.completed',
    item: {
      id: 'msg_fixture_1',
      type: 'agent_message',
      text: 'fixture answer text',
      status: 'completed',
    },
  });
  await sleep(10);

  emit({
    type: 'item.started',
    item: { id: 'rea_fixture_1', type: 'reasoning', text: 'thinking fixture' },
  });
  await sleep(10);
  emit({
    type: 'item.completed',
    item: { id: 'rea_fixture_1', type: 'reasoning', text: 'thinking fixture', status: 'completed' },
  });
  await sleep(10);

  emit({
    type: 'turn.completed',
    usage: {
      input_tokens: 10,
      cached_input_tokens: 5,
      cache_write_input_tokens: 3,
      output_tokens: 7,
      reasoning_output_tokens: 2,
    },
  });
  stdout.end();
}

main().catch((error) => {
  stdout.write(JSON.stringify({ type: 'error', message: String(error) }) + '\n');
  stdout.end();
});
