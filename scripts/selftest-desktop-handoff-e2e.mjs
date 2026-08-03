import { randomBytes } from 'node:crypto';
import { execFile, spawn, spawnSync } from 'node:child_process';
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
const supportedModes = ['continue', 'cancel'];
const requestedMode = process.argv[2] ?? 'all';

if (requestedMode !== 'all' && !supportedModes.includes(requestedMode)) {
  throw new Error(`Unknown mode ${JSON.stringify(requestedMode)}. Use continue, cancel, or all.`);
}
if (process.platform !== 'win32') {
  throw new Error('Desktop handoff E2E requires Windows UI Automation.');
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
const { _electron } = workersRequire('playwright-core');
const koffi = workersRequire('koffi');
const user32 = koffi.load('user32.dll');
const keybdEvent = user32.func(
  'void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)',
);

const storageEntry = join(repo, 'packages', 'storage', 'dist', 'index.js');
const secureStoreEntry = join(repo, 'packages', 'secure-store', 'dist', 'index.js');
const electronPath = join(
  repo,
  'apps',
  'desktop',
  'node_modules',
  'electron',
  'dist',
  'electron.exe',
);
const fixtureProject = join(
  repo,
  'packages',
  'workers',
  'src',
  'desktop',
  'fixtures',
  'wpf-handoff',
  'SyncThinkDesktopFixture.csproj',
);

for (const requiredPath of [storageEntry, secureStoreEntry, electronPath, fixtureProject]) {
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
  SqliteWorkspaceStore,
  SqliteConversationStore,
  SqliteAppSettingStore,
} = storage;
const { SecureStore, XorDevBackend } = secure;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForCondition(label, predicate, timeoutMs = 60_000, intervalMs = 200) {
  const startedAt = Date.now();
  let lastValue;
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastValue = await predicate();
      if (lastValue) return lastValue;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const suffix = lastError ? `; error=${String(lastError)}` : `; last=${JSON.stringify(lastValue)}`;
  throw new Error(`${label} did not become true in ${timeoutMs}ms${suffix}`);
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
  const executableName = 'node.exe';
  const candidates = [process.env.SYNC_THINK_NODE_BIN, process.execPath];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
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

async function closeServer(server) {
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise((resolveClose) => server.close(resolveClose));
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

async function closeFixture(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill();
  await Promise.race([
    exited,
    sleep(5_000).then(async () => {
      await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
      }).catch(() => undefined);
    }),
  ]);
}

async function readDurableToolResults(dbPath) {
  const connection = await openDatabaseAsync({ path: dbPath });
  try {
    return connection.raw
      .prepare(
        `SELECT payload_json AS payloadJson
           FROM event
          WHERE type IN ('tool.completed', 'execution.tool.completed')
          ORDER BY sequence`,
      )
      .all()
      .map((row) => {
        const payload = JSON.parse(row.payloadJson);
        assert(typeof payload.result === 'string', 'Durable tool.completed event has no result.');
        return JSON.parse(payload.result);
      });
  } finally {
    connection.raw.close();
  }
}

function sendToolCall(response, id, name, args) {
  response.write(
    `data: ${JSON.stringify({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })}\n\n`,
  );
}

function sendFinalText(response, text) {
  response.write(
    `data: ${JSON.stringify({
      choices: [{ index: 0, delta: { content: text }, finish_reason: 'stop' }],
    })}\n\n`,
  );
}

function createProviderServer(state) {
  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'desktop-handoff-model', object: 'model' }],
          }),
        );
        return;
      }
      if (request.method !== 'POST' || requestUrl.pathname !== '/v1/chat/completions') {
        response.writeHead(404);
        response.end('not found');
        return;
      }

      let body = '';
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      state.providerRequests.push(parsed);
      const toolMessages = Array.isArray(parsed.messages)
        ? parsed.messages.filter((message) => message.role === 'tool')
        : [];
      state.toolResults = await readDurableToolResults(state.dbPath);
      assert(
        state.toolResults.length >= toolMessages.length,
        `Expected at least ${toolMessages.length} durable tool results, got ${state.toolResults.length}.`,
      );

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      if (toolMessages.length === 0) {
        sendToolCall(response, `${state.scenarioId}-list`, 'desktop_list_windows', {});
      } else if (toolMessages.length === 1) {
        const listResult = state.toolResults[0];
        assert(
          listResult?.ok === true,
          `desktop_list_windows failed: ${JSON.stringify(listResult)}`,
        );
        const windows = listResult?.result?.windows ?? [];
        const matches = windows.filter((window) => window.title === state.windowTitle);
        assert(matches.length === 1, `Expected one fixture window, found ${matches.length}.`);
        state.window = matches[0];
        sendToolCall(response, `${state.scenarioId}-inspect`, 'desktop_inspect_window', {
          window: state.window,
        });
      } else if (toolMessages.length === 2) {
        const inspectResult = state.toolResults[1];
        assert(
          inspectResult?.ok === true,
          `desktop_inspect_window failed: ${JSON.stringify(inspectResult)}`,
        );
        assert(
          inspectResult?.result?.kind === 'accessibility-snapshot',
          `Unexpected inspect result: ${JSON.stringify(inspectResult)}`,
        );
        state.snapshotTarget = {
          window: inspectResult.result.window,
          snapshotRevision: inspectResult.result.snapshotRevision,
          accessibilityRevision: inspectResult.result.accessibilityRevision,
        };
        sendToolCall(response, `${state.scenarioId}-resolve`, 'desktop_resolve_selector', {
          target: state.snapshotTarget,
          selector: { automationId: 'InputText', controlType: 'Edit' },
        });
      } else if (toolMessages.length === 3) {
        const resolveResult = state.toolResults[2];
        assert(
          resolveResult?.ok === true,
          `desktop_resolve_selector failed: ${JSON.stringify(resolveResult)}`,
        );
        assert(
          resolveResult?.result?.kind === 'element-resolved',
          `Unexpected resolve result: ${JSON.stringify(resolveResult)}`,
        );
        state.elementTarget = resolveResult.result.target;
        sendToolCall(response, `${state.scenarioId}-set-value`, 'desktop_set_value', {
          target: state.elementTarget,
          value: state.inputValue,
        });
      } else {
        const finalToolResult = state.toolResults.at(-1);
        state.finalToolResult = finalToolResult;
        assert(
          finalToolResult?.code === 'desktop.user-input-detected',
          `Expected desktop.user-input-detected, got ${JSON.stringify(finalToolResult)}`,
        );
        sendFinalText(response, 'Desktop user-input handoff recorded.');
      }
      response.end('data: [DONE]\n\n');
    } catch (error) {
      state.serverErrors.push(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' });
      }
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
}

