import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const supportedModes = ['approve', 'deny'];
const requestedMode = process.argv[2] ?? 'all';

if (requestedMode !== 'all' && !supportedModes.includes(requestedMode)) {
  throw new Error(`Unknown mode ${JSON.stringify(requestedMode)}. Use approve, deny, or all.`);
}
if (process.platform !== 'win32') {
  throw new Error('Tool approval reconnect E2E currently targets the Windows Desktop lifecycle.');
}

const node20 = await resolveNode20();
if (Number.parseInt(process.versions.node.split('.')[0] ?? '', 10) !== 20) {
  const result = spawnSync(node20, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, SYNC_THINK_NODE_BIN: node20 },
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const workersRequire = createRequire(join(repo, 'packages', 'workers', 'package.json'));
const { _electron } = workersRequire('playwright-core');
const electronPath = join(
  repo,
  'apps',
  'desktop',
  'node_modules',
  'electron',
  'dist',
  'electron.exe',
);
const storageEntry = join(repo, 'packages', 'storage', 'dist', 'index.js');
const secureStoreEntry = join(repo, 'packages', 'secure-store', 'dist', 'index.js');

for (const required of [electronPath, storageEntry, secureStoreEntry]) {
  if (!existsSync(required)) throw new Error(`Missing E2E prerequisite: ${required}`);
}

const storage = await import(pathToFileURL(storageEntry).href);
const secure = await import(pathToFileURL(secureStoreEntry).href);
const {
  openDatabaseAsync,
  runMigrations,
  SqliteConversationStore,
  SqliteProviderStore,
  SqliteWorkspaceStore,
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
  throw new Error(
    `${label} did not become true in ${timeoutMs}ms; last=${JSON.stringify(lastValue)}; error=${String(lastError ?? '')}`,
  );
}

async function binaryNodeMajor(binary) {
  const result = spawnSync(binary, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    timeout: 3_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return null;
  return Number.parseInt((result.stdout ?? '').trim().split('.')[0] ?? '', 10);
}

async function resolveNode20() {
  const candidates = [process.env.SYNC_THINK_NODE_BIN, process.execPath];
  if (process.env.LOCALAPPDATA) {
    const root = join(process.env.LOCALAPPDATA, 'pnpm', 'nodejs');
    if (existsSync(root)) {
      for (const version of readdirSync(root).sort().reverse()) {
        if (version.startsWith('20.')) candidates.push(join(root, version, 'node.exe'));
      }
    }
  }
  for (const entry of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    candidates.push(join(entry, 'node.exe'));
  }
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) continue;
    if ((await binaryNodeMajor(candidate)) === 20) return candidate;
  }
  throw new Error('Could not find Node 20. Set SYNC_THINK_NODE_BIN.');
}

function sendToolCall(response, id, path, content) {
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
                function: { name: 'write_file', arguments: JSON.stringify({ path, content }) },
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
            data: [{ id: 'approval-reconnect-model', object: 'model' }],
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
      state.requests.push(parsed);
      const toolMessages = Array.isArray(parsed.messages)
        ? parsed.messages.filter((message) => message.role === 'tool')
        : [];

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      if (toolMessages.length === 0) {
        sendToolCall(response, state.toolCallId, state.relativePath, state.fileContent);
      } else {
        state.toolResult = toolMessages.at(-1)?.content;
        sendFinalText(response, `approval reconnect ${state.mode} completed`);
      }
      response.end('data: [DONE]\n\n');
    } catch (error) {
      state.errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
}

