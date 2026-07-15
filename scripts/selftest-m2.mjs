import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SUITE_TIMEOUT_MS = 120_000;
const MIN_SUITE_TIMEOUT_MS = 5_000;
const MAX_SUITE_TIMEOUT_MS = 600_000;
const STDERR_TAIL_BYTES = 64 * 1024;
const MARKER_LINE_BYTES = 16 * 1024;
const MARKER_PREFIX = 'M2_EXIT_SUMMARY=';
const FORCE_KILL_DELAY_MS = 5_000;
const FINAL_CLOSE_DEADLINE_MS = 10_000;
const TERMINATION_COMMAND_TIMEOUT_MS = 4_000;
const expectedExitSummary = {
  sequence: ['design', 'image', 'reviewer-0', 'rework-1', 'reviewer-1'],
  artifactVersionCount: 2,
  evidenceCount: 2,
  limitEventCount: 1,
  duplicateTerminalEventCount: 0,
  secretLikeEvidence: false,
  restartStable: true,
};

const suites = [
  {
    label: 'focused core (plan/dag/artifact/rework/policy/authorization)',
    filter: '@sync-think/core',
    files: [
      'src/plan-revision.test.ts',
      'src/dag.test.ts',
      'src/artifact-merge.test.ts',
      'src/rework-policy.test.ts',
      'src/participation-policy.test.ts',
      'src/scoped-policy.test.ts',
      'src/approval-policy.test.ts',
      'src/capability-authorization.test.ts',
    ],
  },
  {
    label: 'focused storage (agent/orchestration/artifact/reviewer)',
    filter: '@sync-think/storage',
    files: [
      'src/agent-store.test.ts',
      'src/orchestration-store.test.ts',
      'src/artifact-store.test.ts',
      'src/reviewer-rework-store.test.ts',
    ],
  },
  {
    label: 'runtime M2 exit demo',
    filter: '@sync-think/runtime',
    files: ['tests/m2-exit-demo.test.ts'],
    captureExitSummary: true,
  },
  {
    label: 'UI Kit M2 + Agent/Approval',
    filter: '@sync-think/ui-kit',
    files: [
      'tests/PlanRevisionPanel.test.tsx',
      'tests/ExecutionGraphPanel.test.tsx',
      'tests/ArtifactVersionsPanel.test.tsx',
      'tests/ModeSwitch.test.tsx',
      'tests/AgentBindingPanel.test.tsx',
      'tests/AgentWorkspace.test.tsx',
      'tests/ApprovalCenterPanel.test.tsx',
    ],
  },
  {
    label: 'Desktop orchestration payloads + M2 workspace',
    filter: '@sync-think/desktop',
    files: ['tests/orchestration-payloads.test.ts', 'tests/m2-workspace.test.ts'],
  },
];

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function parseSuiteTimeoutMs(env = process.env) {
  const raw = env.SYNC_THINK_M2_SUITE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_SUITE_TIMEOUT_MS;
  if (!/^\d+$/.test(raw)) {
    throw new Error('SYNC_THINK_M2_SUITE_TIMEOUT_MS must be an integer');
  }
  const timeoutMs = Number(raw);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_SUITE_TIMEOUT_MS ||
    timeoutMs > MAX_SUITE_TIMEOUT_MS
  ) {
    throw new Error(
      `SYNC_THINK_M2_SUITE_TIMEOUT_MS must be between ${MIN_SUITE_TIMEOUT_MS} and ${MAX_SUITE_TIMEOUT_MS}`,
    );
  }
  return timeoutMs;
}

