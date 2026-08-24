// 目标模式 E2E：连接运行中的 managed runtime（pipe），逐项验证新引入能力，
// 全部使用 deepseek-v4-flash。用法：node scripts/tmp-goal-e2e.mjs [stage]
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const wsRequire = createRequire(join(repo, 'package.json'));

const INSTALL_ID = process.env.SYNC_THINK_E2E_PIPE ?? 'e2e-0001';
const PIPE = String.raw`\\.\pipe\sync-think-${INSTALL_ID}`;
const MODEL = 'deepseek-v4-flash';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

let seq = 0;
const pending = new Map();
let socket;
let buffer = Buffer.alloc(0);

function send(type, payload) {
  return new Promise((resolve, reject) => {
    const id = `e2e-${++seq}`;
    pending.set(id, { resolve, reject });
    const json = Buffer.from(JSON.stringify({ id, kind: 'request', type, payload }), 'utf8');
    const out = Buffer.allocUnsafe(4 + json.length);
    out.writeUInt32BE(json.length, 0);
    json.copy(out, 4);
    socket.write(out);
  });
}

function onData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32BE(0);
    if (len <= 0 || buffer.length < 4 + len) break;
    const json = buffer.subarray(4, 4 + len).toString('utf8');
    buffer = buffer.subarray(4 + len);
    let frame;
    try {
      frame = JSON.parse(json);
    } catch {
      continue;
    }
    if (frame.id && pending.has(frame.id)) {
      const { resolve, reject } = pending.get(frame.id);
      pending.delete(frame.id);
      if (frame.error) reject(new Error(`${frame.type}: ${frame.error.message}`));
      else resolve(frame.payload);
    } else if (frame.kind === 'event') {
      onEvent(frame);
    }
  }
}

const eventLog = [];
function onEvent(frame) {
  if (frame.type === 'runtime.event' && frame.payload?.event) {
    eventLog.push(frame.payload.event);
  } else {
    eventLog.push({ type: frame.type, payload: frame.payload, sequence: 0 });
  }
}

async function connect() {
  socket = net.connect(PIPE);
  socket.setNoDelay(true);
  socket.on('data', onData);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const hello = await send('__hello', {
    protocolVersion: 2,
    appVersion: '0.0.1',
    installId: INSTALL_ID,
    nonce: 'e2e' + Math.random().toString(16).slice(2),
    features: [],
  });
  if (!hello?.ok) throw new Error('hello rejected: ' + JSON.stringify(hello));
  // 订阅事件流：从当前游标开始（跳过历史回放，只收实时事件）。
  const health = await send('runtime.healthcheck', {});
  const cursor = Number(health?.eventSequence ?? 0);
  const sub = await send('runtime.subscribeEvents', { afterCursor: cursor });
  if (!sub?.streamId) throw new Error('subscribeEvents failed: ' + JSON.stringify(sub));
  console.log('events subscribed:', sub.streamId, 'from cursor', cursor);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(type, predicate, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = eventLog.find((e) => e.type === type && (!predicate || predicate(e)));
    if (match) return match;
    await sleep(1500);
  }
  const recent = eventLog.slice(-8).map((e) => `${e.type}:${e.sequence}`).join(',');
  console.error(`[waitFor] no ${type}; recent events: ${recent}; total=${eventLog.length}`);
  throw new Error(`timeout waiting for ${type}`);
}

function eventSince(seqStart, type) {
  return eventLog.find((e) => e.type === type && e.sequence > seqStart);
}

// ── stage: health ────────────────────────────────────────────────────────────
async function stageHealth() {
  const health = await send('runtime.healthcheck', {});
  record('runtime 连接与 healthcheck', Boolean(health?.features?.length));
  // features 列表来自桌面端 hello 声明（旧 desktop 主进程可能未含新项），
  // 直接探测新命令是否可用来判定 runtime 是否为新代码。
  const probes = [
    ['scheduledTask.list', {}, 'scheduledTask 命令'],
    ['goal.pause', { conversationId: 'probe-none' }, 'goal.pause 命令'],
    ['skill.local.scan', {}, 'skill.local.scan 命令'],
    ['conversation.ask.pending', { threadId: 'probe-none' }, 'conversation.ask.pending 命令'],
  ];
  for (const [type, payload, label] of probes) {
    let ok = false;
    let detail = '';
    try {
      const res = await send(type, payload);
      ok = res !== undefined;
      detail = '响应正常';
    } catch (error) {
      // PROTOCOL_UNEXPECTED_REQUEST / 未知命令都会抛错；区分「命令不存在」。
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('unknown') || message.includes('not supported') || message.includes('unexpected')) {
        ok = false;
        detail = message;
      } else {
        ok = true;
        detail = `已响应（${message}）`;
      }
    }
    record(`runtime 支持新命令：${label}`, ok, detail);
  }
}