async function seedFixture({
  dbPath,
  keyPath,
  workspaceRoot,
  origin,
  scenarioId,
  conversationTitle,
}) {
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const secureStore = new SecureStore(new XorDevBackend(keyPath));
  try {
    const secret = await secureStore.storeSecret('desktop-handoff-provider-secret');
    const providerStore = new SqliteProviderStore(connection.raw);
    const provider = providerStore.createProvider({
      name: `Desktop handoff E2E provider ${scenarioId}`,
      baseUrl: `${origin}/v1`,
      protocol: 'openai-chat',
      supportsDiscovery: false,
      storeHandle: secret,
    });
    const model = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [{ providerModelId: 'desktop-handoff-model' }],
    })[0];
    assert(model, 'Provider model was not created.');
    connection.raw
      .prepare('UPDATE model SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify(['text', 'tool-calling']), model.id);

    const workspaceId = `workspace-desktop-handoff-${scenarioId}`;
    new SqliteWorkspaceStore(connection.raw).createWorkspace({
      id: workspaceId,
      name: `Desktop handoff ${scenarioId}`,
      folderPath: workspaceRoot,
    });
    new SqliteAppSettingStore(connection.raw).set('plugin.computer-use', { enabled: true });
    const conversation = new SqliteConversationStore(connection.raw).create({
      id: `conv-desktop-handoff-${scenarioId}`,
      target: { track: 'model', modelId: model.id },
      workspaceId,
      title: conversationTitle,
      executionMode: 'full-access',
    });
    return { workspaceId, conversationId: conversation.id };
  } finally {
    secureStore.shutdown();
    connection.raw.close();
  }
}

function findFile(root, fileName) {
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.name === fileName) return fullPath;
    }
  }
  return undefined;
}

