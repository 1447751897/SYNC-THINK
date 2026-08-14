#!/usr/bin/env node
/**
 * Claude Code stream-json fixture for kernel adapter tests.
 *
 * Mimics the verified wire protocol of claude 2.1.222:
 *   - control_request(initialize)  → control_response success + system/init
 *   - user message                 → assistant (text + tool_use + usage),
 *                                    can_use_tool control_request,
 *                                    await control_response decision,
 *                                    result success echoing the decision, then exit
 *
 * Self-contained (no workspace imports); the adapter test spawns this script
 * with the real protocol args in argv (ignored) and drives it over stdin.
 */
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const rl = createInterface({ input: stdin, terminal: false });

function emit(value) {
  stdout.write(JSON.stringify(value) + '\n');
}

let awaitingDecision = false;
let userTurnSeen = false;

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  // After the permission request we expect exactly one control_response.
  if (awaitingDecision) {
    awaitingDecision = false;
    let decision = null;
    try {
      decision = JSON.parse(trimmed);
    } catch {
      decision = null;
    }
    emit({
      type: 'result',
      subtype: 'success',
      response: {
        echoed_decision: decision?.response?.response ?? null,
      },
    });
    stdout.end();
    rl.close();
    return;
  }

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (message.type === 'control_request' && message.request?.subtype === 'initialize') {
    emit({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: message.request_id,
        response: {
          session_id: 'fixture-session-1',
          capabilities: { permission_prompt_tool: 'stdio' },
          models: [{ value: 'default', resolvedModel: 'claude-fixture-model' }],
        },
      },
    });
    emit({ type: 'system', subtype: 'init' });
    return;
  }

  if (message.type === 'user' && !userTurnSeen) {
    userTurnSeen = true;
    // Unknown event types must be ignored + logged, never fatal (§4.1).
    emit({ type: 'future_unknown_event_type', payload: { version: 999 } });
    emit({
      type: 'assistant',
      message: {
        id: 'msg_fixture_1',
        model: 'claude-fixture-model',
        role: 'assistant',
        content: [
          { type: 'text', text: 'fixture assistant text' },
          {
            type: 'tool_use',
            id: 'toolu_fixture_1',
            name: 'fixture_tool',
            input: { arg: 'value' },
          },
        ],
        stop_reason: 'tool_use',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
      },
    });
    emit({
      type: 'control_request',
      request_id: 'perm-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'echo hi' },
        tool_use_id: 'toolu_fixture_1',
      },
    });
    awaitingDecision = true;
    return;
  }
});

rl.on('close', () => {
  stdout.end();
});
