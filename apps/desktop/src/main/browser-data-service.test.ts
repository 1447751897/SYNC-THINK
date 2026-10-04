import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { Cookie, CookiesSetDetails } from 'electron';
import { BrowserDataService, parseCookieJson, parsePasswordCsv } from './browser-data-service.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'browser-data-test-'));
  const key = randomBytes(32);
  const encryption = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString(value: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]); },
    decryptString(value: Buffer) { const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(-16)); return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString('utf8'); },
  };
  const cookie = (host: string, name: string, value: string): Cookie => ({ domain: host, name, value, path: '/', secure: true, httpOnly: true, session: false, expirationDate: 2147483647, sameSite: 'lax', hostOnly: !host.startsWith('.') });
  const cookies = [cookie('.example.test', 'session', 'fixture-cookie-secret'), cookie('other.test', 'session', 'other-secret'), cookie('login.example.test', 'session', 'child-secret')];
  const session = {
    getStoragePath: vi.fn(() => join(root, 'profile-a')),
    isPersistent: vi.fn(() => true),
    cookies: { get: vi.fn(async () => cookies), set: vi.fn(async (_cookie: CookiesSetDetails) => undefined), remove: vi.fn(async () => undefined), flushStore: vi.fn(async () => undefined) },
    clearStorageData: vi.fn(async (_options: { origin: string; storages: string[] }) => undefined),
  };
  const guest = { getType: () => 'webview', isDestroyed: vi.fn(() => false), hostWebContents: { id: 10 }, getURL: vi.fn(() => 'https://example.test/login'), executeJavaScript: vi.fn(async () => ({ ok: true })), session };
  const chooseImportFile = vi.fn(async (): Promise<string | undefined> => undefined);
  const vaultPath = join(root, 'passwords.encrypted');
  const options = { vaultPath, encryption, getGuest: vi.fn(() => guest), chooseImportFile };
  return { root, guest, session, encryption, chooseImportFile, vaultPath, options, service: new BrowserDataService(options) };
}

