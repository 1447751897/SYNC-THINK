import assert from 'node:assert/strict';
import test from 'node:test';
import { authRequest, authErrorMessage, validatePassword } from '../auth-client.js';

test('sends credentials only to the same-origin auth endpoint', async () => {
  const calls = [];
  const result = await authRequest(
    'sign-in/email',
    { email: 'demo@example.com', password: 'example-password' },
    async (...args) => {
      calls.push(args);
      return new Response(JSON.stringify({ user: { name: 'Demo' } }));
    },
  );
  assert.equal(calls[0][0], '/api/auth/sign-in/email');
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(result.user.name, 'Demo');
});

test('rejects endpoint injection before making any request', async () => {
  for (const path of ['https://example.com', '../account', '/sign-in/email']) {
    await assert.rejects(
      authRequest(path, {}, () => {
        throw new Error('request must not run');
      }),
      /endpoint/,
    );
  }
});

test('session lookup uses GET and bypasses caches', async () => {
  await authRequest('get-session', undefined, async (_url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.body, undefined);
    return new Response('null');
  });
});

test('maps server auth errors without showing server internals', async () => {
  await assert.rejects(
    authRequest(
      'sign-in/email',
      {},
      async () =>
        new Response(
          JSON.stringify({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'private internal detail' }),
          { status: 401 },
        ),
    ),
    (error) => {
      assert.equal(error.code, 'INVALID_EMAIL_OR_PASSWORD');
      assert.equal(error.message, '邮箱或密码有误，请重新输入。');
      return true;
    },
  );
  assert.equal(authErrorMessage('UNKNOWN', 429), '操作太频繁，请稍后再试。');
});

test('network failures produce an actionable message', async () => {
  await assert.rejects(
    authRequest('get-session', undefined, async () => {
      throw new TypeError('Failed to fetch');
    }),
    /连接中断/,
  );
});

test('new password validation matches server length contract', () => {
  assert.equal(validatePassword('short'), false);
  assert.equal(validatePassword('correct horse battery staple'), true);
  assert.equal(validatePassword('x'.repeat(129)), false);
});