// ── stage: conversation 基础链路（deepseek-v4-flash） ───────────────────────
async function stageConversation() {
  const workspace = await send('workspace.list', {});
  console.log('workspaces:', JSON.stringify(workspace).slice(0, 600));
  const target = process.env.SYNC_THINK_E2E_WORKSPACE ?? 'D:/projects/SYNC-THINK';
  const all = workspace.workspaces ?? workspace ?? [];
  let workspaceId = Array.isArray(all)
    ? all.find((w) => String(w.folderPath ?? '').replaceAll('\\', '/').includes('SYNC-THINK'))?.workspaceId
    : undefined;
  if (!workspaceId) {
    try {
      const created = await send('workspace.create', { name: 'E2E 目标验证', folderPath: target });
      workspaceId = created.workspace?.id ?? created.workspaceId;
    } catch (error) {
      // 可能字段名不同；回退到第一个 workspace。
      workspaceId = Array.isArray(all) ? all[0]?.workspaceId : undefined;
    }
  }
  if (!workspaceId) throw new Error('no workspace available');
  const conv = await send('conversation.create', {
    track: 'model',
    targetRef: MODEL,
    workspaceId,
    title: 'E2E 基础链路',
  });
  const conversationId = conv.conversation?.id ?? conv.id;
  const prep = await send('conversation.sendMessage', { conversationId, text: '你好，请用一句话确认你收到了消息，并说明你是什么模型。' });
  const appended = await send('task.appendMessage', {
    threadId: prep.threadId,
    expectedTaskVersion: prep.taskVersion,
    role: 'user',
    text: '你好，请用一句话确认你收到了消息，并说明你是什么模型。',
    modelId: MODEL,
    kernelId: 'native',
  });
  console.log('appendMessage ok, streamId=', appended?.streamId, 'threadId=', prep.threadId);
  const started = await waitFor('run.started', (e) => e.payload?.threadId === prep.threadId);
  record('普通对话 run 启动（native + deepseek-v4-flash）', true, `runId=${started.runId}`);
  const modelId = started.payload?.modelId;
  const providerModelId = started.payload?.providerModelId;
  record(
    'run 使用 deepseek-v4-flash（无其他模型）',
    String(providerModelId ?? modelId ?? '').includes('deepseek-v4-flash'),
    `modelId=${modelId} providerModelId=${providerModelId}`,
  );
  await waitFor('run.completed', (e) => e.runId === started.runId);
  const messages = await send('conversation.listMessages', { conversationId });
  const lastAssistant = [...(messages.messages ?? [])].reverse().find((m) => m.role === 'assistant');
  record('对话完成且助手有回答', Boolean(lastAssistant?.blocks?.length), `blocks=${lastAssistant?.blocks?.length ?? 0}`);
  return { conversationId, threadId: prep.threadId, workspaceId };
}

// ── stage: askProbe（探测模型是否会调用 ask_user_question） ────────────────
async function stageAskProbe(ctx) {
  if (!ctx.conversationId) ctx = await stageConversation();
  // 先探测 native 内置文件工具是否可见可调。
  const prep0 = await send('conversation.sendMessage', { conversationId: ctx.conversationId, text: '（探测）' });
  await send('task.appendMessage', {
    threadId: prep0.threadId,
    expectedTaskVersion: prep0.taskVersion,
    role: 'user',
    text: '请调用 read_file 工具读取 D:\\projects\\SYNC-THINK\\package.json，然后告诉我它的 name 字段是什么。',
    modelId: MODEL,
    kernelId: 'native',
  });
  try {
    await waitFor('tool.requested', (e) => e.payload?.toolName === 'read_file' || e.payload?.tool?.name === 'read_file', 120_000);
    record('native 文件工具可见（read_file 被调用）', true);
  } catch {
    const events = eventLog.filter((e) => e.type.startsWith('tool')).slice(-5).map((e) => e.type).join(',');
    record('native 文件工具可见（read_file 被调用）', false, `no tool events: ${events}`);
  }
  await waitFor('run.completed', (e) => e.payload?.threadId === prep0.threadId, 120_000).catch(() => undefined);

  // 探测平台工具可见性：英文结构化指令要求调用 task_schedule。
  const prep1 = await send('conversation.sendMessage', { conversationId: ctx.conversationId, text: '（探测）' });
  await send('task.appendMessage', {
    threadId: prep1.threadId,
    expectedTaskVersion: prep1.taskVersion,
    role: 'user',
    text: 'You MUST call the tool "task_schedule" with arguments {"action":"list"} first, then reply with the number of scheduled tasks. Do not reply before calling it.',
    modelId: MODEL,
    kernelId: 'native',
  });
  let calledSchedule = false;
  try {
    await waitFor('tool.requested', (e) => {
      const p = e.payload ?? {};
      const name = p.toolCall?.name ?? p.toolName ?? p.tool?.name ?? p.name;
      return name === 'task_schedule';
    }, 150_000);
    calledSchedule = true;
  } catch {
    calledSchedule = false;
  }
  record('平台工具可见且可调（task_schedule 被调用）', calledSchedule, calledSchedule ? '' : '模型未调用（可能未收到工具或选择不调用）');
  await waitFor('run.completed', (e) => e.payload?.threadId === prep1.threadId, 150_000).catch(() => undefined);
  const prep = await send('conversation.sendMessage', {
    conversationId: ctx.conversationId,
    text: '（探测）',
  });
  await send('task.appendMessage', {
    threadId: prep.threadId,
    expectedTaskVersion: prep.taskVersion,
    role: 'user',
    text: '在回答任何内容之前，你必须先调用一次 ask_user_question 工具，问我「继续吗？」，options 为 [{"label":"继续"},{"label":"停止"}]。调用完工具得到回答后再回复。',
    modelId: MODEL,
    kernelId: 'native',
  });
  try {
    const pending = await waitFor('conversation.ask_pending', (e) => e.payload?.threadId === prep.threadId, 120_000);
    const questions = pending.payload?.questions ?? [];
    record('模型主动调用 ask_user_question（通用问询）', questions.length > 0, JSON.stringify(questions[0]?.question ?? '').slice(0, 60));
    const q = questions[0];
    await send('conversation.ask.answer', {
      askId: pending.payload?.askId,
      answers: [{ id: q.id, selected: ['继续'] }],
    });
    await waitFor('run.completed', (e) => e.payload?.threadId === prep.threadId, 120_000);
  } catch (error) {
    record('模型主动调用 ask_user_question（通用问询）', false, error instanceof Error ? error.message : String(error));
  }
}