function appendBoundedTail(current, chunk, maximumBytes) {
  const next = Buffer.concat([current, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  return next.length <= maximumBytes ? next : next.subarray(next.length - maximumBytes);
}

function createMarkerCapture(enabled) {
  let pending = Buffer.alloc(0);
  let markerCount = 0;
  const markerLines = [];

  const acceptLine = (lineBuffer) => {
    if (!enabled) return;
    const line = stripAnsi(lineBuffer.toString('utf8')).trim();
    if (!line.startsWith(MARKER_PREFIX)) return;
    markerCount += 1;
    if (markerLines.length < 2) markerLines.push(line);
  };

  return {
    consume(chunk) {
      if (!enabled) return;
      pending = Buffer.concat([pending, chunk]);
      let newlineIndex = pending.indexOf(0x0a);
      while (newlineIndex >= 0) {
        acceptLine(pending.subarray(0, newlineIndex));
        pending = pending.subarray(newlineIndex + 1);
        newlineIndex = pending.indexOf(0x0a);
      }
      if (pending.length > MARKER_LINE_BYTES) {
        pending = pending.subarray(pending.length - MARKER_LINE_BYTES);
      }
    },
    finish() {
      if (pending.length > 0) acceptLine(pending);
      pending = Buffer.alloc(0);
      return { markerCount, markerLines: [...markerLines] };
    },
  };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function appendTerminationError(current, error) {
  const nextMessage = errorMessage(error);
  return current ? new Error(`${current.message}; ${nextMessage}`) : new Error(nextMessage);
}

function createChildSpawnOptions(options, platform = process.platform) {
  return {
    ...options,
    detached: platform !== 'win32',
  };
}

function runCheckedTerminationCommand(
  command,
  args,
  options,
  { spawnProcess = spawn, timeoutMs = TERMINATION_COMMAND_TIMEOUT_MS } = {},
) {
  return new Promise((resolveCommand, rejectCommand) => {
    let helper;
    try {
      helper = spawnProcess(command, args, options);
    } catch (error) {
      rejectCommand(new Error(`${command} failed to start: ${errorMessage(error)}`));
      return;
    }

    let settled = false;
    let timer;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      helper.off('error', onError);
      helper.off('close', onClose);
    };
    const resolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveCommand();
    };
    const reject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectCommand(error);
    };
    const onError = (error) => {
      reject(new Error(`${command} failed to start: ${errorMessage(error)}`));
    };
    const onClose = (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const status = code === null ? `signal ${signal ?? 'unknown'}` : String(code);
      reject(new Error(`${command} exited ${status}`));
    };

    helper.once('error', onError);
    helper.once('close', onClose);
    timer = setTimeout(() => {
      let killFailure = '';
      try {
        if (!helper.kill('SIGKILL')) killFailure = '; helper SIGKILL was not accepted';
      } catch (error) {
        killFailure = `; helper kill failed: ${errorMessage(error)}`;
      }
      try {
        helper.unref?.();
      } catch (error) {
        killFailure += `; helper unref failed: ${errorMessage(error)}`;
      }
      reject(new Error(`${command} did not exit within ${timeoutMs}ms${killFailure}`));
      if (helper.exitCode === null) helper.once('error', () => {});
    }, timeoutMs);
  });
}

async function terminateProcessTree(child, options = {}) {
  if (!child.pid || child.exitCode !== null) return;
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    await runCheckedTerminationCommand(
      'taskkill',
      ['/pid', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true, shell: false },
      {
        spawnProcess: options.spawnProcess,
        timeoutMs: options.commandTimeoutMs,
      },
    );
    return;
  }

  const signal = options.force ? 'SIGKILL' : 'SIGTERM';
  const killProcess = options.killProcess ?? process.kill.bind(process);
  try {
    killProcess(-child.pid, signal);
  } catch (error) {
    if (error?.code === 'ESRCH') return;
    throw new Error(`process-group ${signal} failed: ${errorMessage(error)}`);
  }
}