describe('browser password and Cookie broker', () => {
  it('lists only metadata, never Cookie values or password secrets', async () => {
    const f = fixture();
    const result = await f.service.handle(10, { action: 'list', webContentsId: 42 });
    expect(result).toMatchObject({ ok: true, snapshot: { persistent: true, encryptionAvailable: true, sites: [{ domain: 'example.test', count: 1, persistentCount: 1 }, { domain: 'login.example.test', count: 1, persistentCount: 1 }, { domain: 'other.test', count: 1, persistentCount: 1 }] } });
    expect(JSON.stringify(result)).not.toContain('fixture-cookie-secret');
  });
  it('encrypts the complete vault and persists it across service recreation', async () => {
    const f = fixture();
    const saved = await f.service.handle(10, { action: 'save-password', webContentsId: 42, origin: 'https://example.test/login', username: 'fixture-user', password: 'fixture-password-secret' });
    expect(saved).toMatchObject({ ok: true, snapshot: { passwords: [{ origin: 'https://example.test', username: 'fixture-user' }] } });
    expect(JSON.stringify(saved)).not.toContain('fixture-password-secret');
    const bytes = readFileSync(f.vaultPath).toString('utf8');
    expect(bytes).not.toContain('fixture-password-secret'); expect(bytes).not.toContain('fixture-user');
    expect(await new BrowserDataService(f.options).handle(10, { action: 'list', webContentsId: 42 })).toMatchObject({ ok: true, snapshot: { passwords: [{ username: 'fixture-user' }] } });
  });
  it('isolates saved passwords by actual guest storage directory', async () => {
    const f = fixture();
    await f.service.handle(10, { action: 'save-password', webContentsId: 42, origin: 'https://example.test', username: 'fixture-user', password: 'fixture-password' });
    f.session.getStoragePath.mockReturnValue(join(f.root, 'profile-b'));
    expect(await f.service.handle(10, { action: 'list', webContentsId: 42 })).toMatchObject({ ok: true, snapshot: { passwords: [] } });
  });
  it('rejects access to another window guest before reading data', async () => {
    const f = fixture();
    expect(await f.service.handle(99, { action: 'list', webContentsId: 42 })).toMatchObject({ ok: false });
    expect(f.session.cookies.get).not.toHaveBeenCalled();
  });
  it('rejects temporary-profile password storage and unavailable system encryption', async () => {
    const f = fixture();
    f.session.isPersistent.mockReturnValue(false);
    expect(await f.service.handle(10, { action: 'save-password', webContentsId: 42, origin: 'https://example.test', username: 'user', password: 'secret' })).toMatchObject({ ok: false });
    f.session.isPersistent.mockReturnValue(true); f.encryption.isEncryptionAvailable.mockReturnValue(false);
    expect(await f.service.handle(10, { action: 'save-password', webContentsId: 42, origin: 'https://example.test', username: 'user', password: 'secret' })).toMatchObject({ ok: false });
  });
  it('fills only the matching origin and never returns secrets to the renderer', async () => {
    const f = fixture();
    const saved = await f.service.handle(10, { action: 'save-password', webContentsId: 42, origin: 'https://example.test', username: 'user', password: 'fill-secret' });
    if (!saved.ok) throw new Error('save failed');
    const id = saved.snapshot.passwords[0].id;
    f.guest.getURL.mockReturnValue('https://wrong.test/login');
    expect(await f.service.handle(10, { action: 'fill-password', webContentsId: 42, id })).toMatchObject({ ok: false });
    expect(f.guest.executeJavaScript).not.toHaveBeenCalled();
    f.guest.getURL.mockReturnValue('https://example.test/login');
    const filled = await f.service.handle(10, { action: 'fill-password', webContentsId: 42, id });
    expect(filled).toMatchObject({ ok: true }); expect(JSON.stringify(filled)).not.toContain('fill-secret');
    expect(f.guest.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('location.origin !== "https://example.test"'), true);
  });
  it('captures a current login only after explicit action and validates the returned origin', async () => {
    const f = fixture();
    f.guest.executeJavaScript.mockResolvedValue({ ok: true, origin: 'https://wrong.test', username: 'user', password: 'secret' } as { ok: boolean });
    expect(await f.service.handle(10, { action: 'save-from-page', webContentsId: 42 })).toMatchObject({ ok: false });
    f.guest.executeJavaScript.mockResolvedValue({ ok: true, origin: 'https://example.test', username: 'user', password: 'secret' } as { ok: boolean });
    expect(await f.service.handle(10, { action: 'save-from-page', webContentsId: 42 })).toMatchObject({ ok: true, snapshot: { passwords: [{ username: 'user' }] } });
  });
  it('expires the exact domain/path key without clearing unrelated domains or the host app session', async () => {
    const f = fixture();
    expect(await f.service.handle(10, { action: 'clear-site', webContentsId: 42, domain: 'login.example.test' })).toMatchObject({ ok: true });
    expect(f.session.cookies.set).toHaveBeenCalledTimes(1);
    expect(f.session.cookies.set).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://login.example.test/', name: 'session', value: '', expirationDate: 1 }));
    expect(f.session.cookies.remove).not.toHaveBeenCalled();
    expect(f.session.clearStorageData.mock.calls.every(([options]) => !JSON.stringify(options).includes('file:') && !JSON.stringify(options).includes('"cookies"'))).toBe(true);
  });
  it('autofills the matching origin silently and never a mismatched one', async () => {
    const f = fixture();
    await f.service.handle(10, { action: 'save-password', webContentsId: 42, origin: 'https://example.test', username: 'user', password: 'autofill-secret' });
    f.guest.executeJavaScript.mockClear();
    expect(await f.service.handle(10, { action: 'autofill', webContentsId: 42 })).toMatchObject({ ok: true, message: '已自动填入登录信息' });
    expect(f.guest.executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('location.origin !== "https://example.test"'), true);
    f.guest.executeJavaScript.mockClear(); f.guest.getURL.mockReturnValue('https://wrong.test/login');
    expect(await f.service.handle(10, { action: 'autofill', webContentsId: 42 })).toMatchObject({ ok: true });
    expect(f.guest.executeJavaScript).not.toHaveBeenCalled();
  });
  it('treats a page without a saved login as a silent autofill no-op', async () => {
    const f = fixture();
    expect(await f.service.handle(10, { action: 'autofill', webContentsId: 42 })).toMatchObject({ ok: true });
    expect(f.guest.executeJavaScript).not.toHaveBeenCalled();
  });
  it('clears every Cookie and site storage of this profile without touching another profile', async () => {
    const f = fixture();
    expect(await f.service.handle(10, { action: 'clear-session', webContentsId: 42 })).toMatchObject({ ok: true, message: '浏览数据已清除' });
    expect(f.session.cookies.set).toHaveBeenCalledTimes(3);
    for (const [written] of f.session.cookies.set.mock.calls) {
      expect(written).toMatchObject({ value: '', expirationDate: 1 });
      expect(written.url).toMatch(/^https?:\/\/[^/]+\//);
    }
    expect(f.session.clearStorageData).toHaveBeenCalledWith({ origin: 'https://example.test', storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers'] });
    expect(f.session.clearStorageData).toHaveBeenCalledWith({ origin: 'http://example.test', storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers'] });
    expect(f.session.cookies.flushStore).toHaveBeenCalled();
    expect(f.session.clearStorageData.mock.calls.every(([options]) => !JSON.stringify(options).includes('"cookies"'))).toBe(true);
  });
  it('imports CSV in main and imports valid JSON Cookies while reporting expired records', async () => {
    const f = fixture(); const csv = join(f.root, 'passwords.csv');
    writeFileSync(csv, 'name,url,username,password\nFixture,https://example.test,user,import-secret'); f.chooseImportFile.mockResolvedValue(csv);
    const imported = await f.service.handle(10, { action: 'import-file', webContentsId: 42 });
    expect(imported).toMatchObject({ ok: true, message: '已导入 1 条密码记录' }); expect(JSON.stringify(imported)).not.toContain('import-secret');
    const json = join(f.root, 'cookies.json');
    writeFileSync(json, JSON.stringify({ cookies: [
      { name: 'auth', value: 'cookie-secret', domain: '.example.test', secure: true, path: '/', expires: 2147483647, sameSite: 'None' },
      { name: 'expired', value: 'expired-secret', domain: 'example.test', expires: 1 },
      { name: 'epoch', value: 'expired-secret', domain: 'example.test', expires: 0 },
      { name: 'session', value: 'session-secret', domain: 'example.test', expires: -1 },
    ] }));
    f.chooseImportFile.mockResolvedValue(json);
    expect(await f.service.handle(10, { action: 'import-file', webContentsId: 42 })).toMatchObject({ ok: true, message: 'Cookie：导入 2 条，已过期 2 条，失败 0 条' });
    expect(f.session.cookies.set).toHaveBeenCalledWith(expect.objectContaining({ name: 'auth', sameSite: 'no_restriction', secure: true }));
    expect(f.session.cookies.set).toHaveBeenCalledTimes(2);
    expect(f.session.cookies.set.mock.calls[1][0]).not.toHaveProperty('expirationDate');
  });
  it('canceled import leaves data unchanged and malformed input never reaches Cookie writes', async () => {
    const f = fixture();
    expect(await f.service.handle(10, { action: 'import-file', webContentsId: 42 })).toMatchObject({ ok: true });
    const bad = join(f.root, 'cookies.json'); writeFileSync(bad, '[{"name":"auth","value":"secret","domain":"https://wrong.test"}]'); f.chooseImportFile.mockResolvedValue(bad);
    expect(await f.service.handle(10, { action: 'import-file', webContentsId: 42 })).toMatchObject({ ok: false }); expect(f.session.cookies.set).not.toHaveBeenCalled();
  });
});

describe('browser imports', () => {
  it('parses BOM, quoted commas, escaped quotes, and CRLF in Chrome / Edge CSV', () => {
    expect(parsePasswordCsv('\uFEFFname,url,username,password\r\nExample,https://example.test/login,"u,ser","p""ass"')).toEqual([{ origin: 'https://example.test', username: 'u,ser', password: 'p"ass' }]);
  });
  it('validates the complete import and rejects unsupported schemes or missing columns', () => {
    expect(() => parsePasswordCsv('url,username,password\nfile:///tmp/a,user,secret')).toThrow();
    expect(() => parsePasswordCsv('url,username\nhttps://example.test,user')).toThrow();
    expect(() => parsePasswordCsv('url,username,password\nhttps://example.test,user,"secret')).toThrow();
    expect(() => parseCookieJson(JSON.stringify([{ domain: 'example.test', name: 'auth', value: 'secret', expires: 'bad' }]))).toThrow();
  });
});
