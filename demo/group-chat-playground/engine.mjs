import { randomUUID, randomInt } from 'node:crypto';

export const DEFAULT_GAME_DESCRIPTION =
  '本群用于谁是卧底。主持人不参赛，负责私密发词、逐人点名、组织讨论与投票。每轮所有存活玩家各描述一次；公开怀疑不等于投票。词卡只给本人，玩家间不开放私下串词。';
export const DEFAULT_WORK_DESCRIPTION =
  '本群围绕用户确定的总目标协作。阿岚拆解目标，小满形成方案，远舟核对验收。允许成员直接咨询和交接；产物发布到群。系统异常由协调员核对检查点后续跑，用户暂停则保持暂停。';
const CATALOG = [
  {
    words: ['豆浆', '牛奶'],
    clues: [
      ['常见的早餐饮品。', '通常由植物原料加工而来。', '现磨的版本很常见。', '有时候会配油条。'],
      ['常见的早餐饮品。', '经常能买到盒装的。', '通常会强调蛋白质。', '它的来源与动物有关。'],
    ],
    tags: [
      ['早餐', '饮品', '植物', '加工', '现磨', '油条'],
      ['早餐', '饮品', '盒装', '蛋白质', '动物'],
    ],
  },
  {
    words: ['雨伞', '雨衣'],
    clues: [
      [
        '坏天气出门时可能会用到。',
        '不用时能收起来。',
        '它通常靠手握住。',
        '有时可以两个人一起用。',
      ],
      [
        '坏天气出门时可能会用到。',
        '不用时能收起来。',
        '它通常直接穿在身上。',
        '骑车时使用比较方便。',
      ],
    ],
    tags: [
      ['天气', '出门', '收', '手', '握', '两个人'],
      ['天气', '出门', '收', '穿', '身上', '骑车'],
    ],
  },
  {
    words: ['地铁', '公交'],
    clues: [
      [
        '很多人通勤时会选择它。',
        '它有固定的站点。',
        '线路通常不会随路面车流改变。',
        '一般要经过闸机。',
      ],
      [
        '很多人通勤时会选择它。',
        '它有固定的站点。',
        '它与道路上的其他车辆一起行驶。',
        '交通拥堵会影响它。',
      ],
    ],
    tags: [
      ['通勤', '站点', '线路', '闸机', '路面'],
      ['通勤', '站点', '道路', '车辆', '拥堵'],
    ],
  },
];
const NAMES = {
  host: '主协调员',
  a: '阿岚',
  b: '小满',
  you: '你',
  c: '远舟',
  d: '未央',
  e: '木白',
};
const ROLE_NAMES = { a: '目标拆解', b: '方案执行', c: '验收核对' };
export class DemoError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}
const clone = (value) => structuredClone(value);
const safeText = (value, max = 2000) =>
  String(value ?? '')
    .trim()
    .slice(0, max);
