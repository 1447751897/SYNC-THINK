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
import { env, stderr, stdin, stdout } from 'node:process';

const rl = createInterface({ input: stdin, terminal: false });
const fixtureMode = env.FIXTURE_MODE ?? '';

function emit(value) {
  stdout.write(JSON.stringify(value) + '\n');
}

let awaitingDecision = false;
let userTurnSeen = false;
let finishing = false;

function finish(exitCode = 0) {
  if (finishing) return;
  finishing = true;
  process.exitCode = exitCode;
  rl.close();
  stdin.destroy();
  stdout.end();
}

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
    finish();
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
    emit({ type: 'system', subtype: 'init', session_id: 'fixture-session-1' });
    return;
  }

  if (message.type === 'user' && !userTurnSeen) {
    userTurnSeen = true;
    const text = message.message?.content?.find?.((block) => block?.type === 'text')?.text;
    if (fixtureMode === 'exit-without-terminal') {
      stderr.write('Claude fixture exploded: ANTHROPIC_API_KEY=sk-ant-fixture-secret-123456789\n');
      finish(7);
      return;
    }
    if (fixtureMode === 'terminal-without-newline') {
      stdout.write(JSON.stringify({ type: 'result', subtype: 'success' }));
      finish();
      return;
    }
    if (fixtureMode === 'nested-result-error') {
      emit({
        type: 'result',
        subtype: 'error',
        is_error: true,
        result: {
          error: {
            message: 'Nested Claude gateway failure',
          },
        },
        errors: [{ message: 'Secondary Claude detail' }],
      });
      finish();
      return;
    }
    if (text === 'fixture authentication failure') {
      emit({
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 10,
        retry_delay_ms: 500,
        error_status: 401,
        error: 'authentication_failed',
      });
      finish();
      return;
    }
    // Unknown event types must be ignored + logged, never fatal (§4.1).
    emit({ type: 'future_unknown_event_type', payload: { version: 999 } });
    const assistantEvent = {
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
    };
    emit(assistantEvent);
    if (fixtureMode === 'duplicate-assistant-tool-use') emit(assistantEvent);
    const builtinProbe = fixtureMode === 'builtin-deny-probe';
    emit({
      type: 'control_request',
      request_id: builtinProbe ? 'perm-builtin-1' : 'perm-1',
      request: builtinProbe
        ? {
            subtype: 'can_use_tool',
            tool_name: 'AskUserQuestion',
            input: { questions: [{ question: 'Proceed?', header: 'Ask' }] },
            tool_use_id: 'toolu_fixture_1',
          }
        : {
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
  if (!finishing) stdout.end();
});
