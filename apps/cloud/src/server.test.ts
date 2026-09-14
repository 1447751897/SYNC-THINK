import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCloudConfig } from './config.js';
import { startCloudServer, type CloudServer, type CloudServerOptions } from './server.js';
import type { AuthMail } from './mail.js';

const servers: CloudServer[] = [];
const directories: string[] = [];
const links: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(links.splice(0).map((link) => unlink(link)));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(env: NodeJS.ProcessEnv = {}, options: CloudServerOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sync-think-cloud-'));
  directories.push(directory);
  const config = readCloudConfig({ CLOUD_PORT: '0', ...env }, directory);
  await mkdir(config.websiteDirectory, { recursive: true });
  await writeFile(
    join(config.websiteDirectory, 'auth.html'),
    '<!doctype html><title>Account</title>',
  );
  await writeFile(
    join(config.websiteDirectory, 'index.html'),
    '<!doctype html><title>SYNC-THINK</title>',
  );
  await writeFile(join(config.websiteDirectory, 'styles.css'), 'body { color: black; }');
  await writeFile(join(config.websiteDirectory, 'demo.html'), '<!doctype html><title>Demo</title>');
  await mkdir(join(config.websiteDirectory, 'assets'), { recursive: true });
  await writeFile(join(config.websiteDirectory, 'assets/chat-app.js'), 'document.title = "Demo";');
  await writeFile(join(config.websiteDirectory, 'assets/chat-shell.css'), 'body { color: black; }');
  await writeFile(join(config.websiteDirectory, 'private.sqlite'), 'PRIVATE_SENTINEL');
  const server = await startCloudServer(config, options);
  servers.push(server);
  return { server, config };
}