// ── stage: plan-review 方案卡链路 ────────────────────────────────────────────
async function stagePlanReview(ctx) {
  await send('settings.set', {
    key: 'plan-act',
    value: { enabled: true, planModelId: MODEL, actModelId: MODEL, planReasoningEffort: null, actReasoningEffort: null },
  });
  await send('conversation.setInteractionMode', { conversationId: ctx.conversationId, interactionMode: 'plan' });
  const prep = await send('conversation.sendMessage', { conversationId: ctx.conversationId, text: '方案：在仓库根目录创建 README.md（一行标题即可）。' });
  await send('task.appendMessage', {
    threadId: prep.threadId,
    expectedTaskVersion: prep.taskVersion,
    role: 'user',
    text: '请只做只读调研，然后用 ask_user_question 提交 plan-review 方案（intent kind=plan-review、approve="确认执行"、detail=方案全文、options=[确认执行,拒绝]）。不要执行任何写入。',
    modelId: MODEL,
    kernelId: 'native',
  });
  const pending = await waitFor('conversation.ask_pending', (e) => e.payload?.threadId === prep.threadId);
  const questions = pending.payload?.questions ?? [];
  const review = questions[0];
  const isReview = review?.intent?.kind === 'plan-review' && review?.detail;
  record('规划轮产出 plan-review 方案卡', Boolean(isReview), `detail=${String(review?.detail ?? '').slice(0, 60)}`);
  const approveLabel = review?.intent?.approve ?? '确认执行';
  await send('conversation.ask.answer', {
    askId: pending.payload?.askId,
    answers: [{ id: review.id, selected: [approveLabel] }],
  });
  await waitFor('conversation.ask_answered', (e) => e.payload?.askId === pending.payload?.askId);
  // 桌面端逻辑：切 execute + 发执行指令（planExecuting）→ 新 run。
  await send('conversation.setInteractionMode', { conversationId: ctx.conversationId, interactionMode: 'execute' });
  const execPrep = await send('conversation.sendMessage', { conversationId: ctx.conversationId, text: '【执行已批准方案】' });
  await send('task.appendMessage', {
    threadId: execPrep.threadId,
    expectedTaskVersion: execPrep.taskVersion,
    role: 'user',
    text: `【执行已批准方案】\n${review.detail ?? ''}`,
    modelId: MODEL,
    kernelId: 'native',
    planExecuting: true,
  });
  const execRun = await waitFor('run.started', (e) => e.payload?.threadId === execPrep.threadId);
  record('批准后执行轮启动（planExecuting + 执行模型路由）', true, `modelId=${execRun.payload?.modelId}`);
  await waitFor('run.completed', (e) => e.runId === execRun.runId);
  record('执行轮完成', true);
}

