import { randomBytes } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const supportedModes = ['continue', 'cancel-close-page', 'cancel-keep-open'];
const requestedMode = process.argv[2] ?? 'all';

if (requestedMode !== 'all' && !supportedModes.includes(requestedMode)) {
  throw new Error(
    `Unknown mode ${JSON.stringify(requestedMode)}. Use continue, cancel-close-page, cancel-keep-open, or all.`,
  );
}

const node20 = await resolveNode20();
const currentNodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
if (currentNodeMajor !== 20) {
  const result = spawnSync(node20, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, SYNC_THINK_NODE_BIN: node20 },
    windowsHide: false,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const workersRequire = createRequire(join(repo, 'packages', 'workers', 'package.json'));
const { _electron, chromium } = workersRequire('playwright-core');

const storageEntry = join(repo, 'packages', 'storage', 'dist', 'index.js');
const secureStoreEntry = join(repo, 'packages', 'secure-store', 'dist', 'index.js');
const electronPath = join(
  repo,
  'apps',
  'desktop',
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);

for (const requiredPath of [storageEntry, secureStoreEntry, electronPath]) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Missing E2E prerequisite: ${requiredPath}. Build the workspace first.`);
  }
}

const storage = await import(pathToFileURL(storageEntry).href);
const secure = await import(pathToFileURL(secureStoreEntry).href);
const {
  runMigrations,
  openDatabaseAsync,
  SqliteProviderStore,
  SqliteAgentStore,
  SqliteBrowserStore,
  SqliteOrchestrationStore,
  SqliteConversationStore,
} = storage;
const { SecureStore, XorDevBackend } = secure;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForCondition(label, predicate, timeoutMs = 60_000, intervalMs = 250) {
  const startedAt = Date.now();
  let lastValue;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await predicate();
    if (lastValue) return lastValue;
    await sleep(intervalMs);
  }
  throw new Error(
    `${label} did not become true in ${timeoutMs}ms; last=${JSON.stringify(lastValue)}`,
  );
}

async function binaryNodeMajor(binary) {
  try {
    const { stdout } = await execFileAsync(binary, ['-p', 'process.versions.node'], {
      timeout: 3_000,
      windowsHide: true,
    });
    return Number.parseInt(stdout.trim().split('.')[0] ?? '', 10);
  } catch {
    return null;
  }
}

async function resolveNode20() {
  const executableName = process.platform === 'win32' ? 'node.exe' : 'node';
  const candidates = [process.env.SYNC_THINK_NODE_BIN, process.execPath];
  const localAppData = process.env.LOCALAPPDATA;
  if (process.platform === 'win32' && localAppData) {
    const managedRoot = join(localAppData, 'pnpm', 'nodejs');
    if (existsSync(managedRoot)) {
      for (const version of readdirSync(managedRoot).sort().reverse()) {
        if (version.startsWith('20.')) candidates.push(join(managedRoot, version, executableName));
      }
    }
  }
  for (const pathEntry of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    candidates.push(join(pathEntry, executableName));
  }
  candidates.push(executableName);

  const seen = new Set();
  for (const candidate of candidates.filter(Boolean)) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue;
    if ((await binaryNodeMajor(candidate)) === 20) return candidate;
  }
  throw new Error('Could not find Node 20. Set SYNC_THINK_NODE_BIN to a Node 20 executable.');
}

function resolveBrowserExecutable() {
  const candidates = [
    process.env.SYNC_THINK_BROWSER_EXECUTABLE,
    process.platform === 'win32'
      ? join(
          process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
          'Microsoft/Edge/Application/msedge.exe',
        )
      : undefined,
    process.platform === 'win32'
      ? join(
          process.env.ProgramFiles ?? 'C:/Program Files',
          'Microsoft/Edge/Application/msedge.exe',
        )
      : undefined,
    process.platform === 'win32'
      ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe')
      : undefined,
    process.platform === 'win32'
      ? join(
          process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
          'Google/Chrome/Application/chrome.exe',
        )
      : undefined,
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error('Could not find system Edge or Chrome. Set SYNC_THINK_BROWSER_EXECUTABLE.');
  }
  return executable;
}

async function closeDesktop(app, label) {
  const child = app.process();
  const exited = new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveExit();
      return;
    }
    child.once('exit', resolveExit);
  });
  void app.close().catch((error) => {
    console.log(`[close:${label}] app.close failed`, String(error));
  });
  await Promise.race([
    exited,
    sleep(30_000).then(() => {
      throw new Error(`Desktop ${label} did not exit in 30000ms`);
    }),
  ]);
  console.log(`[close:${label}] desktop process exited`, child.exitCode, child.signalCode);
}

async function readMetadata(metadataPath) {
  return JSON.parse(await readFile(metadataPath, 'utf8'));
}

async function fetchCdpJson(metadata, pathname, timeoutMs = 3_000) {
  const response = await fetch(`${metadata.cdpEndpoint}${pathname}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`CDP ${pathname} returned HTTP ${response.status}`);
  return response.json();
}