describe('cloud HTTP service', () => {
  it('allows only the canonical demo page to be framed by the same origin and blocks demo API connections', async () => {
    const { server } = await fixture();
    for (const method of ['GET', 'HEAD']) {
      for (const path of ['/demo', '/demo.html']) {
        const demo = await fetch(`${server.url}${path}`, { method });
        expect(demo.status).toBe(200);
        expect(demo.headers.get('x-frame-options')).toBe('SAMEORIGIN');
        const csp = demo.headers.get('content-security-policy');
        expect(csp).toContain("frame-ancestors 'self'");
        expect(csp).toContain("connect-src 'none'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("style-src 'self'");
        expect(csp).toContain("style-src 'self' 'unsafe-inline'");
        expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
        if (method === 'HEAD') expect(await demo.text()).toBe('');
      }
    }
    for (const path of ['/demo/', '/%64emo']) {
      const alias = await fetch(`${server.url}${path}`, { redirect: 'manual' });
      expect(alias.status).toBe(404);
      expect(alias.headers.get('x-frame-options')).toBe('DENY');
    }
    for (const path of ['/assets/chat-app.js', '/assets/chat-shell.css'])
      expect((await fetch(`${server.url}${path}`)).status).toBe(200);
    for (const path of ['/demo.js', '/demo.css'])
      expect((await fetch(`${server.url}${path}`)).status).toBe(404);
    for (const path of ['/', '/login', '/account', '/api/auth/get-session']) {
      const privatePage = await fetch(`${server.url}${path}`, { redirect: 'manual' });
      expect(privatePage.headers.get('x-frame-options')).toBe('DENY');
      expect(privatePage.headers.get('content-security-policy')).toContain(
        "frame-ancestors 'none'",
      );
    }
  });

  it('allows configured parent origins for the demo without relaxing account frame protection', async () => {
    const { server } = await fixture({
      CLOUD_EMBED_ORIGINS: 'https://portal.example.test,https://docs.example.test:8443',
    });
    for (const path of ['/demo?embed=1', '/demo.html?embed=1']) {
      const demo = await fetch(`${server.url}${path}`);
      expect(demo.status).toBe(200);
      expect(demo.headers.get('x-frame-options')).toBeNull();
      expect(demo.headers.get('content-security-policy')).toContain(
        "frame-ancestors 'self' https://portal.example.test https://docs.example.test:8443",
      );
      expect(demo.headers.get('content-security-policy')).toContain("connect-src 'none'");
    }
    const account = await fetch(`${server.url}/account`, { redirect: 'manual' });
    expect(account.headers.get('x-frame-options')).toBe('DENY');
    expect(account.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('rejects assets that resolve through a directory link outside the public website', async () => {
    const { server, config } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), 'sync-think-private-'));
    directories.push(outside);
    await writeFile(join(outside, 'private.png'), 'PRIVATE_LINK_SENTINEL');
    await mkdir(join(config.websiteDirectory, 'assets'), { recursive: true });
    const link = join(config.websiteDirectory, 'assets', 'outside');
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(link);
    const response = await fetch(`${server.url}/assets/outside/private.png`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('PRIVATE_LINK_SENTINEL');
  });

  it('serves public pages and explicit assets without exposing arbitrary files or account aliases', async () => {
    const { server } = await fixture();
    for (const path of [
      '/',
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password',
      '/styles.css',
    ]) {
      const page = await fetch(`${server.url}${path}`);
      expect(page.status).toBe(200);
      expect(page.headers.get('x-content-type-options')).toBe('nosniff');
      expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    }
    for (const path of [
      '/private.sqlite',
      '/auth.html',
      '/%61ccount',
      '/assets/../private.sqlite',
      '/assets/%2e%2e%5cprivate.sqlite',
    ]) {
      const page = await fetch(`${server.url}${path}`);
      expect([400, 404]).toContain(page.status);
      expect(await page.text()).not.toContain('PRIVATE_SENTINEL');
    }
    expect((await fetch(`${server.url}/api/config`, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${server.url}/account`, { method: 'POST' })).status).toBe(405);
  });

  it('serves truthful public capability state and gates accounts before secrets and email are configured', async () => {
    const { server, config } = await fixture();
    const capabilities = await fetch(`${server.url}/api/config`);
    expect(await capabilities.json()).toEqual({ registrationEnabled: false, emailEnabled: false });
    const signup = await fetch(`${server.url}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.origin },
      body: JSON.stringify({
        name: 'Ada',
        email: 'ada@example.test',
        password: 'a-long-test-password',
      }),
    });
    expect(signup.status).toBe(503);
    expect(await signup.json()).toMatchObject({ code: 'AUTH_NOT_CONFIGURED' });
    const account = await fetch(`${server.url}/account`, { redirect: 'manual' });
    expect(account.status).toBe(303);
    expect(account.headers.get('location')).toBe('/login?next=%2Faccount');
  });
});

const configuredEnv = {
  CLOUD_AUTH_SECRET: '4ae7f8a99de02cd87366d4a8b3e23682624e3dfdc67d251cf40cfd8a8d78fbcc',
  CLOUD_ALLOW_SIGNUP: 'true',
  CLOUD_SMTP_HOST: 'smtp.example.test',
  CLOUD_SMTP_FROM: 'SYNC-THINK <accounts@example.test>',
};

describe('cloud account lifecycle over HTTP', () => {
  it('bounds total auth traffic even when reset-link paths vary', async () => {
    const { server } = await fixture(configuredEnv, { sendMail: async () => undefined });
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const result = await fetch(`${server.url}/api/auth/reset-password/unknown-${attempt}`, {
        redirect: 'manual',
      });
      expect(result.status).not.toBe(429);
    }
    const limited = await fetch(`${server.url}/api/auth/reset-password/another-unknown`, {
      redirect: 'manual',
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });

  it('keeps signup opt-in and reports unavailable email actions without pretending to send mail', async () => {
    const { server, config } = await fixture({
      CLOUD_AUTH_SECRET: configuredEnv.CLOUD_AUTH_SECRET,
      CLOUD_ALLOW_SIGNUP: 'true',
    });
    for (const path of ['sign-up/email', 'send-verification-email', 'request-password-reset']) {
      const result = await fetch(`${server.url}/api/auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: config.origin },
        body: JSON.stringify({
          name: 'Ada',
          email: 'ada@example.test',
          password: 'a-long-test-password',
        }),
      });
      expect(result.status).toBe(503);
      expect(await result.json()).toMatchObject({ code: 'EMAIL_NOT_CONFIGURED' });
    }
    const closed = await fixture(
      { ...configuredEnv, CLOUD_ALLOW_SIGNUP: 'false' },
      { sendMail: async () => undefined },
    );
    expect(await (await fetch(`${closed.server.url}/api/config`)).json()).toEqual({
      registrationEnabled: false,
      emailEnabled: true,
    });
    const registration = await fetch(`${closed.server.url}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: closed.config.origin },
      body: JSON.stringify({
        name: 'Ada',
        email: 'ada@example.test',
        password: 'a-long-test-password',
      }),
    });
    expect(registration.status).toBe(403);
    expect(await registration.json()).toMatchObject({ code: 'REGISTRATION_DISABLED' });
  });

  it('rejects cross-site requests and oversized JSON before processing auth', async () => {
    const { server, config } = await fixture(configuredEnv, { sendMail: async () => undefined });
    const endpoint = `${server.url}/api/auth/sign-up/email`;
    const crossSite = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://other.example.test' },
      body: '{}',
    });
    expect(crossSite.status).toBe(403);
    const missingOrigin = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(missingOrigin.status).toBe(403);
    const oversized = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.origin },
      body: JSON.stringify({ name: 'x'.repeat(20_000) }),
    });
    expect(oversized.status).toBe(413);
    const malformed = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.origin },
      body: '{',
    });
    expect(malformed.status).toBe(400);
  });

  it('requires email verification, creates a durable HttpOnly session, and signs out', async () => {
    const mail: AuthMail[] = [];
    const { server: firstServer, config } = await fixture(configuredEnv, {
      sendMail: async (message) => {
        mail.push(message);
      },
    });
    let server = firstServer;
    const credentials = { email: 'ada@example.test', password: 'a-long-test-password' };
    const post = (path: string, body: unknown, cookie = '') =>
      fetch(`${server.url}/api/auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: config.origin, cookie },
        body: JSON.stringify(body),
      });
    expect(await (await fetch(`${server.url}/api/config`)).json()).toEqual({
      registrationEnabled: true,
      emailEnabled: true,
    });
    const signup = await post('sign-up/email', {
      ...credentials,
      name: 'Ada',
      callbackURL: '/login?verified=1',
    });
    expect(signup.status).toBe(200);
    const unverified = await post('sign-in/email', credentials);
    expect(unverified.status).toBe(403);
    await expect.poll(() => mail.length).toBeGreaterThanOrEqual(1);
    const verification = new URL(mail[0].text.match(/https?:\/\/\S+/)![0]);
    const verified = await fetch(`${server.url}${verification.pathname}${verification.search}`, {
      redirect: 'manual',
    });
    expect(verified.status).toBe(302);
    const signedIn = await post('sign-in/email', credentials);
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).not.toHaveProperty('token');
    const cookies = signedIn.headers.getSetCookie();
    expect(cookies.some((cookie) => /httponly/i.test(cookie) && /samesite=lax/i.test(cookie))).toBe(
      true,
    );
    const cookie = cookies.map((value) => value.split(';')[0]).join('; ');
    const session = await fetch(`${server.url}/api/auth/get-session`, { headers: { cookie } });
    const sessionBody = await session.json();
    expect(sessionBody).toMatchObject({ user: { email: credentials.email, emailVerified: true } });
    expect(sessionBody.session).not.toHaveProperty('token');
    await server.close();
    server = await startCloudServer(config, {
      sendMail: async (message) => {
        mail.push(message);
      },
    });
    servers.push(server);
    expect(
      await (await fetch(`${server.url}/api/auth/get-session`, { headers: { cookie } })).json(),
    ).toMatchObject({ user: { email: credentials.email, emailVerified: true } });
    const account = await fetch(`${server.url}/account`, {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(account.status).toBe(200);
    expect(await account.text()).toContain('<title>Account</title>');
    expect((await post('sign-out', {}, cookie)).status).toBe(200);
    const expired = await fetch(`${server.url}/api/auth/get-session`, { headers: { cookie } });
    expect(await expired.json()).toBeNull();
    expect(
      (await fetch(`${server.url}/account`, { headers: { cookie }, redirect: 'manual' })).status,
    ).toBe(303);
  });

  it('rate-limits repeated login attempts across restarts despite forged forwarding headers', async () => {
    const { server, config } = await fixture(configuredEnv, { sendMail: async () => undefined });
    const tryLogin = (url: string) =>
      fetch(`${url}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: config.origin,
          'x-forwarded-for': `192.0.2.${Math.ceil(Math.random() * 200)}`,
          'x-real-ip': `192.0.2.${Math.ceil(Math.random() * 200)}`,
          'x-sync-think-client-ip': `192.0.2.${Math.ceil(Math.random() * 200)}`,
        },
        body: JSON.stringify({ email: 'missing@example.test', password: 'a-long-test-password' }),
      });
    for (let attempt = 0; attempt < 5; attempt += 1)
      expect((await tryLogin(server.url)).status).toBe(401);
    const limited = await tryLogin(server.url);
    expect(limited.status).toBe(429);
    await server.close();
    const restarted = await startCloudServer(config, { sendMail: async () => undefined });
    servers.push(restarted);
    expect((await tryLogin(restarted.url)).status).toBe(429);
  });

  it('rejects callback redirects outside the configured website before sending mail', async () => {
    const mail: AuthMail[] = [];
    const { server, config } = await fixture(configuredEnv, {
      sendMail: async (message) => {
        mail.push(message);
      },
    });
    const response = await fetch(`${server.url}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: config.origin },
      body: JSON.stringify({
        name: 'Ada',
        email: 'redirect@example.test',
        password: 'a-long-test-password',
        callbackURL: 'https://other.example.test/',
      }),
    });
    expect(response.status).toBe(403);
    expect(mail).toHaveLength(0);
  });

  it('resets passwords through a single-use email link and revokes existing sessions', async () => {
    const mail: AuthMail[] = [];
    const { server, config } = await fixture(configuredEnv, {
      sendMail: async (message) => {
        mail.push(message);
      },
    });
    const credentials = { email: 'reset@example.test', password: 'a-long-test-password' };
    const post = (path: string, body: unknown) =>
      fetch(`${server.url}/api/auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: config.origin },
        body: JSON.stringify(body),
      });
    expect(
      (
        await post('sign-up/email', {
          ...credentials,
          name: 'Reset User',
          callbackURL: '/login?verified=1',
        })
      ).status,
    ).toBe(200);
    await expect.poll(() => mail.length).toBe(1);
    const verifyUrl = new URL(mail[0].text.match(/https?:\/\/\S+/)![0]);
    expect(
      (await fetch(`${server.url}${verifyUrl.pathname}${verifyUrl.search}`, { redirect: 'manual' }))
        .status,
    ).toBe(302);
    const signIn = await post('sign-in/email', credentials);
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect(
      (
        await post('request-password-reset', {
          email: credentials.email,
          redirectTo: '/reset-password',
        })
      ).status,
    ).toBe(200);
    await expect.poll(() => mail.length).toBe(2);
    const resetUrl = new URL(mail[1].text.match(/https?:\/\/\S+/)![0]);
    const resetLink = await fetch(`${server.url}${resetUrl.pathname}${resetUrl.search}`, {
      redirect: 'manual',
    });
    expect(resetLink.status).toBe(302);
    const token = new URL(resetLink.headers.get('location')!, config.origin).searchParams.get(
      'token',
    );
    expect(token).toBeTruthy();
    const resetBody = { token, newPassword: 'a-different-long-password' };
    expect((await post('reset-password', resetBody)).status).toBe(200);
    const previousSession = await fetch(`${server.url}/api/auth/get-session`, {
      headers: { cookie },
    });
    expect(await previousSession.json()).toBeNull();
    expect((await post('reset-password', resetBody)).status).toBe(400);
    expect((await post('sign-in/email', credentials)).status).toBe(401);
    expect(
      (await post('sign-in/email', { ...credentials, password: resetBody.newPassword })).status,
    ).toBe(200);
  });
});
