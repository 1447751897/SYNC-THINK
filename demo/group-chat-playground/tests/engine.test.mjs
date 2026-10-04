import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  projectSession,
  contextFor,
  advanceSession,
  humanDescribe,
  humanVote,
  publicChat,
  beginVote,
  pause,
  resume,
  requestInterruption,
} from '../engine.mjs';

const game = () => createSession({ pairIndex: 0, undercoverIndex: 1, delay: 10 }, 0);
const clocks = new WeakMap();
function ticks(s, until, limit = 150) {
  for (let n = 0; n < limit; n++) {
    if (until(s)) return;
    const now =
      Math.max(clocks.get(s) ?? 100000, s.pending?.due ?? 0, ...s.questions.map((q) => q.due)) +
      100;
    clocks.set(s, now);
    if (
      s.kind === 'game' &&
      ['describe', 'tie-describe'].includes(s.phase) &&
      s.turnOrder[s.turnIndex] === 'you'
    )
      humanDescribe(s, '这个东西在日常生活里挺常见的。', now);
    else if (!advanceSession(s, now))
      throw new Error('No next action while advancing test: ' + s.phase);
  }
  throw new Error('Test did not reach expected condition');
}
function voting(s) {
  ticks(s, (s) => s.phase === 'discussion');
  beginVote(s, 200000);
}