async function buildFixture(artifactsPath) {
  await mkdir(artifactsPath, { recursive: true });
  const result = await execFileAsync(
    'dotnet',
    ['build', fixtureProject, '-c', 'Release', '--nologo', '--artifacts-path', artifactsPath],
    { cwd: repo, timeout: 120_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  const executable = findFile(artifactsPath, 'SyncThinkDesktopFixture.exe');
  assert(executable, `Fixture executable was not produced under ${artifactsPath}.`);
  return executable;
}

async function readFixtureState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return undefined;
  }
}

async function launchFixture({ executable, scenarioId, statePath, delayMs }) {
  const child = spawn(
    executable,
    ['--scenario', scenarioId, '--state-file', statePath, '--delay-ms', String(delayMs)],
    { cwd: dirname(executable), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false },
  );
  child.stdout?.on('data', (chunk) => process.stdout.write(`[fixture:${scenarioId}:out] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[fixture:${scenarioId}:err] ${chunk}`));
  const ready = await waitForCondition(
    'WPF fixture ready state',
    async () => {
      if (child.exitCode !== null) throw new Error(`WPF fixture exited with ${child.exitCode}.`);
      const state = await readFixtureState(statePath);
      return state?.status === 'ready' ? state : undefined;
    },
    30_000,
  );
  return { child, ready };
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
  await page.setViewportSize({ width: 1280, height: 820 });
  return { app, page, logs };
}

async function openConversation(page, title) {
  const item = page.getByText(title, { exact: true }).first();
  await item.waitFor({ state: 'visible', timeout: 30_000 });
  await item.click();
  await page
    .locator('textarea.shell-compose__input')
    .waitFor({ state: 'visible', timeout: 30_000 });
}

async function sendConversationMessage(page, text) {
  const input = page.locator('textarea.shell-compose__input');
  await input.fill(text);
  await page.getByTestId('compose-send').click();
}

async function waitForWaitingCard(page, label) {
  const card = page.locator('[data-testid^="desktop-waiting-"]').first();
  try {
    await card.waitFor({ state: 'visible', timeout: 90_000 });
    await card.getByText('桌面操作等待你处理', { exact: true }).waitFor({ state: 'visible' });
  } catch (error) {
    console.log(`[${label}] body`, (await page.locator('body').innerText()).slice(0, 16_000));
    throw error;
  }
  return card;
}

async function readLatestDesktopCommand(dbPath) {
  const connection = await openDatabaseAsync({ path: dbPath });
  try {
    const row = connection.raw
      .prepare(
        `SELECT id, workspace_id AS workspaceId, run_id AS runId, owner_id AS ownerId,
                tool_name AS toolName, action, target_identity AS targetIdentity,
                sanitized_args_json AS sanitizedArgsJson, state, result_json AS resultJson,
                error_code AS errorCode, failure_class AS failureClass,
                created_at AS createdAt, updated_at AS updatedAt
           FROM desktop_command
          ORDER BY created_at DESC
          LIMIT 1`,
      )
      .get();
    if (!row) return undefined;
    return {
      ...row,
      sanitizedArgs: JSON.parse(row.sanitizedArgsJson),
      result: row.resultJson ? JSON.parse(row.resultJson) : undefined,
    };
  } finally {
    connection.raw.close();
  }
}

async function readDesktopEvents(dbPath) {
  const connection = await openDatabaseAsync({ path: dbPath });
  try {
    return connection.raw
      .prepare(
        `SELECT type, payload_json AS payloadJson
           FROM event
          WHERE type IN ('desktop.command.started', 'desktop.command.waiting_user')
          ORDER BY sequence`,
      )
      .all();
  } finally {
    connection.raw.close();
  }
}

function injectShiftInput() {
  const VK_SHIFT = 0x10;
  const KEYEVENTF_KEYUP = 0x0002;
  keybdEvent(VK_SHIFT, 0, 0, 0);
  keybdEvent(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0);
}

function assertSafeProjection({ cardText, events, inputValue, command }) {
  const sensitiveFragments = [
    inputValue,
    command?.targetIdentity,
    'nativeWindowHandle',
    'snapshotRevision',
    'accessibilityRevision',
    'elementIndex',
    'targetIdentity',
    'ownerId',
  ].filter(Boolean);
  const eventProjection = events.map((event) => event.payloadJson).join('\n');
  for (const fragment of sensitiveFragments) {
    assert(!eventProjection.includes(fragment), `Durable event projection leaked ${fragment}.`);
    assert(!cardText.includes(fragment), `Waiting card leaked ${fragment}.`);
  }
}