async function closeServer(server) {
  server.closeAllConnections?.();
  if (!server.listening) return;
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function seedFixture({ dbPath, keyPath, workspaceRoot, origin, scenarioId, title }) {
  await runMigrations(dbPath);
  const connection = await openDatabaseAsync({ path: dbPath });
  const secureStore = new SecureStore(new XorDevBackend(keyPath));
  try {
    const secret = await secureStore.storeSecret('approval-reconnect-secret');
    const providerStore = new SqliteProviderStore(connection.raw);
    const provider = providerStore.createProvider({
      name: `Approval reconnect ${scenarioId}`,
      baseUrl: `${origin}/v1`,
      protocol: 'openai-chat',
      supportsDiscovery: false,
      storeHandle: secret,
    });
    const model = providerStore.upsertModels({
      providerId: provider.provider.id,
      protocol: 'openai-chat',
      models: [{ providerModelId: 'approval-reconnect-model' }],
    })[0];
    assert(model, 'Provider model was not created.');
    connection.raw
      .prepare('UPDATE model SET capabilities_json = ? WHERE id = ?')
      .run(JSON.stringify(['text', 'tool-calling']), model.id);

    const workspaceStore = new SqliteWorkspaceStore(connection.raw);
    const workspaceId = `workspace-approval-reconnect-${scenarioId}`;
    workspaceStore.createWorkspace({
      id: workspaceId,
      name: `Approval reconnect ${scenarioId}`,
      folderPath: workspaceRoot,
      allowedRoots: [workspaceRoot],
    });
    const task = workspaceStore.createTask({
      workspaceId,
      title,
      goal: 'Verify tool approval survives Desktop disconnect',
    });
    const conversationStore = new SqliteConversationStore(connection.raw);
    const conversation = conversationStore.create({
      id: `conv-approval-reconnect-${scenarioId}`,
      target: { track: 'model', modelId: model.id },
      workspaceId,
      title,
      executionMode: 'ask',
    });
    conversationStore.bindTask(conversation.id, task.taskId);
    return { conversationId: conversation.id, threadId: task.threadId };
  } finally {
    secureStore.shutdown();
    connection.raw.close();
  }
}

async function launchDesktop({ label, env, userData }) {
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [join(repo, 'apps', 'desktop'), `--user-data-dir=${userData}`],
    cwd: join(repo, 'apps', 'desktop'),
    env,
    timeout: 30_000,
  });
  app.process().stdout?.on('data', (chunk) => process.stdout.write(`[${label}:out] ${chunk}`));
  app.process().stderr?.on('data', (chunk) => process.stderr.write(`[${label}:err] ${chunk}`));
  const page = await app.firstWindow();
  page.on('console', (message) =>
    console.log(`[${label}:console:${message.type()}]`, message.text()),
  );
  page.on('pageerror', (error) => console.error(`[${label}:pageerror]`, error));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1280, height: 820 });
  return { app, page };
}

async function closeDesktop(app, label) {
  const child = app.process();
  const exited = new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) resolveExit();
    else child.once('exit', resolveExit);
  });
  void app.close().catch(() => undefined);
  await Promise.race([
    exited,
    sleep(30_000).then(() => {
      throw new Error(`Desktop ${label} did not exit in 30000ms`);
    }),
  ]);
}

async function openConversation(page, title) {
  const item = page.getByText(title, { exact: true }).first();
  await item.waitFor({ state: 'visible', timeout: 30_000 });
  await item.click();
  await page.locator('textarea.shell-compose__input').waitFor({ state: 'visible' });
}

async function runtimeHealth(page) {
  const outcome = await page.evaluate(() => window.syncThink.runtime.connect());
  assert(
    outcome?.ok && outcome.result.health.ok,
    `Runtime health failed: ${JSON.stringify(outcome)}`,
  );
  return outcome.result.health;
}

async function readApprovalEvent(dbPath, approvalId) {
  const connection = await openDatabaseAsync({ path: dbPath });
  try {
    const rows = connection.raw
      .prepare(
        `SELECT sequence, type, payload_json AS payloadJson
           FROM event
          WHERE type IN ('tool.approval_requested', 'tool.approval_decided')
          ORDER BY sequence`,
      )
      .all();
    return rows
      .map((row) => ({ ...row, payload: JSON.parse(row.payloadJson) }))
      .filter((row) => row.payload.approvalId === approvalId);
  } finally {
    connection.raw.close();
  }
}