test('player projection returns only own card and no assignment table', () => {
  const s = game();
  for (const player of s.players)
    if (player.id !== 'you') s.private.cards[player.id].word = 'FOREIGN_' + player.id;
  const output = JSON.stringify(projectSession(s));
  assert.equal(output.includes('FOREIGN_'), false);
  assert.equal(output.includes('assignments'), false);
  assert.equal(output.includes('undercover'), false);
  assert.equal(projectSession(s).ownPrivate.card.word, '豆浆');
});
test('simulated player contexts isolate all other private notes and cards', () => {
  const s = game();
  s.private.notes.a = 'NOTE_ONLY_A';
  s.private.notes.b = 'NOTE_ONLY_B';
  const a = contextFor(s, 'a');
  assert.equal(a.ownPrivate.note, 'NOTE_ONLY_A');
  assert.equal(JSON.stringify(a).includes('NOTE_ONLY_B'), false);
  assert.equal(a.ownPrivate.card.word, '豆浆');
  assert.equal(a.assignments, undefined);
  assert.equal(JSON.stringify(a).includes('牛奶'), false);
});
test('host knows assignments but does not acquire player private notes', () => {
  const s = game();
  s.private.notes.b = 'B_PRIVATE_STRATEGY';
  const ctx = contextFor(s, 'host');
  assert.equal(ctx.assignments.length, 5);
  assert.equal(ctx.assignments.find((p) => p.id === 'b').word, '牛奶');
  assert.equal(JSON.stringify(ctx).includes('B_PRIVATE_STRATEGY'), false);
});
test('player does not know alignment before elimination', () => {
  const s = game();
  assert.equal(contextFor(s, 'b').ownPrivate.revealedRole, undefined);
  assert.equal(projectSession(s).players.find((p) => p.id === 'b').revealedRole, undefined);
});
test('out-of-turn description is rejected without progressing', () => {
  const s = game();
  const before = s.revision;
  assert.throws(() => humanDescribe(s, '这是我想到的线索。'), /没轮到/);
  assert.equal(s.revision, before);
  assert.equal(s.turnIndex, 0);
});
test('human is invited after two real simulated bot submissions', () => {
  const s = game();
  ticks(s, (s) => s.turnOrder[s.turnIndex] === 'you');
  assert.deepEqual(
    s.messages.filter((m) => m.type === 'description').map((m) => m.sender),
    ['a', 'b'],
  );
  assert.equal(projectSession(s).progress.waitingForYou, true);
});
test('human literal own word is rejected without leaking it publicly', () => {
  const s = game();
  ticks(s, (s) => s.turnOrder[s.turnIndex] === 'you');
  const before = s.messages.length;
  assert.throws(() => humanDescribe(s, '我的词是豆浆。'), /直接包含/);
  assert.equal(s.messages.length, before);
  assert.equal(s.turnOrder[s.turnIndex], 'you');
});
test('every alive player describes once before discussion', () => {
  const s = game();
  ticks(s, (s) => s.phase === 'discussion');
  assert.deepEqual(
    s.messages.filter((m) => m.type === 'description').map((m) => m.sender),
    ['a', 'b', 'you', 'c', 'd'],
  );
});
test('a public suspicion or mention does not count as a vote', () => {
  const s = game();
  voting(s);
  publicChat(s, '我怀疑阿岚是卧底，@阿岚 你再说一句。', 0);
  assert.equal(Object.keys(s.ballots).length, 0);
  assert.equal(s.questions[0].actor, 'a');
});
test('targeted public question replies directly and does not change formal turn', () => {
  const s = game();
  ticks(s, (s) => s.turnOrder[s.turnIndex] === 'you');
  publicChat(s, '@阿岚 能补充一点线索吗？', 0);
  advanceSession(s, 1000);
  assert.equal(s.messages.at(-1).sender, 'a');
  assert.equal(s.turnOrder[s.turnIndex], 'you');
});
test('live ballots are absent from player and bot contexts', () => {
  const s = game();
  voting(s);
  s.ballots.a = 'b';
  const snapshot = projectSession(s);
  const ctx = contextFor(s, 'b');
  assert.equal(snapshot.progress.voted, 1);
  assert.equal(snapshot.ballots, undefined);
  assert.equal(snapshot.lastResult, null);
  assert.equal(ctx.ballots, undefined);
});
test('self votes and duplicate human votes are rejected', () => {
  const s = game();
  voting(s);
  assert.throws(() => humanVote(s, 'you'), /其他存活/);
  humanVote(s, 'a');
  assert.throws(() => humanVote(s, 'b'), /只接受一张票/);
  assert.equal(s.ballots.you, 'a');
});
test('new round preserves words and describes again excluding eliminated players', () => {
  const s = game();
  const cards = structuredClone(s.private.cards);
  voting(s);
  s.ballots = { a: 'd', b: 'd', c: 'a', d: 'a' };
  humanVote(s, 'd', 0);
  assert.equal(s.phase, 'results');
  ticks(s, (s) => s.round === 2 && s.phase === 'discussion');
  assert.deepEqual(s.private.cards, cards);
  assert.deepEqual(
    s.messages.filter((m) => m.type === 'description' && m.round === 2).map((m) => m.sender),
    ['a', 'b', 'you', 'c'],
  );
});
test('tie prompts limited candidate descriptions and then a revote', () => {
  const s = game();
  voting(s);
  s.ballots = { a: 'b', b: 'a', c: 'a', d: 'c' };
  humanVote(s, 'b', 0);
  assert.equal(s.phase, 'tie-describe');
  assert.deepEqual(s.voteCandidates, ['a', 'b']);
  ticks(s, (s) => s.phase === 'vote');
  assert.equal(s.votePass, 2);
  assert.equal(Object.keys(s.ballots).length, 0);
});
test('undercover eliminated ends game and only then reveals word cards', () => {
  const s = game();
  voting(s);
  s.ballots = { a: 'b', b: 'a', c: 'b', d: 'b' };
  humanVote(s, 'b', 0);
  const projected = projectSession(s);
  assert.equal(s.winner, '平民胜利');
  assert.equal(s.status, 'completed');
  assert.equal(projected.reveal.length, 5);
  assert.equal(projected.reveal.find((p) => p.id === 'b').word, '牛奶');
});
test('system interruption resumes original slot without duplicate description', () => {
  const s = game();
  const original = s.pending.id;
  requestInterruption(s);
  advanceSession(s, 1000);
  assert.equal(s.pending.type, 'recover');
  assert.equal(s.messages.filter((m) => m.type === 'description').length, 0);
  advanceSession(s, 2000);
  assert.equal(s.pending.id, original);
  advanceSession(s, 3000);
  assert.equal(s.messages.filter((m) => m.type === 'description' && m.sender === 'a').length, 1);
  assert.equal(projectSession(s).progress.recoveries, 1);
});
test('user pause wins over a queued system recovery', () => {
  const s = game();
  requestInterruption(s);
  advanceSession(s, 1000);
  pause(s);
  const length = s.messages.length;
  assert.equal(advanceSession(s, 900000), false);
  assert.equal(s.messages.length, length);
  assert.equal(s.pending.type, 'recover');
  resume(s, 0);
  advanceSession(s, 1000);
  advanceSession(s, 2000);
  assert.equal(s.messages.filter((m) => m.type === 'description' && m.sender === 'a').length, 1);
});
test('automatic recovery budget is cumulative across attempts of same action', () => {
  const s = game();
  for (let n = 0; n < 2; n++) {
    requestInterruption(s);
    advanceSession(s, 10000 + n * 1000);
    advanceSession(s, 10100 + n * 1000);
  }
  requestInterruption(s);
  advanceSession(s, 20000);
  assert.equal(s.status, 'paused');
  assert.equal(s.pauseCause, 'recovery_budget');
});
test('work handoff preserves goal and publishes three downloadable document bodies', () => {
  const goal = '目标 CANARY_GOAL：完善本群协作。';
  const s = createSession({ kind: 'work', goal, delay: 10 }, 0);
  ticks(s, (s) => s.workIndex === 1);
  const ctx = contextFor(s, 'b');
  assert.equal(ctx.goal, goal);
  assert.equal(ctx.goalRevision, 1);
  assert.equal(ctx.assignment.actor, 'b');
  assert.equal(ctx.publishedArtifacts.length, 1);
  ticks(s, (s) => s.status === 'completed');
  assert.equal(s.artifacts.length, 3);
  assert.ok(s.artifacts.every((a) => a.content.includes(goal) && a.published));
  assert.equal(s.messages.filter((m) => m.type === 'handoff').length, 3);
});
test('work interruption keeps prior publication and resumes same logical work', () => {
  const s = createSession({ kind: 'work', delay: 10 }, 0);
  ticks(s, (s) => s.workIndex === 1);
  const first = s.artifacts[0].id;
  requestInterruption(s);
  advanceSession(s, 300000);
  advanceSession(s, 400000);
  ticks(s, (s) => s.status === 'completed');
  assert.equal(s.artifacts[0].id, first);
  assert.equal(new Set(s.artifacts.map((a) => a.author)).size, 3);
});
test('persisted JSON round-trips game checkpoint and secret assignment', () => {
  const s = game();
  ticks(s, (s) => s.turnOrder[s.turnIndex] === 'you');
  pause(s);
  const restored = JSON.parse(JSON.stringify(s));
  assert.deepEqual(restored.private.cards, s.private.cards);
  assert.equal(restored.turnIndex, s.turnIndex);
  resume(restored, 0);
  humanDescribe(restored, '日常能碰到的东西。', 0);
  assert.equal(restored.turnOrder[restored.turnIndex], 'c');
});

test('all fifteen host-only word/role configurations progress to a bounded ending', () => {
  for (let pairIndex = 0; pairIndex < 3; pairIndex++) {
    for (let undercoverIndex = 0; undercoverIndex < 5; undercoverIndex++) {
      const s = createSession({ role: 'host', pairIndex, undercoverIndex, delay: 1 }, 0);
      for (let step = 0; s.status !== 'completed' && step < 1000; step++) {
        assert.ok(s.pending, 'Host-only game unexpectedly waits for a human');
        assert.equal(advanceSession(s, s.pending.due + 1), true);
      }
      assert.equal(s.status, 'completed'); assert.ok(s.round <= 8);
      const seats = s.messages.filter(m => m.type === 'description').map(m => `${m.round}:${m.sender}`);
      // Tie candidates may describe once more; normal-round invitations are unique in submissions.
      assert.ok(seats.length >= 5);
    }
  }
});