// ── stage: 定时任务 ──────────────────────────────────────────────────────────
async function stageScheduledTask() {
  const created = await send('scheduledTask.create', {
    name: 'E2E 巡检',
    instruction: '用一句话确认定时任务触发成功。',
    target: { kind: 'model', modelId: MODEL },
    rule: { kind: 'every', intervalMinutes: 5 },
  });
  const task = created.task;
  record('定时任务创建（every 5 分钟）', Boolean(task?.id), `nextRunAt=${task?.nextRunAt}`);
  const triggered = await send('scheduledTask.trigger', { taskId: task.id });
  record('立即触发成功', triggered?.fired === true, `reason=${triggered?.reason ?? ''}`);
  await waitFor('run.started', (e) => e.payload?.text?.includes('【定时任务 · E2E 巡检】'), 60_000);
  record('任务会话注入并启动 run', true);
  const list = await send('scheduledTask.list', {});
  const refreshed = list.tasks?.find((t) => t.id === task.id);
  record('任务状态回写（lastResult）', refreshed?.lastResult?.status === 'success', JSON.stringify(refreshed?.lastResult));
  await send('scheduledTask.delete', { taskId: task.id });
  record('任务删除', true);
}

// ── stage: 本地 skill 发现 ───────────────────────────────────────────────────
async function stageLocalSkill() {
  const scan = await send('skill.local.scan', { refresh: true });
  record('本地 skill 扫描接口可用', Boolean(scan?.directory), `exists=${scan?.exists}`);
  record('约定目录路径为 home/.sync-think/skills', String(scan?.directory).includes('.sync-think'), scan?.directory);
  const watched = Boolean(scan?.watching);
  record('watch 状态', typeof watched === 'boolean', `watching=${watched}`);
}

// ── stage: 目标模式 ──────────────────────────────────────────────────────────
async function stageGoal(ctx) {
  const setGoal = await send('goal.set', {
    conversationId: ctx.conversationId,
    condition: '用一句话说明当前对话使用的模型名称',
    maxGoalRounds: 2,
  });
  record('goal.set（maxGoalRounds=2）', setGoal?.goal?.status === 'active', JSON.stringify(setGoal?.goal?.status));
  const round = await waitFor('message.appended', (e) => String(e.payload?.text ?? '').includes('<goal_round>'), 120_000);
  record('目标轮次注入结构化 goal_round 提示', String(round.payload?.text).includes('Round: 1/2'), String(round.payload?.text).slice(0, 60));
  const pause = await send('goal.pause', { conversationId: ctx.conversationId });
  record('goal.pause', pause?.goal?.status === 'paused', pause?.goal?.status);
  const resume = await send('goal.resume', { conversationId: ctx.conversationId });
  record('goal.resume', resume?.goal?.status === 'active', resume?.goal?.status);
  await send('goal.clear', { conversationId: ctx.conversationId });
  record('goal.clear', true);
}

// ── stage: inspect（调试：列出会话与最近工具事件） ──────────────────────────
async function stageInspect() {
  const list = await send('conversation.list', {});
  const conversations = list.conversations ?? list;
  const latest = Array.isArray(conversations) ? conversations.slice(-3) : [];
  for (const conversation of latest) {
    console.log(`--- conversation ${conversation.id} ${conversation.title} (${conversation.track})`);
    const messages = await send('conversation.listMessages', { conversationId: conversation.id });
    for (const message of (messages.messages ?? []).slice(-4)) {
      const text = (message.blocks ?? [])
        .filter((b) => b.type === 'text' || b.type === 'reasoning')
        .map((b) => String(b.text ?? '').slice(0, 160))
        .join(' | ');
      const tools = (message.blocks ?? [])
        .filter((b) => b.type === 'tool-call')
        .map((b) => b.payload?.name);
      console.log(`  [${message.role}] ${text.slice(0, 200)}${tools.length ? ` TOOLS=${tools.join(',')}` : ''}`);
    }
  }
  record('inspect 完成', true);
}

// ── main ─────────────────────────────────────────────────────────────────────
const stage = process.argv[2] ?? 'all';
try {
  await connect();
  console.log(`connected to ${PIPE}\n`);
  if (stage === 'health' || stage === 'all') await stageHealth();
  let ctx = {};
  if (stage === 'inspect') await stageInspect();
  if (stage === 'conversation' || stage === 'all') ctx = await stageConversation();
  if (stage === 'askprobe' || stage === 'all') await stageAskProbe(ctx);
  if (stage === 'plan' || stage === 'all') await stagePlanReview(ctx);
  if (stage === 'task' || stage === 'all') await stageScheduledTask();
  if (stage === 'skill' || stage === 'all') await stageLocalSkill();
  if (stage === 'goal' || stage === 'all') await stageGoal(ctx);
} catch (error) {
  record('执行异常', false, error instanceof Error ? error.message : String(error));
} finally {
  try {
    socket?.destroy();
  } catch {}
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed > 0 ? 1 : 0);
}