async function runScenario(mode) {
  const scenarioId = `${mode}-${randomBytes(5).toString('hex')}`;
  const title = `Approval reconnect ${scenarioId}`;
  const root = join(
    repo,
    '.data',
    `tool-approval-reconnect-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}-${scenarioId}`,
  );
  const dbPath = join(root, 'sync-think.db');
  const keyPath = join(root, 'secure', 'key.bin');
  const localAppData = join(root, 'local-app-data');
  const userData = join(root, 'desktop-user-data');
  const workspaceRoot = join(root, 'workspace');
  const relativePath = 'approval-reconnect-proof.txt';
  const outputPath = join(workspaceRoot, relativePath);
  const fileContent = `approval reconnect ${scenarioId}\n`;
  await Promise.all([
    mkdir(localAppData, { recursive: true }),
    mkdir(userData, { recursive: true }),
    mkdir(workspaceRoot, { recursive: true }),
  ]);

  const state = {
    mode,
    toolCallId: `tool-${scenarioId}`,
    relativePath,
    fileContent,
    requests: [],
    errors: [],
    toolResult: undefined,
  };
  const server = createProviderServer(state);
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const seeded = await seedFixture({
    dbPath,
    keyPath,
    workspaceRoot,
    origin,
    scenarioId,
    title,
  });
  const env = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    SYNC_THINK_DB_PATH: dbPath,
    SYNC_THINK_SECURE_KEY_PATH: keyPath,
    SYNC_THINK_INSTALL_ID: `approval-reconnect-e2e-${scenarioId}`,
    SYNC_THINK_DEV_NO_TOKEN: '1',
    SYNC_THINK_DISABLE_DEMO_PROVIDER: '1',
    SYNC_THINK_NODE_BIN: node20,
  };

  let first;
  let second;
  let runtimePid;
  try {
    first = await launchDesktop({ label: `${mode}:first`, env, userData });
    await openConversation(first.page, title);
    const healthBefore = await runtimeHealth(first.page);
    runtimePid = healthBefore.runtimePid;
    const input = first.page.locator('textarea.shell-compose__input');
    await input.fill(`Create ${relativePath} now.`);
    await first.page.getByTestId('compose-send').click();

    const card = first.page.locator('[data-testid^="tool-approval-"]').first();
    await card.waitFor({ state: 'visible', timeout: 60_000 });
    const approvalId = (await card.getAttribute('data-testid'))?.replace('tool-approval-', '');
    assert(approvalId, 'Approval card did not expose an id.');
    const requestedEvents = await waitForCondition('approval requested event', async () => {
      const events = await readApprovalEvent(dbPath, approvalId);
      return events.some((event) => event.type === 'tool.approval_requested') ? events : undefined;
    });
    const requestedSequence = requestedEvents.find(
      (event) => event.type === 'tool.approval_requested',
    ).sequence;
    await waitForCondition('Desktop replay cursor advanced past approval', async () => {
      const cursor = JSON.parse(
        await readFile(join(userData, 'runtime-activity-cursor.json'), 'utf8'),
      );
      return cursor.sequence >= requestedSequence ? cursor : undefined;
    });
    await first.page.screenshot({
      path: join(root, '01-before-desktop-close.png'),
      fullPage: true,
    });

    await closeDesktop(first.app, `${mode}:first`);
    first = undefined;
    process.kill(runtimePid, 0);

    second = await launchDesktop({ label: `${mode}:second`, env, userData });
    await openConversation(second.page, title);
    const healthAfter = await runtimeHealth(second.page);
    assert(
      healthAfter.runtimePid === runtimePid,
      `Runtime changed across Desktop close: ${runtimePid} -> ${healthAfter.runtimePid}`,
    );
    const restoredCard = second.page.locator(`[data-testid="tool-approval-${approvalId}"]`);
    await restoredCard.waitFor({ state: 'visible', timeout: 60_000 });
    await second.page.screenshot({
      path: join(root, '02-after-desktop-reopen.png'),
      fullPage: true,
    });

    await restoredCard
      .getByRole('button', { name: mode === 'approve' ? '批准执行' : '拒绝' })
      .click();
    await restoredCard.waitFor({ state: 'hidden', timeout: 60_000 });
    await waitForCondition('provider final request', () => state.requests.length >= 2);
    assert(state.errors.length === 0, `Provider errors: ${state.errors.join('\n')}`);

    if (mode === 'approve') {
      const written = await waitForCondition('approved file write', async () => {
        if (!existsSync(outputPath)) return undefined;
        return await readFile(outputPath, 'utf8');
      });
      assert(written === fileContent, `Unexpected file content: ${JSON.stringify(written)}`);
    } else {
      await sleep(500);
      assert(!existsSync(outputPath), 'Denied approval still wrote the file.');
    }

    const decidedEvents = await readApprovalEvent(dbPath, approvalId);
    assert(
      decidedEvents.filter((event) => event.type === 'tool.approval_requested').length === 1,
      'Approval request was replayed.',
    );
    assert(
      decidedEvents.filter((event) => event.type === 'tool.approval_decided').length === 1,
      'Approval decision was not persisted exactly once.',
    );
    const pending = await second.page.evaluate(
      ({ threadId }) => window.syncThink.runtime.listPendingToolApprovals({ threadId }),
      { threadId: seeded.threadId },
    );
    assert(pending.approvals.length === 0, 'Resolved approval remained pending.');
    await second.page.screenshot({
      path: join(root, mode === 'approve' ? '03-after-approve.png' : '03-after-deny.png'),
      fullPage: true,
    });

    console.log(`PASS ${mode}`, {
      runtimePid,
      approvalId,
      providerRequests: state.requests.length,
      evidence: root,
    });
  } finally {
    const activePage = second?.page ?? first?.page;
    if (activePage) {
      await activePage.evaluate(() => window.syncThink.runtime.daemonStop()).catch(() => undefined);
    }
    if (first) await closeDesktop(first.app, `${mode}:first-finally`).catch(() => undefined);
    if (second) await closeDesktop(second.app, `${mode}:second-finally`).catch(() => undefined);
    await closeServer(server);
    console.log('evidence preserved', root);
  }
}

console.log('repo', repo);
console.log('Node 20', node20);
const modes = requestedMode === 'all' ? supportedModes : [requestedMode];
for (const mode of modes) await runScenario(mode);
console.log(`Tool approval reconnect E2E complete: ${modes.join(', ')}`);