async function runScenario(mode) {
  const scenarioId = `${mode}-${randomBytes(5).toString('hex')}`;
  const conversationTitle = `Desktop handoff ${scenarioId}`;
  const inputValue = `p010-${scenarioId}`;
  const windowTitle = `SYNC THINK Desktop Handoff Fixture [${scenarioId}]`;
  const temp = await mkdtemp(join(tmpdir(), `sync-think-desktop-handoff-${mode}-`));
  const dbPath = join(temp, 'sync-think.db');
  const keyPath = join(temp, 'secure', 'key.bin');
  const localAppData = join(temp, 'local-app-data');
  const userData = join(temp, 'desktop-user-data');
  const workspaceRoot = join(temp, 'workspace');
  const shots = join(temp, 'shots');
  const fixtureStatePath = join(temp, 'fixture-state.json');
  const fixtureArtifacts = join(temp, 'fixture-build');
  await Promise.all([
    mkdir(localAppData, { recursive: true }),
    mkdir(userData, { recursive: true }),
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(shots, { recursive: true }),
  ]);

  const state = {
    scenarioId,
    dbPath,
    windowTitle,
    inputValue,
    origin: '',
    providerRequests: [],
    toolResults: [],
    serverErrors: [],
  };
  const server = createProviderServer(state);
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  state.origin = `http://127.0.0.1:${address.port}`;

  const fixtureExecutable = await buildFixture(fixtureArtifacts);
  const fixture = await launchFixture({
    executable: fixtureExecutable,
    scenarioId,
    statePath: fixtureStatePath,
    delayMs: 6_000,
  });
  await seedFixture({
    dbPath,
    keyPath,
    workspaceRoot,
    origin: state.origin,
    scenarioId,
    conversationTitle,
  });

  const installId = `desktop-handoff-e2e-${scenarioId}`;
  const env = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    SYNC_THINK_DB_PATH: dbPath,
    SYNC_THINK_SECURE_KEY_PATH: keyPath,
    SYNC_THINK_INSTALL_ID: installId,
    SYNC_THINK_DEV_NO_TOKEN: '1',
    SYNC_THINK_DISABLE_DEMO_PROVIDER: '1',
    SYNC_THINK_NODE_BIN: node20,
    SYNC_THINK_RUNTIME_FORCE_RESTART: '1',
    SYNC_THINK_SHELL: '1',
  };

  console.log(`\n=== desktop handoff E2E: ${mode} ===`);
  console.log('temp', temp);
  console.log('fixture', fixtureExecutable);
  console.log('fixture PID', fixture.child.pid);
  console.log('origin', state.origin);

  let first;
  let second;
  try {
    first = await launchDesktop({ label: `${mode}:first`, env, userData });
    await openConversation(first.page, conversationTitle);
    await sendConversationMessage(first.page, conversationTitle);

    const started = await waitForCondition(
      'WPF fixture started mutation',
      async () => {
        const fixtureState = await readFixtureState(fixtureStatePath);
        return fixtureState?.status === 'started' ? fixtureState : undefined;
      },
      90_000,
    );
    assert(started.lastAction === 'set-value', `Unexpected fixture action: ${started.lastAction}`);
    assert(
      started.invocationCount === 1,
      `Expected one invocation, got ${started.invocationCount}`,
    );
    injectShiftInput();
    console.log('Injected Shift input after WPF mutation entered its blocking handler.');

    const waitingCommand = await waitForCondition(
      'durable Desktop waiting_user state',
      async () => {
        const command = await readLatestDesktopCommand(dbPath);
        return command?.state === 'waiting_user' ? command : undefined;
      },
      60_000,
    );
    assert(
      waitingCommand.errorCode === 'desktop.user-input-detected',
      `Unexpected waiting error code: ${waitingCommand.errorCode}`,
    );
    const card = await waitForWaitingCard(first.page, `${mode}:first`);
    const cardText = await card.innerText();
    const events = await readDesktopEvents(dbPath);
    assert(
      events.some((event) => event.type === 'desktop.command.started'),
      'Missing started event.',
    );
    assert(
      events.some((event) => event.type === 'desktop.command.waiting_user'),
      'Missing waiting_user event.',
    );
    assertSafeProjection({ cardText, events, inputValue, command: waitingCommand });
    await first.page.screenshot({ path: join(shots, '01-before-restart.png'), fullPage: true });

    const completedFixture = await waitForCondition(
      'WPF fixture completed original mutation',
      async () => {
        const fixtureState = await readFixtureState(fixtureStatePath);
        return fixtureState?.status === 'completed' ? fixtureState : undefined;
      },
      30_000,
    );
    assert(completedFixture.lastAction === 'set-value', 'Fixture completed the wrong action.');
    assert(completedFixture.invocationCount === 1, 'Original UIA action ran more than once.');
    assert(
      completedFixture.completedCount === 1,
      'Original UIA action did not complete exactly once.',
    );
    assert(
      completedFixture.inputValue === inputValue,
      'Fixture did not receive the expected value.',
    );
    assert(
      state.finalToolResult?.code === 'desktop.user-input-detected',
      'Provider missed interrupt result.',
    );
    assert(state.serverErrors.length === 0, `Provider errors: ${state.serverErrors.join('\n')}`);
    const requestsBeforeRestart = state.providerRequests.length;
    assert(
      requestsBeforeRestart === 5,
      `Expected 5 provider requests, got ${requestsBeforeRestart}.`,
    );

    await closeDesktop(first.app, `${mode}:first`);
    first = undefined;

    second = await launchDesktop({ label: `${mode}:second`, env, userData });
    await openConversation(second.page, conversationTitle);
    const restoredCard = await waitForWaitingCard(second.page, `${mode}:second`);
    await second.page.screenshot({ path: join(shots, '02-after-restart.png'), fullPage: true });
    assert(
      state.providerRequests.length === requestsBeforeRestart,
      'Provider request replayed during Desktop/Runtime cold restart.',
    );
    const beforeDecisionState = await readFixtureState(fixtureStatePath);
    assert(beforeDecisionState?.invocationCount === 1, 'UIA action replayed during cold restart.');

    const buttonName = mode === 'continue' ? '我已处理，继续' : '取消等待';
    await restoredCard.getByRole('button', { name: buttonName }).click();
    await restoredCard.waitFor({ state: 'hidden', timeout: 60_000 });
    const expectedState = mode === 'continue' ? 'completed' : 'failed';
    const finalCommand = await waitForCondition(
      `Desktop command ${expectedState}`,
      async () => {
        const command = await readLatestDesktopCommand(dbPath);
        return command?.state === expectedState ? command : undefined;
      },
      60_000,
    );
    if (mode === 'continue') {
      assert(
        finalCommand.errorCode == null,
        `Continued command has error ${finalCommand.errorCode}.`,
      );
      assert(
        finalCommand.result?.output?.resolution === 'user-confirmed',
        `Unexpected Continue result: ${JSON.stringify(finalCommand.result)}`,
      );
    } else {
      assert(
        finalCommand.errorCode === 'desktop.command-cancelled',
        `Unexpected Cancel error: ${finalCommand.errorCode}`,
      );
      assert(
        finalCommand.failureClass === 'acceptance',
        'Cancel failure class was not acceptance.',
      );
    }
    await sleep(1_000);
    const afterDecisionState = await readFixtureState(fixtureStatePath);
    assert(
      afterDecisionState?.invocationCount === 1,
      'Original UIA action replayed after decision.',
    );
    assert(
      afterDecisionState?.completedCount === 1,
      'Fixture completion count changed after decision.',
    );
    assert(
      state.providerRequests.length === requestsBeforeRestart,
      'Provider request replayed after resolving the waiting command.',
    );
    await second.page.screenshot({
      path: join(shots, mode === 'continue' ? '03-after-continue.png' : '03-after-cancel.png'),
      fullPage: true,
    });

    console.log('final command', finalCommand);
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
    if (state.serverErrors.length > 0) {
      console.error('provider errors', state.serverErrors.join('\n'));
    }
    throw error;
  } finally {
    if (first) await closeDesktop(first.app, `${mode}:first-finally`).catch(() => undefined);
    if (second) await closeDesktop(second.app, `${mode}:second-finally`).catch(() => undefined);
    await closeFixture(fixture.child).catch(() => undefined);
    await closeServer(server);
    console.log('preserved temp', temp);
  }
}

console.log('repo', repo);
console.log('Node 20', node20);
const modes = requestedMode === 'all' ? supportedModes : [requestedMode];
for (const mode of modes) {
  await runScenario(mode);
}
console.log(`\nDesktop handoff E2E complete: ${modes.join(', ')}`);