async function isCdpAvailable(metadata) {
  try {
    await fetchCdpJson(metadata, '/json/version');
    return true;
  } catch {
    return false;
  }
}

async function countLoginTargets(metadata, loginUrl) {
  const targets = await fetchCdpJson(metadata, '/json/list');
  return targets.filter((target) => target.type === 'page' && target.url === loginUrl).length;
}

async function probePersistedBrowser(label, metadata, temp) {
  try {
    const version = await fetchCdpJson(metadata, '/json/version');
    console.log(`[probe:${label}] cdp available`, version.Browser ?? '<unknown browser>');
  } catch (error) {
    console.log(`[probe:${label}] cdp unavailable`, String(error));
  }

  if (process.platform !== 'win32') return;
  const escapedTemp = temp.replaceAll("'", "''");
  const powershell = [
    "$ErrorActionPreference='SilentlyContinue'",
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*${escapedTemp}*' -and $_.Name -match 'msedge|chrome' } | ForEach-Object { Write-Output (\"$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)\") }`,
  ].join('; ');
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', powershell],
      { windowsHide: true },
    );
    console.log(`[probe:${label}] browser processes`, stdout.trim() || '<none>');
  } catch (error) {
    console.log(`[probe:${label}] process query failed`, String(error));
  }
}

async function closeBrowserViaCdp(metadata) {
  if (!metadata || !(await isCdpAvailable(metadata))) return;
  let browser;
  try {
    browser = await chromium.connectOverCDP(metadata.cdpEndpoint, { timeout: 5_000 });
    const session = await browser.newBrowserCDPSession();
    await session.send('Browser.close').catch(() => undefined);
    await waitForCondition(
      'test browser shutdown',
      async () => !(await isCdpAvailable(metadata)),
      10_000,
    );
  } catch (error) {
    console.log('[cleanup] Browser.close failed', String(error));
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function stopFixtureBrowserProcesses(temp) {
  if (process.platform !== 'win32') return;
  const escapedTemp = temp.replaceAll("'", "''");
  const powershell = [
    "$ErrorActionPreference='SilentlyContinue'",
    `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like '*${escapedTemp}*' -and $_.Name -match 'msedge|chrome' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ].join('; ');
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', powershell], {
    windowsHide: true,
  }).catch(() => undefined);
}

async function closeServer(server) {
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise((resolveClose) => server.close(resolveClose));
}

function createProviderServer(onCancel, state) {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && requestUrl.pathname === '/login') {
      state.loginRequests += 1;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><html><head><title>SYNC-THINK Handoff Login</title></head><body><h1>Human login checkpoint</h1><p id="state">ready-for-human</p></body></html>',
      );
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ object: 'list', data: [{ id: 'handoff-model', object: 'model' }] }),
      );
      return;
    }
    if (request.method === 'POST' && requestUrl.pathname === '/v1/chat/completions') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      state.providerRequests.push(parsed);
      const hasToolResult =
        Array.isArray(parsed.messages) &&
        parsed.messages.some((message) => message.role === 'tool');
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      if (!hasToolResult) {
        const openArguments = JSON.stringify({ url: `${state.origin}/login` });
        const handoffArguments = JSON.stringify({
          reason: 'login',
          requestedOutcome: 'Complete the local sign-in checkpoint.',
          onCancel,
        });
        response.write(
          `data: ${JSON.stringify({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'handoff-open-call',
                      type: 'function',
                      function: { name: 'browser_open', arguments: openArguments },
                    },
                    {
                      index: 1,
                      id: 'handoff-user-call',
                      type: 'function',
                      function: { name: 'browser_handoff', arguments: handoffArguments },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          })}\n\n`,
        );
      } else {
        response.write(
          `data: ${JSON.stringify({
            choices: [
              {
                index: 0,
                delta: { content: 'The signed-in workflow completed.' },
                finish_reason: 'stop',
              },
            ],
          })}\n\n`,
        );
      }
      response.end('data: [DONE]\n\n');
      return;
    }
    response.writeHead(404);
    response.end('not found');
  });
}

async function seedFixture({ dbPath, keyPath, temp, origin }) {
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const secureStore = new SecureStore(new XorDevBackend(keyPath));
  try {
    const secret = await secureStore.storeSecret('handoff-provider-secret');
    const providerStore = new SqliteProviderStore(connection.raw);
    const provider = providerStore.createProvider({
      name: 'Handoff E2E provider',
      baseUrl: `${origin}/v1`,
      protocol: 'openai-chat',
      supportsDiscovery: false,
      storeHandle: secret,
    });
    const model = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [{ providerModelId: 'handoff-model' }],
    })[0];
    const now = new Date().toISOString();
    connection.raw
      .prepare(
        'INSERT INTO workspace (id, folder_path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('workspace-handoff', temp, 'Handoff E2E', now, now);
    connection.raw
      .prepare(
        "INSERT INTO task (id, workspace_id, title, goal, status, participation_mode, acceptance_criteria_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 'automatic', '[]', 0, ?, ?)",
      )
      .run('task-handoff', 'workspace-handoff', 'Browser handoff task', 'Complete login', now, now);
    connection.raw
      .prepare('INSERT INTO thread (id, task_id, created_at) VALUES (?, ?, ?)')
      .run('thread-handoff', 'task-handoff', now);
    const agent = new SqliteAgentStore(connection.raw).createAgent({
      name: 'Handoff worker',
      role: 'worker',
      developerInstructions: 'Complete the browser login workflow.',
      inputContract: 'step instructions',
      outputContract: 'text artifact',
      defaultModelId: model.id,
      defaultCredentialGroupId: provider.credentialGroup.id,
      approvalMode: 'full',
    });
    connection.raw
      .prepare('UPDATE model SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify(['text', 'tool-calling']), model.id);
    connection.raw
      .prepare('UPDATE agent_version SET permissions_json = ? WHERE id = ?')
      .run(
        JSON.stringify({ file: [], command: [], browser: [origin], desktop: [], network: [] }),
        agent.id,
      );
    new SqliteBrowserStore(connection.raw).upsertOriginGrant({
      scopeType: 'agent-version',
      scopeId: agent.id,
      origin,
      action: 'navigate',
      decision: 'allow',
      approvalId: 'preapproved-browser-open',
    });
    const orchestration = new SqliteOrchestrationStore(connection.raw);
    const plan = orchestration.createPlanDraft({
      taskId: 'task-handoff',
      title: 'Browser handoff run',
      steps: [
        {
          id: 'step-handoff',
          title: 'Sign in',
          instructions: 'Open the login page and request human handoff.',
          agentVersionId: agent.id,
          dependsOn: [],
        },
      ],
      now,
    });
    const graph = orchestration.approvePlan({ planId: plan.planId, revision: 1, now });
    const conversationStore = new SqliteConversationStore(connection.raw);
    const conversation = conversationStore.create({
      id: 'conv-handoff',
      target: { track: 'model', modelId: model.id },
      workspaceId: 'workspace-handoff',
      title: 'Browser handoff',
      executionMode: 'full-access',
      now,
    });
    conversationStore.bindTask(conversation.id, 'task-handoff', now);
    return { runId: graph.run.id };
  } finally {
    secureStore.shutdown();
    connection.raw.close();
  }
}

async function launchDesktop({ label, env, userData }) {
  const logs = [];
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [join(repo, 'apps', 'desktop'), `--user-data-dir=${userData}`],
    cwd: join(repo, 'apps', 'desktop'),
    env,
    timeout: 30_000,
  });
  app.process().stdout?.on('data', (chunk) => {
    const text = chunk.toString();
    logs.push(text);
    process.stdout.write(`[${label}:out] ${text}`);
  });
  app.process().stderr?.on('data', (chunk) => {
    const text = chunk.toString();
    logs.push(text);
    process.stderr.write(`[${label}:err] ${text}`);
  });
  const page = await app.firstWindow();
  page.on('console', (message) =>
    console.log(`[${label}:console:${message.type()}]`, message.text()),
  );
  page.on('pageerror', (error) => console.error(`[${label}:pageerror]`, error));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 720 });
  return { app, page, logs };
}

async function openConversation(page) {
  const item = page.getByText('Browser handoff', { exact: true }).first();
  await item.waitFor({ state: 'visible', timeout: 30_000 });
  await item.click();
}

async function waitForHandoffCard(page, label) {
  const card = page.getByText('\u4efb\u52a1\u5df2\u6682\u505c', { exact: true });
  try {
    await card.waitFor({ state: 'visible', timeout: 60_000 });
  } catch (error) {
    console.log(`[${label}] body`, (await page.locator('body').innerText()).slice(0, 12_000));
    throw error;
  }
  return card;
}

async function waitForFinalDatabaseState(dbPath, runId, expectedRunState) {
  const connection = await openDatabaseAsync({ path: dbPath });
  try {
    return await waitForCondition('final browser handoff database state', () => {
      const run = connection.raw.prepare('SELECT state FROM run WHERE id = ?').get(runId);
      const handoff = connection.raw
        .prepare(
          "SELECT state, error_code AS errorCode FROM browser_command WHERE tool_name = 'browser_handoff' ORDER BY created_at DESC LIMIT 1",
        )
        .get();
      if (run?.state !== expectedRunState) return undefined;
      return { run, handoff };
    });
  } finally {
    connection.raw.close();
  }
}

async function runScenario(mode, node20, browserExecutable) {
  const onCancel = mode === 'cancel-close-page' ? 'close-page' : 'keep-open';
  const temp = await mkdtemp(join(tmpdir(), `sync-think-electron-handoff-${mode}-`));
  const dbPath = join(temp, 'sync-think.db');
  const keyPath = join(temp, 'secure', 'key.bin');
  const localAppData = join(temp, 'local-app-data');
  const userData = join(temp, 'desktop-user-data');
  const shots = join(temp, 'shots');
  const metadataPath = join(temp, 'browser-profiles', 'default', '.sync-think-cdp-session.json');
  await mkdir(shots, { recursive: true });

  const state = { origin: '', providerRequests: [], loginRequests: 0 };
  const server = createProviderServer(onCancel, state);
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  state.origin = `http://127.0.0.1:${address.port}`;
  const loginUrl = `${state.origin}/login`;
  const fixture = await seedFixture({ dbPath, keyPath, temp, origin: state.origin });
  const installId = `handoff-e2e-${mode}-${randomBytes(4).toString('hex')}`;
  const env = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    SYNC_THINK_DB_PATH: dbPath,
    SYNC_THINK_SECURE_KEY_PATH: keyPath,
    SYNC_THINK_INSTALL_ID: installId,
    SYNC_THINK_DEV_NO_TOKEN: '1',
    SYNC_THINK_DISABLE_DEMO_PROVIDER: '1',
    SYNC_THINK_BROWSER_EXECUTABLE: browserExecutable,
    SYNC_THINK_NODE_BIN: node20,
    SYNC_THINK_RUNTIME_FORCE_RESTART: '1',
    SYNC_THINK_SHELL: '1',
  };

  console.log(`\n=== browser handoff E2E: ${mode} ===`);
  console.log('temp', temp);
  console.log('origin', state.origin);

  let first;
  let second;
  let metadata;
  try {
    first = await launchDesktop({ label: `${mode}:first`, env, userData });
    await openConversation(first.page);
    await waitForHandoffCard(first.page, `${mode}:first`);
    await first.page.screenshot({ path: join(shots, '01-before-restart.png'), fullPage: true });

    assert(
      state.providerRequests.length === 1,
      `Expected 1 provider request, got ${state.providerRequests.length}`,
    );
    assert(state.loginRequests === 1, `Expected 1 login request, got ${state.loginRequests}`);
    await waitForCondition('browser metadata file', () => existsSync(metadataPath));
    metadata = await readMetadata(metadataPath);
    assert(
      (await countLoginTargets(metadata, loginUrl)) === 1,
      'Expected one login target before Desktop restart.',
    );
    await probePersistedBrowser(`${mode}:before-first-close`, metadata, temp);

    await closeDesktop(first.app, `${mode}:first`);
    first = undefined;
    await waitForCondition('CDP survival after first Desktop close', () =>
      isCdpAvailable(metadata),
    );
    assert(existsSync(metadataPath), 'Browser metadata disappeared while a handoff was waiting.');
    assert(
      (await countLoginTargets(metadata, loginUrl)) === 1,
      'Expected the same login target to survive Desktop restart.',
    );
    await probePersistedBrowser(`${mode}:after-first-close`, metadata, temp);

    second = await launchDesktop({ label: `${mode}:second`, env, userData });
    await openConversation(second.page);
    const card = await waitForHandoffCard(second.page, `${mode}:second`);
    await second.page.screenshot({ path: join(shots, '02-after-restart.png'), fullPage: true });
    assert(
      state.providerRequests.length === 1,
      'Provider request replayed during Desktop restart.',
    );
    assert(state.loginRequests === 1, 'browser_open replayed during Desktop restart.');

    if (mode === 'continue') {
      await second.page
        .getByRole('button', { name: '\u6211\u5df2\u5b8c\u6210\uff0c\u7ee7\u7eed' })
        .click();
      await card.waitFor({ state: 'hidden', timeout: 60_000 });
      await waitForCondition(
        'provider continuation request',
        () => state.providerRequests.length === 2,
      );
      const finalState = await waitForFinalDatabaseState(dbPath, fixture.runId, 'completed');
      assert(
        finalState.handoff?.state === 'completed',
        'browser_handoff command did not complete.',
      );
      assert(finalState.handoff?.errorCode == null, 'Completed handoff has an error code.');
      assert(state.loginRequests === 1, 'browser_open replayed after Continue.');
      await second.page.screenshot({ path: join(shots, '03-after-continue.png'), fullPage: true });
      console.log('final DB', finalState);
    } else {
      const buttonName =
        mode === 'cancel-close-page'
          ? '\u53d6\u6d88\u5e76\u5173\u95ed\u9875\u9762'
          : '\u53d6\u6d88\u672c\u6b21\u64cd\u4f5c';
      await second.page.getByRole('button', { name: buttonName }).click();
      await card.waitFor({ state: 'hidden', timeout: 60_000 });
      const finalState = await waitForFinalDatabaseState(dbPath, fixture.runId, 'failed');
      assert(
        finalState.handoff?.state === 'failed',
        'Cancelled browser_handoff command did not fail.',
      );
      assert(
        finalState.handoff?.errorCode === 'browser.handoff-cancelled',
        `Unexpected handoff error code: ${finalState.handoff?.errorCode}`,
      );
      assert(state.providerRequests.length === 1, 'Provider continued after handoff cancellation.');
      assert(state.loginRequests === 1, 'browser_open replayed after handoff cancellation.');
      const expectedTargetCount = mode === 'cancel-close-page' ? 0 : 1;
      await waitForCondition(
        `login target count ${expectedTargetCount}`,
        async () => (await countLoginTargets(metadata, loginUrl)) === expectedTargetCount,
      );
      await second.page.screenshot({
        path: join(shots, `03-after-${mode}.png`),
        fullPage: true,
      });
      console.log('final DB', finalState);
    }

    await closeDesktop(second.app, `${mode}:second`);
    second = undefined;
    await waitForCondition(
      'browser shutdown after resolved handoff',
      async () => !(await isCdpAvailable(metadata)),
    );
    await waitForCondition('browser metadata cleanup', () => !existsSync(metadataPath));
    await probePersistedBrowser(`${mode}:after-second-close`, metadata, temp);

    const expectedProviderRequests = mode === 'continue' ? 2 : 1;
    assert(
      state.providerRequests.length === expectedProviderRequests,
      `Expected ${expectedProviderRequests} provider requests, got ${state.providerRequests.length}`,
    );
    assert(state.loginRequests === 1, `Expected one login request, got ${state.loginRequests}`);
    console.log(`PASS ${mode}`);
    console.log('screenshots', shots);
  } catch (error) {
    if (first?.page) {
      await first.page
        .screenshot({ path: join(shots, 'failure-first.png'), fullPage: true })
        .catch(() => undefined);
    }
    if (second?.page) {
      await second.page
        .screenshot({ path: join(shots, 'failure-second.png'), fullPage: true })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (first) await closeDesktop(first.app, `${mode}:first-finally`).catch(() => undefined);
    if (second) await closeDesktop(second.app, `${mode}:second-finally`).catch(() => undefined);
    if (!metadata && existsSync(metadataPath)) {
      metadata = await readMetadata(metadataPath).catch(() => undefined);
    }
    await closeBrowserViaCdp(metadata);
    await stopFixtureBrowserProcesses(temp);
    await closeServer(server);
    console.log('preserved temp', temp);
  }
}

const browserExecutable = resolveBrowserExecutable();
console.log('repo', repo);
console.log('Node 20', node20);
console.log('browser', browserExecutable);

const modes = requestedMode === 'all' ? supportedModes : [requestedMode];
for (const mode of modes) {
  await runScenario(mode, node20, browserExecutable);
}
console.log(`\nBrowser handoff E2E complete: ${modes.join(', ')}`);