function runProcess(command, args, options) {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    return Promise.reject(new Error(`${options.label} timeout must be a positive integer`));
  }
  const forceKillDelayMs = options.forceKillDelayMs ?? FORCE_KILL_DELAY_MS;
  const finalCloseDeadlineMs = options.finalCloseDeadlineMs ?? FINAL_CLOSE_DEADLINE_MS;
  const terminationCommandTimeoutMs =
    options.terminationCommandTimeoutMs ?? TERMINATION_COMMAND_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(forceKillDelayMs) ||
    forceKillDelayMs < 1 ||
    !Number.isSafeInteger(finalCloseDeadlineMs) ||
    finalCloseDeadlineMs <= forceKillDelayMs ||
    !Number.isSafeInteger(terminationCommandTimeoutMs) ||
    terminationCommandTimeoutMs < 1 ||
    terminationCommandTimeoutMs >= finalCloseDeadlineMs
  ) {
    return Promise.reject(new Error(`${options.label} termination deadlines are invalid`));
  }

  const platform = options.platform ?? process.platform;
  const spawnProcess = options.spawnProcess ?? spawn;
  const killProcess = options.killProcess ?? process.kill.bind(process);
  return new Promise((resolveProcess, rejectProcess) => {
    let child;
    try {
      child = spawnProcess(
        command,
        args,
        createChildSpawnOptions(
          {
            cwd: options.cwd,
            env: options.env,
            shell: options.shell,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
          platform,
        ),
      );
    } catch (error) {
      rejectProcess(error);
      return;
    }

    const markerCapture = createMarkerCapture(options.captureExitSummary);
    let stderrTail = Buffer.alloc(0);
    let timedOut = false;
    let terminationError;
    let settled = false;
    let childClosed = false;
    let closeCode = 1;
    let closeSignal = null;
    let activeTerminationAttempts = 0;
    let deadlineTimer;
    let forceKillTimer;
    let finalCloseTimer;

    const onStdout = (chunk) => {
      markerCapture.consume(chunk);
      if (options.forwardOutput) process.stdout.write(chunk);
    };
    const onStderr = (chunk) => {
      stderrTail = appendBoundedTail(stderrTail, chunk, STDERR_TAIL_BYTES);
      if (options.forwardOutput) process.stderr.write(chunk);
    };
    const cleanup = () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (finalCloseTimer) clearTimeout(finalCloseTimer);
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('error', onError);
      child.off('close', onClose);
    };
    const resolveResult = () => {
      if (settled) return;
      settled = true;
      const markerResult = markerCapture.finish();
      cleanup();
      resolveProcess({
        code: closeCode,
        signal: closeSignal,
        timedOut,
        timeoutMs: options.timeoutMs,
        terminationError,
        stderrTail: stderrTail.toString('utf8'),
        ...markerResult,
      });
    };
    const rejectResult = (error) => {
      if (settled) return;
      settled = true;
      markerCapture.finish();
      cleanup();
      rejectProcess(error);
    };
    const maybeResolveClosed = () => {
      if (childClosed && (!timedOut || activeTerminationAttempts === 0)) resolveResult();
    };
    const recordTerminationError = (error) => {
      terminationError = appendTerminationError(terminationError, error);
    };
    const fallbackKill = () => {
      if (child.exitCode !== null) return;
      try {
        if (!child.kill('SIGKILL')) {
          recordTerminationError(new Error('direct child SIGKILL was not accepted'));
        }
      } catch (error) {
        recordTerminationError(new Error(`direct child SIGKILL failed: ${errorMessage(error)}`));
      }
    };
    const startTerminationAttempt = (force) => {
      if (settled || childClosed || child.exitCode !== null) return;
      activeTerminationAttempts += 1;
      void terminateProcessTree(child, {
        platform,
        spawnProcess: options.terminationSpawnProcess ?? spawn,
        killProcess,
        force,
        commandTimeoutMs: terminationCommandTimeoutMs,
      })
        .catch((error) => {
          if (settled) return;
          recordTerminationError(error);
          fallbackKill();
        })
        .finally(() => {
          activeTerminationAttempts -= 1;
          maybeResolveClosed();
        });
    };
    const onError = (error) => {
      if (!timedOut) {
        rejectResult(error);
        return;
      }
      recordTerminationError(error);
    };
    const onClose = (code, signal) => {
      childClosed = true;
      closeCode = code ?? 1;
      closeSignal = signal;
      maybeResolveClosed();
    };

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('error', onError);
    child.once('close', onClose);
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      startTerminationAttempt(false);
      forceKillTimer = setTimeout(() => {
        startTerminationAttempt(true);
      }, forceKillDelayMs);
      finalCloseTimer = setTimeout(() => {
        if (!childClosed) {
          recordTerminationError(
            new Error(`child did not close within ${finalCloseDeadlineMs}ms after timeout`),
          );
          fallbackKill();
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref?.();
        }
        if (activeTerminationAttempts > 0) {
          recordTerminationError(
            new Error(`termination attempt exceeded the ${finalCloseDeadlineMs}ms hard deadline`),
          );
        }
        resolveResult();
      }, finalCloseDeadlineMs);
    }, options.timeoutMs);
  });
}