function message(s, sender, text, extra = {}) {
  const item = {
    id: randomUUID(),
    sequence: s.messages.length + 1,
    sender,
    text,
    createdAt: Date.now(),
    ...extra,
  };
  s.messages.push(item);
  s.revision++;
  return item;
}
function event(s, type, actor, note) {
  s.events.push({ id: randomUUID(), type, actor, note, at: Date.now() });
  s.revision++;
}
function schedule(s, type, actor, now, extra = {}) {
  s.pending = {
    id: randomUUID(),
    type,
    actor,
    due: now + s.delay,
    round: s.round,
    phase: s.phase,
    ...extra,
  };
  s.revision++;
}
export function createSession(
  {
    kind = 'game',
    role = 'player',
    goal,
    description,
    delay = 1700,
    pairIndex,
    undercoverIndex,
  } = {},
  now = Date.now(),
) {
  if (!['game', 'work'].includes(kind) || !['player', 'host'].includes(role))
    throw new DemoError('请选择有效的演示类型和角色。', 400);
  const s = {
    id: randomUUID(),
    kind,
    role,
    revision: 1,
    status: 'running',
    pauseCause: null,
    description: safeText(
      description || (kind === 'game' ? DEFAULT_GAME_DESCRIPTION : DEFAULT_WORK_DESCRIPTION),
      4000,
    ),
    goal:
      kind === 'work'
        ? safeText(goal || '设计一个能交接、能私聊、能从中断接续的群聊方案。', 4000)
        : '完成一局谁是卧底。',
    goalRevision: 1,
    descriptionRevision: 1,
    round: 1,
    phase: kind === 'game' ? 'describe' : 'work',
    delay,
    messages: [],
    events: [],
    artifacts: [],
    pending: null,
    questions: [],
    receipts: {},
    recoveryCounts: {},
    interruptRequested: false,
    private: { cards: {}, notes: {} },
    lastResult: null,
    winner: null,
    votePass: 1,
    voteCandidates: [],
    ballots: {},
    submissions: {},
    workIndex: 0,
  };
  if (kind === 'game') {
    s.players = (role === 'player' ? ['a', 'b', 'you', 'c', 'd'] : ['a', 'b', 'c', 'd', 'e']).map(
      (id) => ({ id, name: NAMES[id], alive: true }),
    );
    const pair = CATALOG[pairIndex ?? randomInt(CATALOG.length)];
    const chosen = undercoverIndex ?? randomInt(s.players.length);
    s.private.pair = clone(pair);
    s.private.undercover = s.players[chosen].id;
    for (const [index, player] of s.players.entries()) {
      s.private.cards[player.id] = { word: pair.words[index === chosen ? 1 : 0] };
      s.private.notes[player.id] = '先听公开描述，再比较与自己的词相关的线索。';
    }
    s.turnOrder = s.players.map((p) => p.id);
    s.turnIndex = 0;
    message(
      s,
      'host',
      `本局 5 名玩家、1 名卧底，无白板。词卡已私密保存。\n每轮依次描述，再讨论、秘密投票。卧底出局则平民胜；剩两名玩家且卧底仍在则卧底胜。`,
      { type: 'announcement' },
    );
    event(s, 'private_cards_saved', 'host', '仅保存发词状态，不公开词卡正文。');
    invite(s, now);
  } else {
    s.players = ['a', 'b', 'c'].map((id) => ({
      id,
      name: NAMES[id],
      alive: true,
      role: ROLE_NAMES[id],
    }));
    s.workSteps = [
      { actor: 'a', title: '拆解目标与输入', status: 'active', consulted: false },
      { actor: 'b', title: '形成执行方案', status: 'pending' },
      { actor: 'c', title: '核对验收清单', status: 'pending' },
    ];
    message(
      s,
      'host',
      `总目标已确定：${s.goal}\n@阿岚 先拆解目标，发布成果后直接交给小满。普通咨询不必经我转述。`,
      { recipients: ['a'], type: 'handoff' },
    );
    schedule(s, 'work', 'a', now);
  }
  return s;
}
function alive(s) {
  return s.players.filter((p) => p.alive);
}
function currentActor(s) {
  return s.kind === 'work'
    ? s.workSteps[s.workIndex]?.actor
    : ['describe', 'tie-describe'].includes(s.phase)
      ? s.turnOrder[s.turnIndex]
      : null;
}
function invite(s, now) {
  const actor = currentActor(s);
  message(
    s,
    'host',
    `@${NAMES[actor]} ${s.phase === 'tie-describe' ? '平票补充描述' : `第 ${s.round} 轮描述`}，轮到你了。`,
    { recipients: [actor], type: 'turn_invitation' },
  );
  event(s, 'turn_invited', actor, '已发起真实的模拟投递。');
  if (actor !== 'you') schedule(s, 'describe', actor, now);
  else s.pending = null;
}
// The same projection boundary is used by human APIs and simulated players.
// Players never receive the truth table, other players' notes, or other ballots.
export function contextFor(s, actor) {
  const isHost = actor === 'host';
  const card = s.private.cards[actor];
  const knownRole =
    s.players.find((p) => p.id === actor)?.alive === false
      ? s.private.undercover === actor
        ? '卧底'
        : '平民'
      : undefined;
  return {
    actorId: actor,
    sessionId: s.id,
    kind: s.kind,
    goal: s.goal,
    goalRevision: s.goalRevision,
    groupDescription: s.description,
    phase: s.phase,
    round: s.round,
    currentActor: currentActor(s),
    members: s.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, role: p.role })),
    publicMessages: clone(s.messages),
    ownPrivate: {
      ...(card ? { card: clone(card) } : {}),
      ...(s.private.notes[actor] ? { note: s.private.notes[actor] } : {}),
      ...(knownRole ? { revealedRole: knownRole } : {}),
    },
    ...(isHost && s.kind === 'game'
      ? {
          assignments: s.players.map((p) => ({
            id: p.id,
            name: p.name,
            word: s.private.cards[p.id].word,
            role: s.private.undercover === p.id ? '卧底' : '平民',
          })),
        }
      : {}),
    ...(s.kind === 'work'
      ? {
          assignment: clone(s.workSteps.find((step) => step.actor === actor)),
          publishedArtifacts: clone(s.artifacts),
        }
      : {}),
  };
}
export function projectSession(s) {
  if (!s) return null;
  const actor = s.kind === 'game' && s.role === 'host' ? 'host' : 'you';
  const context = contextFor(s, actor);
  const players = s.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    role: p.role,
    ...(s.kind === 'game' && (!p.alive || s.status === 'completed')
      ? { revealedRole: s.private.undercover === p.id ? '卧底' : '平民' }
      : {}),
  }));
  return {
    id: s.id,
    kind: s.kind,
    role: s.role,
    revision: s.revision,
    status: s.status,
    pauseCause: s.pauseCause,
    description: s.description,
    goal: s.goal,
    round: s.round,
    phase: s.phase,
    players,
    currentActor: currentActor(s),
    currentName: NAMES[currentActor(s)],
    messages: clone(s.messages),
    artifacts: clone(s.artifacts),
    progress: {
      described: Object.keys(s.submissions).filter((key) =>
        key.startsWith(`${s.round}:${s.phase}:`),
      ).length,
      alive: alive(s).length,
      voted: Object.keys(s.ballots).length,
      votePass: s.votePass,
      ownVoteSubmitted: Object.hasOwn(s.ballots, 'you'),
      candidates: [...s.voteCandidates],
      workSteps: clone(s.workSteps ?? []),
      recoveries: Object.values(s.recoveryCounts).reduce((sum, value) => sum + value, 0),
      canInterrupt: Boolean(s.pending && s.pending.type !== 'recover'),
      waitingForYou:
        s.kind === 'game' &&
        s.role === 'player' &&
        (currentActor(s) === 'you' ||
          (s.phase === 'vote' &&
            alive(s).some((p) => p.id === 'you') &&
            !Object.hasOwn(s.ballots, 'you'))),
      actorStatus:
        s.pending?.type === 'recover' ? 'recovering' : s.pending ? 'processing' : 'waiting',
    },
    ownPrivate: context.ownPrivate,
    ...(context.assignments ? { assignments: context.assignments } : {}),
    lastResult: clone(s.lastResult),
    winner: s.winner,
    events: clone(s.events.slice(-40)),
    ...(s.status === 'completed' && s.kind === 'game'
      ? {
          reveal: s.players.map((p) => ({
            id: p.id,
            name: p.name,
            word: s.private.cards[p.id].word,
            role: s.private.undercover === p.id ? '卧底' : '平民',
          })),
        }
      : {}),
  };
}
function guard(s, phase) {
  if (s.status !== 'running')
    throw new DemoError(s.status === 'paused' ? '当前已暂停，请先继续。' : '这次活动已经结束。');
  if (phase && s.phase !== phase) throw new DemoError('当前阶段不接受这个动作。');
}
function validPublicText(s, actor, text) {
  text = safeText(text);
  if (!text) throw new DemoError('请先输入内容。', 400);
  if (
    s.kind === 'game' &&
    s.status !== 'completed' &&
    text.includes(s.private.cards[actor]?.word ?? '\u0000')
  )
    throw new DemoError('这句话直接包含你自己的词，请换一种描述。', 422);
  return text;
}
function describe(s, actor, text, now) {
  guard(s);
  if (!['describe', 'tie-describe'].includes(s.phase) || currentActor(s) !== actor)
    throw new DemoError('现在还没轮到你描述；公开聊天与正式描述是不同动作。');
  text = validPublicText(s, actor, text);
  const key = `${s.round}:${s.phase}:${actor}`;
  if (s.submissions[key]) throw new DemoError('本轮描述已经提交。');
  s.submissions[key] = true;
  message(s, actor, text, { type: 'description', round: s.round });
  event(s, 'description_committed', actor, '已提交一次有效描述。');
  s.pending = null;
  s.turnIndex++;
  if (s.turnIndex < s.turnOrder.length) invite(s, now);
  else if (s.phase === 'tie-describe') beginVote(s, now, true);
  else {
    s.phase = 'discussion';
    s.revision++;
    message(
      s,
      'host',
      '本轮所有存活玩家已描述。现在可以公开 @ 追问或说出怀疑；这些意见不计票。准备好后点击“请求进入投票”。',
      { type: 'announcement' },
    );
    if (s.role === 'host' || !alive(s).some((p) => p.id === 'you'))
      schedule(s, 'begin-vote', 'host', now + s.delay * 2);
  }
}
function clueFrom(context, extra = 0) {
  const word = context.ownPrivate.card.word;
  const pair = CATALOG.find((p) => p.words.includes(word));
  const list = pair.clues[pair.words.indexOf(word)];
  const seat = context.members.findIndex((p) => p.id === context.actorId);
  return list[(context.round - 1 + Math.max(0, seat) + extra) % list.length];
}
function chooseVote(context, candidates) {
  const word = context.ownPrivate.card.word;
  const pair = CATALOG.find((p) => p.words.includes(word));
  const tags = pair.tags[pair.words.indexOf(word)];
  const scored = candidates.map((target) => {
    const utterances = context.publicMessages
      .filter((m) => m.sender === target && ['description', 'chat'].includes(m.type))
      .map((m) => m.text)
      .join(' ');
    const otherTags = pair.tags[1 - pair.words.indexOf(word)].filter((tag) => !tags.includes(tag));
    const otherHits = otherTags.reduce((n, tag) => n + (utterances.includes(tag) ? 1 : 0), 0);
    // Only their own word and PUBLIC clues are used, never the actual undercover id.
    return { target, score: otherHits * 3 };
  });
  const max = Math.max(...scored.map((item) => item.score));
  const tied = scored.filter((item) => item.score === max);
  const hash =
    [...context.sessionId].reduce((n, char) => n + char.charCodeAt(0), 0) +
    context.round +
    word.length +
    candidates.length +
    context.actorId.charCodeAt(0);
  return tied[hash % tied.length].target;
}
export function humanDescribe(s, text, now = Date.now()) {
  if (s.role !== 'player') throw new DemoError('主持视角不参与玩家描述。');
  describe(s, 'you', text, now);
}
export function beginVote(s, now = Date.now(), revote = false) {
  guard(s, revote ? 'tie-describe' : 'discussion');
  s.phase = 'vote';
  s.ballots = {};
  s.pending = null;
  s.revision++;
  if (!revote) {
    s.votePass = 1;
    s.voteCandidates = alive(s).map((p) => p.id);
  }
  message(
    s,
    'host',
    `${revote ? '开始重投' : '开始秘密投票'}。每位存活玩家一票，不自投；收齐后统一公布。`,
    { type: 'announcement' },
  );
  queueNextVoter(s, now);
}
function queueNextVoter(s, now) {
  const next = alive(s).find((p) => p.id !== 'you' && !Object.hasOwn(s.ballots, p.id));
  if (next) schedule(s, 'vote', next.id, now);
  else s.pending = null;
}
function vote(s, actor, target, now) {
  guard(s, 'vote');
  if (!alive(s).some((p) => p.id === actor)) throw new DemoError('出局成员不参与投票。');
  if (
    !s.voteCandidates.includes(target) ||
    !alive(s).some((p) => p.id === target) ||
    target === actor
  )
    throw new DemoError('请选择有效的其他存活玩家。', 422);
  if (Object.hasOwn(s.ballots, actor)) throw new DemoError('你的票已保存，本轮只接受一张票。');
  s.ballots[actor] = target;
  s.revision++;
  event(s, 'vote_committed', actor, '票已私密保存，未公开选择。');
  if (Object.keys(s.ballots).length === alive(s).length) settle(s, now);
  else if (actor !== 'you') queueNextVoter(s, now);
}
export function humanVote(s, target, now = Date.now()) {
  if (s.role !== 'player') throw new DemoError('主持视角不参与玩家投票。');
  vote(s, 'you', target, now);
}
function settle(s, now) {
  const counts = Object.fromEntries(s.voteCandidates.map((id) => [id, 0]));
  for (const target of Object.values(s.ballots)) counts[target]++;
  const max = Math.max(...Object.values(counts));
  const tied = Object.keys(counts).filter((id) => counts[id] === max);
  s.lastResult = {
    round: s.round,
    pass: s.votePass,
    counts,
    votes: clone(s.ballots),
    eliminated: tied.length === 1 ? tied[0] : null,
  };
  s.pending = null;
  message(
    s,
    'host',
    `票数已结算：${Object.entries(counts)
      .map(([id, n]) => `${NAMES[id]} ${n} 票`)
      .join('，')}。`,
    { type: 'result' },
  );
  if (tied.length > 1 && s.votePass === 1) {
    s.votePass = 2;
    s.voteCandidates = tied;
    s.phase = 'tie-describe';
    s.turnOrder = tied;
    s.turnIndex = 0;
    message(s, 'host', '出现平票。候选人各补充描述一次，然后重投；再次平票则本轮无人出局。', {
      type: 'announcement',
    });
    invite(s, now);
    return;
  }
  if (tied.length === 1) {
    s.players.find((p) => p.id === tied[0]).alive = false;
    const role = tied[0] === s.private.undercover ? '卧底' : '平民';
    message(s, 'host', `${NAMES[tied[0]]} 出局，身份为${role}。`, { type: 'result' });
    if (role === '卧底') return finishGame(s, '平民胜利');
    if (alive(s).length <= 2) return finishGame(s, '卧底胜利');
  } else message(s, 'host', '再次平票，本轮无人出局。', { type: 'result' });
  if (s.round >= 8) return finishGame(s, '达到 Demo 的八轮上限，本局平局');
  s.phase = 'results';
  schedule(s, 'next-round', 'host', now + s.delay);
}
function finishGame(s, winner) {
  s.winner = winner;
  s.status = 'completed';
  s.phase = 'ended';
  s.pending = null;
  s.revision++;
  message(s, 'host', `${winner}。本局结束，现在揭晓词对和身份；私人笔记仍不公开。`, {
    type: 'result',
  });
}
function nextRound(s, now) {
  s.round++;
  s.phase = 'describe';
  s.votePass = 1;
  s.voteCandidates = [];
  s.ballots = {};
  s.turnOrder = alive(s).map((p) => p.id);
  s.turnIndex = 0;
  message(s, 'host', `第 ${s.round} 轮开始。词卡保持不变，所有存活玩家再次各描述一次。`, {
    type: 'announcement',
  });
  invite(s, now);
}
export function publicChat(s, text, now = Date.now()) {
  if (s.status === 'paused') throw new DemoError('演示已暂停，请先继续。');
  text = validPublicText(s, 'you', text);
  message(s, s.kind === 'game' && s.role === 'host' ? 'host' : 'you', text, { type: 'chat' });
  const match = s.players.find(
    (p) => text.includes(`@${p.name}`) || text.includes(`@${p.id.toUpperCase()}`),
  );
  if (match && match.id !== 'you' && (s.kind === 'work' || match.alive)) {
    s.questions.push({ id: randomUUID(), actor: match.id, text, due: now + 900 });
    s.revision++;
    event(s, 'question_delivered', match.id, '公开点名只唤醒目标回答，不改变正式回合。');
  } else if (/投票|投给|卧底/.test(text) && s.kind === 'game') {
    message(
      s,
      'host',
      s.phase === 'vote'
        ? '公开意见已记录；请在投票区提交正式选择，这条聊天不计票。'
        : '怀疑可以公开讨论；正式选择会在投票阶段提交。',
      { type: 'notice' },
    );
  }
}
function workArtifact(s, actor) {
  const titles = { a: '目标与输入概览', b: '执行方案草案', c: '验收检查清单' };
  const bodies = {
    a: `## 用户总目标\n${s.goal}\n\n## 拆解\n- 明确交付范围与验收要求。\n- 收集当前群已有输入，缺失项定向咨询。\n- 下游接球人同时读取总目标和本成果，而非只读一句交接。`,
    b: `## 总目标\n${s.goal}\n\n## 执行方案\n1. 沿群规则确认当前有界工作。\n2. 成员可直接 @ 咨询；只把需要的答案带回原任务。\n3. 发布成果与版本，再交给验收成员。\n4. 异常先查检查点，优先续做原任务。\n\n## 上游输入\n${s.artifacts.map((a) => a.title).join('、')}`,
    c: `## 总目标\n${s.goal}\n\n## 待执行的验收清单\n- [ ] 接球人收到正确目标和输入成果。\n- [ ] 群中有实际交付，而非仅有完成声明。\n- [ ] 公开 / 私密范围在读取入口校验。\n- [ ] 中断恢复保留已完成工作。\n\n此清单尚未对真实项目运行，不代表真实测试已通过。`,
  };
  return {
    id: randomUUID(),
    author: actor,
    title: titles[actor],
    version: 1,
    filename: `${titles[actor]}.md`,
    content: `# ${titles[actor]}\n\n> 本地规则模拟产物：未调用真实模型、未检索或修改你的项目。\n\n${bodies[actor]}\n`,
    published: true,
  };
}
function advanceWork(s, p, now) {
  const step = s.workSteps[s.workIndex];
  if (step.actor === 'a' && !step.consulted) {
    step.consulted = true;
    message(s, 'a', '@小满 为落实当前总目标，先确认：交接是否应带上总目标和上游成果？', {
      type: 'consult',
      recipients: ['b'],
    });
    schedule(s, 'work-consult', 'b', now);
    return;
  }
  const artifact = workArtifact(s, step.actor);
  s.artifacts.push(artifact);
  step.status = 'done';
  message(s, step.actor, `已发布《${artifact.title}》v1。`, {
    type: 'artifact',
    artifactId: artifact.id,
  });
  event(s, 'artifact_published', step.actor, '成果已保存并公开，保留版本与来源。');
  s.workIndex++;
  const next = s.workSteps[s.workIndex];
  if (next) {
    next.status = 'active';
    message(
      s,
      step.actor,
      `@${NAMES[next.actor]} 请继续“${next.title}”。读取本轮总目标与《${artifact.title}》v1。`,
      { type: 'handoff', recipients: [next.actor] },
    );
    schedule(s, 'work', next.actor, now);
  } else {
    s.status = 'completed';
    s.phase = 'ended';
    s.pending = null;
    message(
      s,
      'host',
      '三个模拟产物均已发布，交接演示完成。群里展示成果，底层保留过程与检查点；这不表示已经完成真实项目任务。',
      { type: 'result' },
    );
  }
}
export function pause(s) {
  guard(s);
  s.status = 'paused';
  s.pauseCause = 'user';
  s.revision++;
  message(s, 'host', '你主动暂停了演示。已保留当前席位、产物与投票；自动唤醒停止。', {
    type: 'notice',
  });
}
export function resume(s, now = Date.now()) {
  if (s.status !== 'paused') throw new DemoError('当前没有需要继续的暂停。');
  s.status = 'running';
  s.pauseCause = null;
  s.revision++;
  if (s.pending) s.pending.due = now + s.delay;
  message(s, 'host', '收到你的继续指令，从保存的位置接着做；不重新发词，不重复已提交动作。', {
    type: 'notice',
  });
}
export function requestInterruption(s) {
  guard(s);
  if (!s.pending || s.pending.type === 'recover')
    throw new DemoError('当前在等待参与者输入，请在智能体执行时模拟中断。');
  s.interruptRequested = true;
  s.revision++;
}
export function advanceSession(s, now = Date.now()) {
  if (s.status === 'paused') return false;
  const p = s.status === 'running' ? s.pending : null;
  if (p && p.due <= now) {
    s.pending = null;
    if (s.interruptRequested && p.type !== 'recover') {
      s.interruptRequested = false;
      const n = (s.recoveryCounts[p.id] ?? 0) + 1;
      s.recoveryCounts[p.id] = n;
      event(s, 'interrupted', p.actor, '模拟系统中断；检查点保留。');
      message(s, 'host', `检测到${NAMES[p.actor]}执行中断。当前动作尚未提交，我先核对检查点。`, {
        type: 'recovery',
      });
      s.pending = {
        id: randomUUID(),
        type: 'recover',
        actor: 'host',
        original: p,
        due: now + s.delay,
        round: s.round,
        phase: s.phase,
      };
      if (n > 2) {
        s.status = 'paused';
        s.pauseCause = 'recovery_budget';
        message(s, 'host', '同一动作的自动恢复预算已用完，请核对后手动继续。', { type: 'notice' });
      }
      s.revision++;
      return true;
    }
    if (p.type === 'recover') {
      message(
        s,
        'host',
        `@${NAMES[p.original.actor]} 从原检查点继续同一${s.kind === 'game' ? '回合动作' : '任务'}；保留已完成内容。`,
        { type: 'recovery', recipients: [p.original.actor] },
      );
      s.pending = { ...p.original, due: now + s.delay };
      s.revision++;
    } else if (p.type === 'describe') {
      if (currentActor(s) === p.actor && p.round === s.round && p.phase === s.phase)
        describe(
          s,
          p.actor,
          clueFrom(contextFor(s, p.actor), s.phase === 'tie-describe' ? 1 : 0),
          now,
        );
    } else if (p.type === 'vote') {
      if (s.phase === 'vote' && p.round === s.round && !Object.hasOwn(s.ballots, p.actor)) {
        const ctx = contextFor(s, p.actor);
        const candidates = s.voteCandidates.filter((id) => id !== p.actor);
        vote(s, p.actor, chooseVote(ctx, candidates), now);
      }
    } else if (p.type === 'begin-vote') beginVote(s, now);
    else if (p.type === 'next-round') nextRound(s, now);
    else if (p.type === 'work-consult') {
      message(
        s,
        'b',
        '是的。当前总目标是“' +
          contextFor(s, 'b').goal +
          '”。交接应带目标版本和上游成果；我只补充这个答案，不另开任务。',
        { type: 'chat', recipients: ['a'] },
      );
      schedule(s, 'work', 'a', now);
    } else if (p.type === 'work') advanceWork(s, p, now);
    s.revision++;
    return true;
  }
  const q = s.questions.find((q) => q.due <= now);
  if (q && (!p || p.actor !== q.actor)) {
    s.questions = s.questions.filter((item) => item.id !== q.id);
    const ctx = contextFor(s, q.actor);
    const reply =
      s.kind === 'game'
        ? `回应你的追问：${clueFrom(ctx, 1)} 我只能依据自己的词与公开描述作判断。`
        : `当前总目标是“${ctx.goal}”。我负责${ROLE_NAMES[q.actor]}；这次答复属于公开咨询，不改变正式交接顺序。`;
    message(s, q.actor, reply, { type: 'chat', recipients: ['you'] });
    event(s, 'question_answered', q.actor, '答复已记入公共历史，主持人可读。');
    s.revision++;
    return true;
  }
  return false;
}
