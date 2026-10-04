import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
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
  DemoError,
  DEFAULT_GAME_DESCRIPTION,
  DEFAULT_WORK_DESCRIPTION,
} from './engine.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const json = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
};
const COOKIE = 'sync_think_demo';
function readCookie(req) {
  return (req.headers.cookie ?? '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(COOKIE + '='))
    ?.slice(COOKIE.length + 1);
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 16_000) throw new DemoError('这次输入过长，请缩短内容。', 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DemoError('请求内容应为 JSON。', 400);
  }
}
function fields(data, allowed) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    Object.keys(data).some((key) => !allowed.includes(key))
  )
    throw new DemoError('请求包含未支持的字段；当前身份由服务端决定。', 400);
}

export async function createDemoServer({
  statePath = resolve(ROOT, '.state', 'playground.json'),
  tickMs = 300,
  testOverrides = {},
} = {}) {
  let records = {};
  if (statePath) {
    await mkdir(dirname(statePath), { recursive: true });
    try {
      const saved = JSON.parse(await readFile(statePath, 'utf8'));
      records = saved.version === 1 ? saved.records : {};
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw new Error('Demo 保存文件读取失败，请先保留 .state 数据再排查。', { cause: error });
    }
  }
  let persistTail = Promise.resolve();
  const persist = () => {
    if (!statePath) return Promise.resolve();
    const payload = JSON.stringify({ version: 1, records });
    const operation = persistTail.then(async () => {
      await writeFile(statePath + '.tmp', payload, 'utf8');
      await rename(statePath + '.tmp', statePath);
    });
    persistTail = operation.catch((error) =>
      console.error('Demo state persistence failed:', error.message),
    );
    return operation;
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'",
    );
    try {
      const port = server.address()?.port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(req.headers.host))
        throw new DemoError('仅接受本地 Demo 地址。', 403);
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204);
        return res.end();
      }
      if (url.pathname === '/api/health')
        return json(res, 200, {
          app: 'sync-think-group-chat-demo',
          mockAgents: true,
          port,
          pid: process.pid,
        });
      if (url.pathname.startsWith('/api/')) {
        if (url.search) throw new DemoError('本 Demo 不接受通过查询参数切换成员身份。', 400);
        if (
          req.method === 'POST' &&
          !allowedHosts.some((host) => req.headers.origin === `http://${host}`)
        )
          throw new DemoError('请从本地 Demo 页面发送操作。', 403);
        const supplied = readCookie(req);
        let token = supplied && Object.hasOwn(records, supplied) ? supplied : null;
        if (!token) {
          token = randomBytes(32).toString('hex');
          records[token] = { session: null, requests: {} };
          res.setHeader(
            'Set-Cookie',
            `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1209600`,
          );
        }
        const record = records[token];
        if (req.method === 'GET' && url.pathname === '/api/state')
          return json(res, 200, {
            session: projectSession(record.session),
            defaults: {
              gameDescription: DEFAULT_GAME_DESCRIPTION,
              workDescription: DEFAULT_WORK_DESCRIPTION,
            },
            mockAgents: true,
          });
        if (req.method === 'GET' && url.pathname === '/api/context') {
          if (!record.session) throw new DemoError('请先启动一次活动。');
          const actor =
            record.session.kind === 'game' && record.session.role === 'host' ? 'host' : 'you';
          return json(res, 200, contextFor(record.session, actor));
        }
        if (req.method === 'GET' && url.pathname.startsWith('/api/artifacts/')) {
          const id = url.pathname.slice('/api/artifacts/'.length);
          const artifact = record.session?.artifacts.find((a) => a.id === id && a.published);
          if (!artifact) throw new DemoError('当前活动没有这个已发布产物。', 404);
          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="artifact.md"; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
            'Cache-Control': 'no-store',
          });
          return res.end(artifact.content);
        }
        if (req.method !== 'POST') throw new DemoError('未找到这个入口。', 404);
        const data = await body(req);
        const allowed =
          url.pathname === '/api/start'
            ? ['requestId', 'kind', 'role', 'goal', 'description', 'replace']
            : ['requestId', 'sessionId', 'action', 'text', 'target'];
        fields(data, allowed);
        if (
          typeof data.requestId !== 'string' ||
          data.requestId.length < 8 ||
          data.requestId.length > 100
        )
          throw new DemoError('操作缺少有效请求标识。', 400);
        const fingerprint = JSON.stringify({ path: url.pathname, ...data });
        const prior = record.requests[data.requestId];
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new DemoError('同一个请求标识已用于不同内容。', 409);
          return json(res, 200, { session: projectSession(record.session), duplicate: true });
        }
        if (url.pathname === '/api/start') {
          if (record.session?.status !== 'completed' && record.session && data.replace !== true)
            throw new DemoError('当前活动还在进行，请确认后再重新开始。');
          record.session = createSession({
            kind: data.kind,
            role: data.role,
            goal: data.goal,
            description: data.description,
            ...testOverrides,
          });
          record.requests = {};
        } else if (url.pathname === '/api/action') {
          const s = record.session;
          if (!s || s.id !== data.sessionId)
            throw new DemoError('这次操作属于旧活动，请刷新当前页面。');
          switch (data.action) {
            case 'describe':
              humanDescribe(s, data.text);
              break;
            case 'chat':
              publicChat(s, data.text);
              break;
            case 'vote':
              humanVote(s, data.target);
              break;
            case 'begin-vote':
              beginVote(s);
              break;
            case 'pause':
              pause(s);
              break;
            case 'resume':
              resume(s);
              break;
            case 'interrupt':
              requestInterruption(s);
              break;
            default:
              throw new DemoError('未支持的演示动作。', 400);
          }
        } else throw new DemoError('未找到这个入口。', 404);
        record.requests[data.requestId] = { fingerprint };
        if (Object.keys(record.requests).length > 500)
          delete record.requests[Object.keys(record.requests)[0]];
        await persist();
        return json(res, 200, { session: projectSession(record.session) });
      }
      const staticFile = FILES[url.pathname];
      if (!staticFile || req.method !== 'GET') {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': staticFile[1], 'Cache-Control': 'no-cache' });
      res.end(await readFile(resolve(PUBLIC, staticFile[0])));
    } catch (error) {
      if (!res.headersSent)
        json(res, error instanceof DemoError ? error.status : 500, {
          error:
            error instanceof DemoError ? error.message : '本地 Demo 操作失败，请查看服务日志。',
        });
      else res.end();
      if (!(error instanceof DemoError)) console.error(error);
    }
  });
  const timer =
    tickMs > 0
      ? setInterval(() => {
          let dirty = false;
          for (const record of Object.values(records)) {
            if (!record.session) continue;
            try {
              if (advanceSession(record.session)) dirty = true;
            } catch (error) {
              record.session.status = 'paused';
              record.session.pauseCause = 'internal';
              record.session.revision++;
              dirty = true;
              console.error('Demo tick failed:', error.message);
            }
          }
          if (dirty) void persist().catch(() => {});
        }, tickMs)
      : null;
  timer?.unref();
  server.on('close', () => {
    if (timer) clearInterval(timer);
  });
  return {
    server,
    flush: () => persistTail,
    close: async () => {
      if (timer) clearInterval(timer);
      await persistTail;
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flagIndex = process.argv.indexOf('--port');
  const port = Number(
    flagIndex >= 0 ? process.argv[flagIndex + 1] : (process.env.DEMO_PORT ?? 4319),
  );
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Use a valid local port.');
  const app = await createDemoServer();
  app.server.listen(port, '127.0.0.1', () =>
    console.log(
      `SYNC-THINK group chat demo: http://127.0.0.1:${port}\nLocal rule simulation; no real model calls. PID ${process.pid}`,
    ),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
}
