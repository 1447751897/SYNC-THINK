const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
const names = {
  host: '主协调员',
  a: '阿岚',
  b: '小满',
  you: '你',
  c: '远舟',
  d: '未央',
  e: '木白',
};
const types = {
  announcement: '主持',
  turn_invitation: '点名',
  description: '描述',
  handoff: '交接',
  consult: '咨询',
  artifact: '产物',
  recovery: '续跑',
  result: '结算',
  notice: '提示',
};
let session = null,
  defaults = {},
  viewKind = 'game',
  drafting = false,
  lastId = null,
  lastRevision = -1;
let revealed = false,
  composeMode = 'auto',
  selectedTarget = null,
  voteKey = '',
  inFlight = false,
  mutationEpoch = 0,
  toastTimer,
  loggedMessages = new Set();
const descriptions = (() => {
  try {
    return JSON.parse(localStorage.getItem('sync-think-demo-descriptions') || '{}');
  } catch {
    return {};
  }
})();
function toast(text, error = false) {
  $('toast').textContent = text;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), error ? 6000 : 3600);
}
async function request(path, payload) {
  const response = await fetch(
    path,
    payload
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: crypto.randomUUID(), ...payload }),
        }
      : { cache: 'no-store' },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '本地请求失败。');
  return data;
}
async function action(actionName, extra = {}) {
  if (!session || inFlight) return;
  inFlight = true;
  mutationEpoch++;
  refreshComposer();
  try {
    const data = await request('/api/action', {
      sessionId: session.id,
      action: actionName,
      ...extra,
    });
    receive(data.session, true);
    return true;
  } catch (error) {
    toast(error.message, true);
    return false;
  } finally {
    inFlight = false;
    refreshComposer();
  }
}
function avatar(id, large = false) {
  return `<span class="avatar ${id === 'host' ? 'host' : id === 'you' ? 'you' : ''} ${large ? 'large' : ''}">${id === 'host' ? '协' : id === 'you' ? '你' : id.toUpperCase()}</span>`;
}
function formatText(text) {
  return esc(text).replace(
    /@(阿岚|小满|远舟|未央|木白|主协调员|你)/g,
    '<span class="mention">@$1</span>',
  );
}
function receive(next, force = false) {
  if (next && next.id === lastId && next.revision < lastRevision) return;
  const changedId = (next?.id ?? null) !== lastId;
  session = next;
  if (changedId) {
    lastId = next?.id ?? null;
    lastRevision = -1;
    loggedMessages = new Set();
    $('chat-log').replaceChildren();
    revealed = false;
    composeMode = 'auto';
    selectedTarget = null;
    voteKey = '';
    $('mention-shortcuts').dataset.key = '';
  }
  if (!drafting && session) viewKind = session.kind;
  if (force || changedId || next?.revision !== lastRevision) {
    render();
    lastRevision = next?.revision;
  }
}
function render() {
  const active = session && !drafting && session.kind === viewKind;
  document
    .querySelectorAll('[data-kind]')
    .forEach((button) => button.classList.toggle('selected', button.dataset.kind === viewKind));
  $('room-title').textContent = viewKind === 'game' ? '谁是卧底' : '任务协作';
  $('room-subtitle').textContent =
    viewKind === 'game'
      ? '公开描述，私人词卡。主持人按回合组织。'
      : '总目标随交接传递，群里展示真实生成的模拟产物。';
  $('start-screen').hidden = Boolean(active);
  $('chat-log').hidden = !active;
  $('composer-area').hidden = !active;
  $('restart-button').hidden = !active;
  $('role-field').hidden = viewKind !== 'game';
  $('goal-field').hidden = viewKind !== 'work';
  $('start-button').textContent = viewKind === 'game' ? '开始一局' : '开始协作演示';
  $('start-intro').textContent =
    viewKind === 'game'
      ? '主持人会私密发词、依次点名。你只看自己的词，听每个人描述，再投出你的判断。'
      : '给出一个总目标，观察成员直接咨询、生成产物并交接。试试中断，协调员会从原检查点接续。';
  $('form-note').textContent =
    viewKind === 'game'
      ? '5 位玩家 · 1 名卧底 · 无白板。主持视角必须开新局，不能在参赛中途偷看。'
      : '阿岚拆解 → 小满形成方案 → 远舟验收。只生成演示文档，不执行你的真实项目任务。';
  $('control-section').hidden = !active;
  $('record-section').hidden = !active;
  if (!active) {
    renderWelcome();
    return;
  }
  renderSeats();
  renderMessages();
  renderProgress();
  renderPrivate();
  renderVoting();
  renderRecords();
  refreshComposer();
  $('pause-button').textContent = session.status === 'paused' ? '继续' : '暂停';
  $('pause-button').disabled = session.status === 'completed';
  $('interrupt-button').disabled = session.status !== 'running' || !session.progress.canInterrupt;
  $('room-status').textContent =
    session.status === 'paused' ? '已暂停' : session.status === 'completed' ? '已结束' : '进行中';
  $('room-status').classList.toggle('paused', session.status === 'paused');
}
function renderWelcome() {
  const ids = viewKind === 'game' ? ['host', 'a', 'b', 'you', 'c', 'd'] : ['host', 'a', 'b', 'c'];
  $('seat-strip').innerHTML = ids
    .map(
      (id) =>
        `<div class="seat">${avatar(id)}<span class="seat-name">${names[id]}<small class="seat-state">${id === 'host' ? '主协调员' : id === 'you' ? '你也参与' : '模拟成员'}</small></span></div>`,
    )
    .join('');
  $('room-status').textContent = '准备开始';
  $('room-status').classList.remove('paused');
  $('vote-section').hidden = true;
  $('progress-section').innerHTML =
    viewKind === 'game'
      ? '<div class="section-label">主持人负责推进</div><h2>先发词，再点名。</h2><p>每个存活玩家每轮描述一次。观点不算选票，正式投票单独提交。</p><div class="flow-preview"><span>描述</span><i>→</i><span>讨论</span><i>→</i><span>投票</span></div>'
      : '<div class="section-label">总目标不会丢</div><h2>交接不是一句“接着做”。</h2><p>接球人会收到总目标、自己的职责和上游成果。无需每一步都经协调员转述。</p>';
  $('private-section').innerHTML =
    viewKind === 'game'
      ? '<div class="section-label">私人信息</div><div class="private-preview">开局后，你的词卡会出现在这里。<small>玩家页面不接收其他人的词。</small></div>'
      : '<div class="section-label">本群规则</div><p>描述归群聊；目标归本次活动。可以从左侧查看并编辑下次使用的群描述。</p>';
}
function renderSeats() {
  const people = [{ id: 'host', name: names.host, alive: true }, ...session.players];
  $('seat-strip').innerHTML = people
    .map(
      (p) =>
        `<div class="seat ${p.id === session.currentActor ? 'active' : ''} ${p.alive === false ? 'eliminated' : ''}">${avatar(p.id)}<span class="seat-name">${esc(p.name)}<small class="seat-state">${p.alive === false ? '已出局' : p.id === session.currentActor ? '当前处理' : p.id === 'host' ? '主协调员' : p.role || (p.id === 'you' ? '你也参与' : '模拟玩家')}</small></span></div>`,
    )
    .join('');
}
function renderMessages() {
  const log = $('chat-log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 100;
  for (const m of session.messages) {
    if (loggedMessages.has(m.id)) continue;
    const node = document.createElement('article');
    node.className = `chat-message ${m.sender === 'host' ? 'host-message' : ''} ${m.type === 'recovery' ? 'recovery-message' : ''}`;
    node.dataset.messageId = m.id;
    node.dataset.sender = m.sender;
    node.dataset.type = m.type;
    const artifact = m.artifactId ? session.artifacts.find((a) => a.id === m.artifactId) : null;
    node.innerHTML = `${avatar(m.sender, true)}<div class="message-main"><div class="message-heading"><strong>${esc(names[m.sender])}</strong>${types[m.type] ? `<span class="message-type">${types[m.type]}</span>` : ''}<time>${new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div><div class="message-text">${formatText(m.text)}</div>${artifact ? `<a class="artifact-link" href="/api/artifacts/${artifact.id}" download><span class="file-mark">MD</span><span>${esc(artifact.title)}<small>v${artifact.version} · 本地规则模拟产物</small></span><span class="download-hint">下载 ↗</span></a>` : ''}</div>`;
    log.append(node);
    loggedMessages.add(m.id);
  }
  if (atBottom) log.scrollTop = log.scrollHeight;
}
function renderProgress() {
  if (session.kind === 'work') {
    $('progress-section').innerHTML =
      `<div class="section-label">本轮总目标</div><p class="goal-summary">${esc(session.goal)}</p>${session.progress.workSteps.map((step, i) => `<div class="work-step ${step.status}"><span class="step-number">${step.status === 'done' ? '✓' : i + 1}</span><span>${esc(step.title)}<small class="step-status">${names[step.actor]} · ${step.status === 'done' ? '产物已发布' : step.status === 'active' ? '当前执行' : '尚未交接'}</small></span></div>`).join('')}<p>每位成员都收到总目标和上游成果，不依赖上一条消息复述。</p>`;
    return;
  }
  const phases = {
    describe: '轮流描述',
    'tie-describe': '平票补充描述',
    discussion: '公开讨论',
    vote: '秘密投票',
    results: '本轮结算',
    ended: '本局结束',
  };
  const title =
    session.status === 'completed'
      ? session.winner
      : session.status === 'paused'
        ? '从这里暂停。'
        : session.currentActor === 'you'
          ? '轮到你描述。'
          : session.currentActor
            ? `${session.currentName}正在描述。`
            : phases[session.phase];
  const detail =
    session.phase === 'discussion'
      ? '可以 @ 追问；怀疑不计票。准备好后请求进入投票。'
      : session.phase === 'vote'
        ? '每人一票，收齐后统一公开。你的选择不会提前发到群里。'
        : session.phase === 'ended'
          ? '下面可查看本局分配。私人笔记仍保留原权限。'
          : session.status === 'paused'
            ? '当前席位与词卡已保存。点继续，不会重新开局。'
            : '主持人会依次点名所有存活玩家；每轮都要描述。';
  $('progress-section').innerHTML =
    `<div class="round-line">ROUND ${String(session.round).padStart(2, '0')} · ${session.progress.alive} 人存活</div><h2>${esc(title)}</h2><p>${detail}</p><div class="flow-preview"><span class="${['describe', 'tie-describe'].includes(session.phase) ? 'active' : ''}">描述</span><i>→</i><span class="${session.phase === 'discussion' ? 'active' : ''}">讨论</span><i>→</i><span class="${session.phase === 'vote' ? 'active' : ''}">投票</span></div>${session.phase === 'discussion' && session.status === 'running' ? '<button class="button primary start-button" id="begin-vote-button">请求进入投票</button>' : ''}`;
  $('begin-vote-button')?.addEventListener('click', () => action('begin-vote'));
}
function renderPrivate() {
  if (session.kind === 'work') {
    $('private-section').innerHTML =
      `<div class="section-label">已发布成果</div><h2>${session.artifacts.length} 份模拟文档</h2><p>文件可从群消息下载。未执行真实检索、代码修改或项目验证。</p>`;
    return;
  }
  if (session.role === 'host') {
    $('private-section').innerHTML =
      `<div class="section-label">裁判权限 · 你不参赛</div><div class="host-assignments">${session.assignments.map((p) => `<div class="assignment"><span>${esc(p.name)}</span><span>${esc(p.word)} <span class="role">${esc(p.role)}</span></span></div>`).join('')}</div><p class="event-caption">此视角有分配权限，不代表玩家有这些数据。</p>`;
    return;
  }
  $('private-section').innerHTML =
    `<div class="section-label">仅你可见 · 本局词卡</div><div class="word-card"><div class="card-label">PRIVATE / YOUR WORD</div><div class="word ${revealed ? '' : 'masked'}">${revealed ? esc(session.ownPrivate.card.word) : '•••'}</div><button id="reveal-word">${revealed ? '收起我的词' : '查看我的词'}</button><small>${session.status === 'completed' ? '本局已结束，词卡与身份已按规则揭晓。' : '只知道自己的词，不知道是否为卧底。'}</small></div>${session.players.find((p) => p.id === 'you')?.alive === false ? '<p class="event-caption">你已出局，可以继续观战。</p>' : ''}`;
  $('reveal-word').addEventListener('click', () => {
    revealed = !revealed;
    renderPrivate();
  });
}
function renderVoting() {
  const box = $('vote-section');
  box.hidden =
    session.kind !== 'game' ||
    !['vote', 'results', 'tie-describe', 'ended'].includes(session.phase);
  if (box.hidden) return;
  const key = `${session.round}:${session.progress.votePass}`;
  if (key !== voteKey) {
    voteKey = key;
    selectedTarget = null;
  }
  if (session.phase === 'vote') {
    const alive = session.players.filter((p) => p.alive);
    const eligible = session.role === 'player' && alive.some((p) => p.id === 'you');
    box.innerHTML = `<div class="section-label">正式投票 · ${session.progress.votePass === 2 ? '平票重投' : '本轮'}</div><div class="vote-count">已提交 ${session.progress.voted} / ${alive.length}</div><progress value="${session.progress.voted}" max="${alive.length}" aria-label="投票进度"></progress>${
      eligible && !session.progress.ownVoteSubmitted
        ? `<p>你怀疑谁？选择一人，不自投。</p><div class="vote-options">${alive
            .filter((p) => p.id !== 'you' && session.progress.candidates.includes(p.id))
            .map(
              (p) =>
                `<label class="vote-option"><input type="radio" name="vote" value="${p.id}" ${selectedTarget === p.id ? 'checked' : ''}><span>${esc(p.name)}</span></label>`,
            )
            .join(
              '',
            )}</div><button id="vote-submit" class="button primary vote-submit">提交我的一票</button>`
        : `<div class="vote-saved">${eligible ? '你的票已私密保存' : '观察投票进度'}</div><p>收齐后统一公布，不显示他人的提前选择。</p>`
    }`;
    box
      .querySelectorAll('input[name=vote]')
      .forEach((input) => input.addEventListener('change', () => (selectedTarget = input.value)));
    $('vote-submit')?.addEventListener('click', async () => {
      if (!selectedTarget) return toast('先选择一个你怀疑的玩家。', true);
      if (await action('vote', { target: selectedTarget })) toast('你的票已保存。');
    });
  } else if (session.phase === 'ended') {
    box.innerHTML = `<div class="section-label">本局结束 · 公开揭晓</div><div class="host-assignments">${session.reveal.map((p) => `<div class="assignment"><span>${esc(p.name)}</span><span>${esc(p.word)} <span class="role">${esc(p.role)}</span></span></div>`).join('')}</div>`;
  } else if (session.lastResult) {
    box.innerHTML = `<div class="section-label">第 ${session.lastResult.round} 轮已结算票数</div><div class="result-list">${Object.entries(
      session.lastResult.counts,
    )
      .map(
        ([id, count]) =>
          `<div class="result-row"><span>${names[id]}</span><span>${count} 票</span></div>`,
      )
      .join('')}</div>`;
  } else box.hidden = true;
}
function renderRecords() {
  $('record-section').innerHTML =
    `<div class="section-label">协调员知道哪些进度</div>${session.events
      .slice(-3)
      .map((e) => `<div class="mini-event"><b>${esc(names[e.actor])}</b> · ${esc(e.note)}</div>`)
      .join(
        '',
      )}<div class="event-caption">公开交流与状态统一记账，不需主持人转述。<br>已自动恢复 ${session.progress.recoveries} 次。</div>`;
}
function refreshComposer() {
  if (!session || drafting) return;
  const paused = session.status === 'paused';
  const ownTurn =
    session.kind === 'game' &&
    session.role === 'player' &&
    session.currentActor === 'you' &&
    ['describe', 'tie-describe'].includes(session.phase);
  const describe = ownTurn && composeMode !== 'chat';
  $('send-button').textContent = describe ? '提交本轮描述' : '发送消息';
  $('send-button').disabled = paused || inFlight;
  $('message-input').disabled = paused;
  $('message-input').placeholder = describe
    ? '用自己的话描述你的词，别直接写出词本身…'
    : '输入公开消息，@ 指定成员…';
  $('turn-banner').classList.toggle('your-turn', describe);
  const label = paused
    ? '你已暂停 · 自动续跑停止'
    : describe
      ? '现在轮到你 · 发送后完成本轮描述'
      : ownTurn
        ? '公开聊天 · 不会完成本轮描述'
        : session.kind === 'work'
          ? '成员直接交接 · 总目标随上下文传递'
          : session.phase === 'vote'
            ? '正在投票 · 下方聊天不会自动计票'
            : session.status === 'completed'
              ? '活动已结束 · 可继续聊天或重新开始'
              : '公开群聊 · 主持人按阶段点名';
  $('turn-banner').innerHTML =
    `<span>${label}</span>${ownTurn ? `<button id="compose-mode-toggle" type="button">${describe ? '切为公开聊天' : '切回本轮描述'}</button>` : ''}`;
  $('compose-mode-toggle')?.addEventListener('click', () => {
    composeMode = describe ? 'chat' : 'auto';
    refreshComposer();
    $('message-input').focus();
  });
  const mentionKey = session.players.map((p) => p.id + p.alive).join('');
  if ($('mention-shortcuts').dataset.key !== mentionKey) {
    $('mention-shortcuts').dataset.key = mentionKey;
    $('mention-shortcuts').innerHTML = session.players
      .filter((p) => p.id !== 'you' && p.alive)
      .map((p) => `<button type="button" data-mention="${p.name}">@${esc(p.name)}</button>`)
      .join('');
    $('mention-shortcuts')
      .querySelectorAll('button')
      .forEach((button) =>
        button.addEventListener('click', () => {
          composeMode = 'chat';
          $('message-input').value = `@${button.dataset.mention} ` + $('message-input').value;
          refreshComposer();
          $('message-input').focus();
        }),
      );
  }
}
$('start-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (inFlight) return;
  inFlight = true;
  $('start-button').disabled = true;
  try {
    const data = await request('/api/start', {
      kind: viewKind,
      role:
        viewKind === 'game' ? document.querySelector('input[name=role]:checked').value : 'player',
      goal: $('goal-input').value,
      description: descriptions[viewKind] || defaults[viewKind + 'Description'],
      replace: true,
    });
    drafting = false;
    receive(data.session, true);
  } catch (error) {
    toast(error.message, true);
  } finally {
    inFlight = false;
    $('start-button').disabled = false;
    refreshComposer();
  }
});
$('composer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = $('message-input').value.trim();
  if (!text) return;
  const ownTurn =
    session?.kind === 'game' &&
    session.role === 'player' &&
    session.currentActor === 'you' &&
    ['describe', 'tie-describe'].includes(session.phase);
  if (await action(ownTurn && composeMode !== 'chat' ? 'describe' : 'chat', { text })) {
    $('message-input').value = '';
    composeMode = 'auto';
    refreshComposer();
  }
});
$('message-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('composer-form').requestSubmit();
  }
});
$('interrupt-button').addEventListener('click', async () => {
  if (await action('interrupt')) toast('已安排一次模拟系统中断，观察协调员如何接续。');
});
$('pause-button').addEventListener('click', () =>
  action(session.status === 'paused' ? 'resume' : 'pause'),
);
$('restart-button').addEventListener('click', () => {
  if (
    session.status !== 'completed' &&
    !confirm('重新开始将替换当前 Demo 活动。原应用数据不受影响。')
  )
    return;
  drafting = true;
  render();
});
for (const button of document.querySelectorAll('[data-kind]'))
  button.addEventListener('click', async () => {
    if (button.dataset.kind === viewKind && !drafting) return;
    if (session?.status === 'running') await action('pause');
    viewKind = button.dataset.kind;
    drafting = !session || session.kind !== viewKind;
    render();
  });
