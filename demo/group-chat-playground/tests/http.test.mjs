import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename } from 'node:path';
import { createDemoServer } from '../server.mjs';
async function serve(t, options = {}) {
  const app = await createDemoServer({ statePath: null, tickMs: 0, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie;
  async function call(path, data, extraHeaders = {}) {
    const response = await fetch(base + path, {
      method: data ? 'POST' : 'GET',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Type': 'application/json', Origin: base } : {}),
        ...extraHeaders,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    if (response.headers.has('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    const text = await response.text();
    return {
      status: response.status,
      data: text.startsWith('{') ? JSON.parse(text) : text,
      response,
    };
  }
  await call('/api/state');
  return { app, call, base };
}
test('HTTP player state/context have no foreign card table; actor override is rejected', async (t) => {
  const { call } = await serve(t, { testOverrides: { pairIndex: 0, undercoverIndex: 1 } });
  const started = await call('/api/start', {
    requestId: randomUUID(),
    kind: 'game',
    role: 'player',
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.session.ownPrivate.card.word, '豆浆');
  assert.equal(JSON.stringify(started.data).includes('牛奶'), false);
  assert.equal((await call('/api/context')).data.assignments, undefined);
  assert.equal((await call('/api/context?actor=host')).status, 400);
  assert.equal(
    (
      await call('/api/action', {
        requestId: randomUUID(),
        sessionId: started.data.session.id,
        action: 'chat',
        text: '你好',
        actor: 'host',
      })
    ).status,
    400,
  );
  assert.equal((await call('/api/cards/b')).status, 404);
});
test('another browser receives its own empty room, not a global game', async (t) => {
  const { call, base } = await serve(t);
  await call('/api/start', { requestId: randomUUID(), kind: 'game' });
  const stranger = await fetch(base + '/api/state');
  const data = await stranger.json();
  assert.equal(data.session, null);
});
test('duplicate start request does not reshuffle cards or recreate activity', async (t) => {
  const { call } = await serve(t);
  const payload = { requestId: randomUUID(), kind: 'game' };
  const first = await call('/api/start', payload);
  const again = await call('/api/start', payload);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.session.id, first.data.session.id);
  assert.deepEqual(again.data.session.ownPrivate, first.data.session.ownPrivate);
});
test('explicit non-player host has assignments; player cannot change role in action', async (t) => {
  const { call } = await serve(t);
  const host = await call('/api/start', { requestId: randomUUID(), kind: 'game', role: 'host' });
  assert.equal(host.data.session.assignments.length, 5);
  const action = await call('/api/action', {
    requestId: randomUUID(),
    sessionId: host.data.session.id,
    action: 'chat',
    text: '测试',
    role: 'player',
  });
  assert.equal(action.status, 400);
});
test('cross-origin mutation rejected; artifacts and traversal not exposed', async (t) => {
  const { call } = await serve(t);
  assert.equal(
    (
      await call(
        '/api/start',
        { requestId: randomUUID(), kind: 'game' },
        { Origin: 'https://foreign.invalid' },
      )
    ).status,
    403,
  );
  assert.equal((await call('/api/artifacts/not-a-real-id')).status, 404);
  assert.equal((await call('/../engine.mjs')).status, 404);
});
test('same browser restores persisted game at exact paused position', async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sync-think-demo-test-'));
  // This test owns this freshly created directory, and no user files are stored here.
  t.after(() => {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith('sync-think-demo-test-'));
    return rm(target, { recursive: true, force: true });
  });
  const statePath = resolve(directory, 'state.json');
  const a = await createDemoServer({ statePath, tickMs: 0 });
  await new Promise((resolve) => a.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${a.server.address().port}`;
  const init = await fetch(base + '/api/state');
  const cookie = init.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
  const started = await (
    await fetch(base + '/api/start', {
      method: 'POST',
      headers,
      body: JSON.stringify({ requestId: randomUUID(), kind: 'game' }),
    })
  ).json();
  const paused = await (
    await fetch(base + '/api/action', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requestId: randomUUID(),
        sessionId: started.session.id,
        action: 'pause',
      }),
    })
  ).json();
  await a.close();
  const b = await createDemoServer({ statePath, tickMs: 0 });
  await new Promise((resolve) => b.server.listen(0, '127.0.0.1', resolve));
  t.after(() => b.close());
  const restored = await (
    await fetch(`http://127.0.0.1:${b.server.address().port}/api/state`, {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.equal(restored.session.id, paused.session.id);
  assert.equal(restored.session.status, 'paused');
  assert.equal(restored.session.currentActor, paused.session.currentActor);
  assert.deepEqual(restored.session.ownPrivate, paused.session.ownPrivate);
});