function runSuite(suite, timeoutMs) {
  return runProcess(
    'pnpm',
    ['--filter', suite.filter, 'exec', 'vitest', 'run', '--reporter=dot', ...suite.files],
    {
      label: suite.label,
      timeoutMs,
      cwd: root,
      env: process.env,
      shell: process.platform === 'win32',
      forwardOutput: true,
      captureExitSummary: suite.captureExitSummary === true,
    },
  );
}

function assertSuiteSucceeded(label, result) {
  if (result.terminationError) {
    throw new Error(`${label} could not terminate after timeout: ${result.terminationError}`);
  }
  if (result.timedOut) {
    throw new Error(`${label} timed out after ${result.timeoutMs}ms`);
  }
  if (result.code !== 0) {
    const signal = result.signal ? ` (${result.signal})` : '';
    const stderr = result.stderrTail ? `\nstderr tail:\n${result.stderrTail}` : '';
    throw new Error(`${label} exited ${result.code}${signal}${stderr}`);
  }
}

function parseExitSummary(capture) {
  if (capture.markerCount !== 1 || capture.markerLines.length !== 1) {
    throw new Error(`Expected exactly one M2_EXIT_SUMMARY marker, received ${capture.markerCount}`);
  }

  const encoded = capture.markerLines[0].slice(MARKER_PREFIX.length);
  let summary;
  try {
    summary = JSON.parse(encoded);
  } catch (error) {
    throw new Error(`M2_EXIT_SUMMARY is not valid single-line JSON: ${error.message}`);
  }
  const expected = JSON.stringify(expectedExitSummary);
  const actual = JSON.stringify(summary);
  if (actual !== expected || encoded !== expected) {
    throw new Error(`M2_EXIT_SUMMARY mismatch\nexpected: ${expected}\nactual:   ${actual}`);
  }
  return summary;
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessRunning(pid)) {
    if (Date.now() >= deadline) throw new Error(`Process tree member ${pid} is still running`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

function createControlledProcess(pid = 42_424) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killSignals = [];
  child.kill = (signal) => {
    child.killSignals.push(signal);
    return true;
  };
  child.unrefCalls = 0;
  child.unref = () => {
    child.unrefCalls += 1;
  };
  return child;
}

async function runSelftestWorkflow(options = {}) {
  const suiteList = options.suiteList ?? suites;
  const runHarness = options.runHarness ?? runControlledSelfTests;
  const runSuiteProcess = options.runSuiteProcess ?? runSuite;
  const log = options.log ?? console.log;

  await runHarness();
  const suiteTimeoutMs = options.suiteTimeoutMs ?? parseSuiteTimeoutMs();
  log(
    `[M2 selftest] starting ${suiteList.length} sequential suites (${suiteTimeoutMs}ms deadline each)`,
  );
  let exitSummary;
  for (const [index, suite] of suiteList.entries()) {
    log(`[M2 selftest] ${index + 1}/${suiteList.length} ${suite.label}`);
    const result = await runSuiteProcess(suite, suiteTimeoutMs);
    assertSuiteSucceeded(suite.label, result);
    if (suite.captureExitSummary) exitSummary = parseExitSummary(result);
    log(`[M2 selftest] ${index + 1}/${suiteList.length} PASS`);
  }
  if (!exitSummary) throw new Error('Runtime suite did not provide M2 exit evidence');
  log(`[M2 selftest] PASS ${suiteList.length}/${suiteList.length}`);
}

async function main() {
  await runSelftestWorkflow();
}

async function runControlledSelfTests() {
  assert.equal(parseSuiteTimeoutMs({}), 120_000);
  assert.equal(parseSuiteTimeoutMs({ SYNC_THINK_M2_SUITE_TIMEOUT_MS: '5000' }), 5_000);
  assert.throws(
    () => parseSuiteTimeoutMs({ SYNC_THINK_M2_SUITE_TIMEOUT_MS: '4999' }),
    /between 5000 and 600000/,
  );

  const spawnOptions = {
    cwd: root,
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  assert.equal(createChildSpawnOptions(spawnOptions, 'linux').detached, true);
  assert.equal(createChildSpawnOptions(spawnOptions, 'win32').detached, false);

  const taskkillCalls = [];
  const successfulTaskkillSpawn = (command, args, options) => {
    taskkillCalls.push({ command, args, options });
    const helper = createControlledProcess(50_001);
    queueMicrotask(() => {
      helper.exitCode = 0;
      helper.emit('close', 0, null);
    });
    return helper;
  };
  await terminateProcessTree(createControlledProcess(50_000), {
    platform: 'win32',
    spawnProcess: successfulTaskkillSpawn,
    commandTimeoutMs: 100,
  });
  assert.deepEqual(taskkillCalls, [
    {
      command: 'taskkill',
      args: ['/pid', '50000', '/T', '/F'],
      options: { stdio: 'ignore', windowsHide: true, shell: false },
    },
  ]);

  const nonzeroTaskkillSpawn = () => {
    const helper = createControlledProcess(50_002);
    queueMicrotask(() => {
      helper.exitCode = 5;
      helper.emit('close', 5, null);
    });
    return helper;
  };
  await assert.rejects(
    terminateProcessTree(createControlledProcess(50_003), {
      platform: 'win32',
      spawnProcess: nonzeroTaskkillSpawn,
      commandTimeoutMs: 100,
    }),
    /taskkill exited 5/,
  );

  const failedTaskkillSpawn = () => {
    const helper = createControlledProcess(50_004);
    queueMicrotask(() => helper.emit('error', new Error('controlled spawn denied')));
    return helper;
  };
  await assert.rejects(
    terminateProcessTree(createControlledProcess(50_005), {
      platform: 'win32',
      spawnProcess: failedTaskkillSpawn,
      commandTimeoutMs: 100,
    }),
    /taskkill failed to start.*controlled spawn denied/,
  );

  const hangingTaskkill = createControlledProcess(50_008);
  await assert.rejects(
    terminateProcessTree(createControlledProcess(50_009), {
      platform: 'win32',
      spawnProcess: () => hangingTaskkill,
      commandTimeoutMs: 20,
    }),
    /taskkill did not exit within 20ms/,
  );
  assert.deepEqual(hangingTaskkill.killSignals, ['SIGKILL']);
  assert.equal(hangingTaskkill.unrefCalls, 1);

  const groupKillCalls = [];
  const groupTarget = createControlledProcess(50_006);
  await terminateProcessTree(groupTarget, {
    platform: 'linux',
    killProcess: (pid, signal) => groupKillCalls.push([pid, signal]),
  });
  await terminateProcessTree(groupTarget, {
    platform: 'linux',
    force: true,
    killProcess: (pid, signal) => groupKillCalls.push([pid, signal]),
  });
  assert.deepEqual(groupKillCalls, [
    [-50_006, 'SIGTERM'],
    [-50_006, 'SIGKILL'],
  ]);

  const neverClosingChild = createControlledProcess(50_007);
  const hardDeadlineStartedAt = Date.now();
  const hardDeadlineResult = await Promise.race([
    runProcess('controlled-never-close', [], {
      label: 'controlled hard termination deadline',
      timeoutMs: 10,
      cwd: root,
      env: process.env,
      shell: false,
      forwardOutput: false,
      captureExitSummary: false,
      platform: 'linux',
      spawnProcess: () => neverClosingChild,
      killProcess: () => {},
      forceKillDelayMs: 15,
      finalCloseDeadlineMs: 50,
      terminationCommandTimeoutMs: 20,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('controlled runner remained pending')), 500),
    ),
  ]);
  assert.equal(hardDeadlineResult.timedOut, true);
  assert.match(String(hardDeadlineResult.terminationError), /did not close within 50ms/);
  assert.ok(Date.now() - hardDeadlineStartedAt < 500);
  assert.equal(neverClosingChild.unrefCalls, 1);
  assert.equal(neverClosingChild.stdout.destroyed, true);
  assert.equal(neverClosingChild.stderr.destroyed, true);

  assert.throws(
    () =>
      assertSuiteSucceeded('controlled termination failure', {
        timedOut: true,
        timeoutMs: 10,
        terminationError: new Error('taskkill exited 5'),
        code: 1,
        signal: null,
        stderrTail: '',
      }),
    /could not terminate after timeout.*taskkill exited 5/,
  );

  const failureTail = 'CONTROLLED_FAILURE_TAIL';
  const failure = await runProcess(
    process.execPath,
    ['-e', `process.stderr.write('x'.repeat(80 * 1024) + '${failureTail}'); process.exit(7)`],
    {
      label: 'controlled failure',
      timeoutMs: 2_000,
      cwd: root,
      env: process.env,
      shell: false,
      forwardOutput: false,
      captureExitSummary: false,
    },
  );
  assert.equal(failure.code, 7);
  assert.equal(failure.timedOut, false);
  assert.ok(Buffer.byteLength(failure.stderrTail, 'utf8') <= 64 * 1024);
  assert.ok(failure.stderrTail.endsWith(failureTail));
  assert.throws(() => assertSuiteSucceeded('controlled failure', failure), /exited 7/);

  const marker = `M2_EXIT_SUMMARY=${JSON.stringify(expectedExitSummary)}`;
  const markerCapture = await runProcess(
    process.execPath,
    ['-e', `process.stdout.write('y'.repeat(256 * 1024) + '\\n${marker}\\n')`],
    {
      label: 'controlled marker capture',
      timeoutMs: 2_000,
      cwd: root,
      env: process.env,
      shell: false,
      forwardOutput: false,
      captureExitSummary: true,
    },
  );
  assert.equal(markerCapture.code, 0);
  assert.equal(markerCapture.markerCount, 1);
  assert.deepEqual(markerCapture.markerLines, [marker]);
  assert.equal(Object.hasOwn(markerCapture, 'stdout'), false);

  const timeoutProgram = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); process.stderr.write('GRANDCHILD_PID='+child.pid+'\\n'); setInterval(()=>{},1000);`;
  const timedOut = await runProcess(process.execPath, ['-e', timeoutProgram], {
    label: 'controlled timeout',
    timeoutMs: 150,
    cwd: root,
    env: process.env,
    shell: false,
    forwardOutput: false,
    captureExitSummary: false,
  });
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.terminationError, undefined);
  assert.throws(() => assertSuiteSucceeded('controlled timeout', timedOut), /timed out/);
  const grandchildPid = Number(/GRANDCHILD_PID=(\d+)/.exec(timedOut.stderrTail)?.[1]);
  assert.ok(Number.isSafeInteger(grandchildPid));
  await waitForProcessExit(grandchildPid, 2_000);

  const workflowOrder = [];
  const controlledSuites = suites.map((suite, index) => ({
    ...suite,
    label: `controlled suite ${index + 1}`,
  }));
  await runSelftestWorkflow({
    suiteList: controlledSuites,
    suiteTimeoutMs: 5_000,
    runHarness: async () => workflowOrder.push('harness'),
    runSuiteProcess: async (suite) => {
      workflowOrder.push(suite.label);
      return {
        code: 0,
        signal: null,
        timedOut: false,
        timeoutMs: 5_000,
        terminationError: undefined,
        stderrTail: '',
        markerCount: suite.captureExitSummary ? 1 : 0,
        markerLines: suite.captureExitSummary ? [marker] : [],
      };
    },
    log: () => {},
  });
  assert.equal(controlledSuites.length, 5);
  assert.deepEqual(workflowOrder, [
    'harness',
    'controlled suite 1',
    'controlled suite 2',
    'controlled suite 3',
    'controlled suite 4',
    'controlled suite 5',
  ]);
  console.log('[M2 selftest] controlled failure/timeout paths PASS');
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  const entrypoint = process.argv.includes('--self-test') ? runControlledSelfTests() : main();
  entrypoint.catch((error) => {
    console.error(`[M2 selftest] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