$('description-button').addEventListener('click', () => {
  $('description-input').value =
    descriptions[viewKind] ||
    (session?.kind === viewKind ? session.description : defaults[viewKind + 'Description']) ||
    '';
  $('description-dialog').showModal();
});
$('save-description').addEventListener('click', () => {
  const text = $('description-input').value.trim();
  if (!text) return toast('群描述先写一些内容。', true);
  descriptions[viewKind] = text;
  localStorage.setItem('sync-think-demo-descriptions', JSON.stringify(descriptions));
  $('description-dialog').close();
  toast('已保存，下次开局或新任务使用。');
});
$('context-button').addEventListener('click', async () => {
  if (!session) return toast('先启动一局游戏或协作演示。');
  try {
    const context = await request('/api/context');
    $('context-caption').textContent =
      session.role === 'host' && session.kind === 'game'
        ? '你以不参赛裁判身份开局，因此有分配表权限；这不是玩家输入。'
        : '这是服务端按你的身份返回的上下文。玩家只含本人词卡；其他秘密没有下发。';
    $('context-content').textContent = JSON.stringify(context, null, 2);
    $('context-dialog').showModal();
  } catch (error) {
    toast(error.message, true);
  }
});
async function poll() {
  const epoch = mutationEpoch;
  try {
    const data = await request('/api/state');
    defaults = data.defaults;
    if (epoch === mutationEpoch) receive(data.session);
  } catch (error) {
    if (!$('toast').textContent.includes('连接'))
      toast('本地 Demo 连接暂时中断，恢复连接后会读取保存的进度。', true);
  } finally {
    setTimeout(poll, 650);
  }
}
renderWelcome();
void poll();
