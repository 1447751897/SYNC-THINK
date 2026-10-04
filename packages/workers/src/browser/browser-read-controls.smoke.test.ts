import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { BrowserHost } from './browser-host.js';

it.runIf(process.env.SYNC_THINK_BROWSER_SMOKE === '1')('reads visible icon controls and uses the returned locator to check in without duplicate submission', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-read-controls-'));
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <div title="每日签到" style="display:none">隐藏重复</div>
      <div class="sign-calendar" title="每日签到" tabindex="0" style="cursor:pointer;width:40px;height:40px" onclick="if(!window.signed){window.signed=true;window.submissions=(window.submissions||0)+1;}document.querySelector('#status').textContent='今日已签到；提交次数 '+window.submissions"><svg width="30" height="30" aria-hidden="true"><rect width="30" height="30" /></svg></div>
      <div class="icon-custom" style="cursor:pointer;width:40px;height:40px"><svg width="30" height="30"><title>日历</title><rect width="30" height="30" /></svg></div>
      <input type="PaSSword" value="private-fixture-password" /><input type="hidden" value="private-fixture-token" />
      <p id="status">今日未签到</p>
    </body></html>`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const host = new BrowserHost({ profileRoot: join(root, 'profiles') });
  try {
    const lease = await host.acquireLease({ profileId: 'fixture', ownerId: 'test:read-controls' });
    const options = { leaseId: lease.leaseId, allowedSites: [origin], timeoutMs: 15000 };
    await host.execute({ ...options, action: { kind: 'navigate', url: origin } });
    const read = await host.execute({ ...options, action: { kind: 'read' } });
    expect(read.viewport).toMatchObject({ width: expect.any(Number), height: expect.any(Number), devicePixelRatio: expect.any(Number) });
    expect(read.controls).toEqual(expect.arrayContaining([expect.objectContaining({ name: '每日签到', tag: 'div', selector: expect.any(String), x: expect.any(Number), y: expect.any(Number) })]));
    expect(read.controls?.filter(c => c.name === '每日签到')).toHaveLength(1);
    // aria-hidden hides an icon from accessibility, not from a visual browser operator.
    expect(read.controls).toEqual(expect.arrayContaining([expect.objectContaining({ tag: 'svg', role: 'icon', inViewport: true })]));
    expect(read.controls).toEqual(expect.arrayContaining([expect.objectContaining({ name: '日历' })]));
    expect(JSON.stringify(read)).not.toContain('private-fixture-password');
    expect(JSON.stringify(read)).not.toContain('private-fixture-token');
    const button = read.controls!.find(c => c.name === '每日签到')!;
    const scoped = await host.execute({ ...options, action: { kind: 'read', selector: button.selector } });
    expect(scoped.controls).toEqual(expect.arrayContaining([expect.objectContaining({ name: '每日签到' })]));
    await host.execute({ ...options, action: { kind: 'click', selector: button.selector } });
    const after = await host.execute({ ...options, action: { kind: 'read', selector: '#status' } });
    expect(after.text).toBe('今日已签到；提交次数 1');
    const repeat = await host.execute({ ...options, action: { kind: 'read', selector: '#status' } });
    expect(repeat.text).toBe('今日已签到；提交次数 1');
  } finally {
    await host.shutdown(); await new Promise<void>(r => server.close(() => r()));
    const cleanupPath = relative(tmpdir(), root);
    if (!cleanupPath || cleanupPath.startsWith('..') || isAbsolute(cleanupPath)) throw new Error('unexpected fixture root');
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 60000);


it.runIf(process.env.SYNC_THINK_BROWSER_SMOKE === '1')('waits briefly for an initially empty SPA to expose its controls before returning a default read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-read-hydration-'));
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body><script>setTimeout(() => {document.body.innerHTML='<button id="ready">签到日历</button>'}, 800)</script></body></html>`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no port');
  const origin = 'http://127.0.0.1:' + address.port;
  const host = new BrowserHost({ profileRoot: join(root, 'profiles') });
  try {
    const lease = await host.acquireLease({ profileId: 'fixture', ownerId: 'test:hydration' });
    const options = { leaseId: lease.leaseId, allowedSites: [origin], timeoutMs: 15000 };
    await host.execute({ ...options, action: { kind: 'navigate', url: origin } });
    const read = await host.execute({ ...options, action: { kind: 'read' } });
    expect(read.text).toBe('签到日历');
    expect(read.controls).toEqual(expect.arrayContaining([expect.objectContaining({ name: '签到日历', selector: '#ready' })]));
  } finally {
    await host.shutdown(); await new Promise<void>(r => server.close(() => r()));
    const cleanupPath = relative(tmpdir(), root);
    if (!cleanupPath || cleanupPath.startsWith('..') || isAbsolute(cleanupPath)) throw new Error('unexpected fixture root');
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 60000);

it.runIf(process.env.SYNC_THINK_BROWSER_SMOKE === '1')('prioritizes the visible dialog in a default read instead of truncating it behind the underlying long page', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-think-read-dialog-'));
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body><p>${'底层无关热榜内容。'.repeat(3000)}</p><div role="dialog" style="display:none">隐藏旧弹窗</div><div role="dialog" style="position:fixed;top:20px;left:20px;background:white;padding:20px"><h2>签到日历</h2><p>2026年10月；今日已签到</p><button id="close">关闭</button></div></body></html>`);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no port');
  const origin = `http://127.0.0.1:${address.port}`;
  const host = new BrowserHost({ profileRoot: join(root, 'profiles') });
  try {
    const lease = await host.acquireLease({ profileId: 'fixture', ownerId: 'test:dialog' });
    const options = { leaseId: lease.leaseId, allowedSites: [origin], timeoutMs: 15000 };
    await host.execute({ ...options, action: { kind: 'navigate', url: origin } });
    const read = await host.execute({ ...options, action: { kind: 'read' } });
    expect(read.text).toContain('今日已签到');
    expect(read.text).not.toContain('底层无关');
    expect(read.text).not.toContain('隐藏旧弹窗');
    expect(read.controls).toEqual(expect.arrayContaining([expect.objectContaining({ name: '关闭', selector: '#close' })]));
  } finally {
    await host.shutdown(); await new Promise<void>(r => server.close(() => r()));
    const cleanupPath = relative(tmpdir(), root);
    if (!cleanupPath || cleanupPath.startsWith('..') || isAbsolute(cleanupPath)) throw new Error('unexpected fixture root');
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 60000);
