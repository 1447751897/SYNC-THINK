import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Cookie, CookiesSetDetails } from 'electron';
import type { BrowserDataRequest, BrowserDataResult, BrowserDataSnapshot, BrowserSavedPassword } from '../browser-data.js';
import { embeddedBrowserSessionInfo } from './browser-session-info.js';

interface Encryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}
interface BrowserGuest {
  getType(): string;
  isDestroyed(): boolean;
  hostWebContents?: { id: number };
  getURL(): string;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  session: {
    getStoragePath(): string | null;
    isPersistent(): boolean;
    cookies: { get(filter: Record<string, never>): Promise<Cookie[]>; set(cookie: CookiesSetDetails): Promise<void>; remove(url: string, name: string): Promise<void>; flushStore(): Promise<void> };
    clearStorageData(options: { origin: string; storages: Array<'localstorage' | 'indexdb' | 'cachestorage' | 'serviceworkers'> }): Promise<void>;
    clearCache?(): Promise<void>;
  };
}
interface StoredPassword extends BrowserSavedPassword { profile: string; password: string }
class BrowserDataError extends Error {}
const fail = (message: string): never => { throw new BrowserDataError(message); };
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ENTRIES = 1000;

function origin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) return fail('请输入有效的网站地址');
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return fail('网站地址仅支持 HTTP / HTTPS');
    return parsed.origin;
  } catch { return fail('请输入有效的网站地址'); }
}
function text(value: unknown, max: number, message: string): string {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : fail(message);
}
function passwordInput(value: { origin?: unknown; username?: unknown; password?: unknown }) {
  return { origin: origin(value.origin), username: text(value.username, 1024, '请填写用户名'), password: text(value.password, 4096, '请填写密码') };
}
function domain(value: unknown): string {
  if (typeof value !== 'string' || /[\s/@\\?#]/.test(value)) return fail('站点地址无效');
  const normalized = value.replace(/^\./, '').toLowerCase();
  if (!normalized || normalized.includes('..') || normalized.endsWith('.')) return fail('站点地址无效');
  try {
    const parsed = new URL(`http://${normalized}`);
    if (parsed.hostname !== normalized || parsed.port) return fail('站点地址无效');
    return normalized;
  } catch { return fail('站点地址无效'); }
}

/** Chrome / Edge CSV exports; quoted commas, escaped quotes and CRLF are supported. */
export function parsePasswordCsv(csv: string): Array<{ origin: string; username: string; password: string }> {
  if (Buffer.byteLength(csv) > MAX_BYTES) return fail('导入文件超过 2 MB');
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '"') {
      if (quoted && csv[index + 1] === '"') { cell += '"'; index++; } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(cell); cell = '';
      if (char !== ',') { rows.push(row); row = []; if (char === '\r' && csv[index + 1] === '\n') index++; }
    } else cell += char;
  }
  if (quoted) return fail('CSV 引号未闭合');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() ?? []).map(header => header.replace(/^\uFEFF/, '').trim().toLowerCase());
  const indexes = ['url', 'username', 'password'].map(header => headers.indexOf(header));
  if (indexes.some(index => index < 0)) return fail('CSV 需要 url、username、password 三列');
  const records = rows.filter(fields => fields.some(Boolean));
  if (records.length > MAX_ENTRIES) return fail('单次导入最多 1000 条记录');
  return records.map(fields => passwordInput({ origin: fields[indexes[0]], username: fields[indexes[1]], password: fields[indexes[2]] }));
}

/** Cookie values stay in main; the renderer receives counts only. */
export function parseCookieJson(json: string): CookiesSetDetails[] {
  if (Buffer.byteLength(json) > MAX_BYTES) return fail('导入文件超过 2 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return fail('Cookie JSON 格式无效'); }
  const records = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { cookies?: unknown }).cookies : null;
  if (!Array.isArray(records) || records.length > MAX_ENTRIES) return fail('Cookie JSON 应包含 cookies 数组，最多 1000 条');
  return records.map(raw => {
    if (!raw || typeof raw !== 'object') return fail('Cookie 记录格式无效');
    const item = raw as Record<string, unknown>;
    const host = domain(item.domain);
    const secure = item.secure === true;
    const path = typeof item.path === 'string' && item.path.startsWith('/') && item.path.length <= 4096 ? item.path : '/';
    const sameSite = typeof item.sameSite === 'string' ? item.sameSite.toLowerCase().replace('none', 'no_restriction') : 'unspecified';
    if (!['unspecified', 'no_restriction', 'lax', 'strict'].includes(sameSite)) return fail('Cookie SameSite 格式无效');
    if (typeof item.name !== 'string' || /[\r\n;]/.test(item.name) || item.name.length > 4096 || typeof item.value !== 'string' || /[\r\n]/.test(item.value) || item.value.length > 16384) return fail('Cookie 名称或内容格式无效');
    const expiration = item.expirationDate ?? item.expires;
    if (expiration !== undefined && (typeof expiration !== 'number' || !Number.isFinite(expiration))) return fail('Cookie 过期时间格式无效');
    return {
      url: `${secure ? 'https' : 'http'}://${host}${path}`, name: item.name, value: item.value, path, secure, httpOnly: item.httpOnly === true,
      ...(typeof item.domain === 'string' && (item.domain.startsWith('.') || item.hostOnly === false) ? { domain: `.${host}` } : {}),
      ...(typeof expiration === 'number' && expiration >= 0 ? { expirationDate: expiration } : {}),
      sameSite: sameSite as CookiesSetDetails['sameSite'],
    };
  });
}

// Only visible, unambiguous login fields in the top frame. Never submits a form.
const LOGIN_FIELDS = `
  const visible = element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter(element => visible(element) && !element.disabled && !element.readOnly && element.autocomplete !== 'new-password');
  if (passwords.length > 1 || [...document.querySelectorAll('input[autocomplete="new-password"]')].some(visible)) return { ok: false };
  const password = passwords[0];
  const scope = password?.form || document;
  const candidates = [...scope.querySelectorAll('input')].filter(element => visible(element) && !element.disabled && !element.readOnly && element !== password);
  let usernames = candidates.filter(element => element.autocomplete === 'username' || element.type === 'email');
  if (!usernames.length) usernames = candidates.filter(element => element.type === 'text' && element.autocomplete !== 'one-time-code');
  if (usernames.length > 1 || (!password && !usernames.length)) return { ok: false };
  const username = usernames[0];
`;
export function browserPasswordCaptureScript(expectedOrigin: string): string {
  return `(() => { if (location.origin !== ${JSON.stringify(expectedOrigin)}) return { ok: false }; ${LOGIN_FIELDS} if (!username || !password) return { ok: false }; return { ok: true, origin: location.origin, username: username.value, password: password.value }; })()`;
}
export function browserPasswordFillScript(entry: { origin: string; username: string; password: string }): string {
  return `(() => { if (location.origin !== ${JSON.stringify(entry.origin)}) return { ok: false }; ${LOGIN_FIELDS}
    const set = (element, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); };
    if (username) set(username, ${JSON.stringify(entry.username)}); if (password) set(password, ${JSON.stringify(entry.password)}); return { ok: true }; })()`;
}

export class BrowserDataService {
  private busy = Promise.resolve();
  constructor(private readonly options: {
    vaultPath: string;
    encryption: Encryption;
    getGuest(id: number): BrowserGuest | undefined;
    chooseImportFile(): Promise<string | undefined>;
  }) {}

  handle(senderId: number, request: BrowserDataRequest): Promise<BrowserDataResult> {
    const result = this.busy.then(() => this.run(senderId, request));
    this.busy = result.then(() => undefined, () => undefined);
    return result;
  }
  private encryptionAvailable(): boolean {
    return this.options.encryption.isEncryptionAvailable() && this.options.encryption.getSelectedStorageBackend?.() !== 'basic_text';
  }
  private readPasswords(): StoredPassword[] {
    if (!existsSync(this.options.vaultPath)) return [];
    if (!this.encryptionAvailable()) return fail('系统加密服务暂未就绪');
    try {
      if (statSync(this.options.vaultPath).size > MAX_BYTES * 4) return fail('密码库大小异常');
      const value = JSON.parse(this.options.encryption.decryptString(readFileSync(this.options.vaultPath))) as { version: number; entries: StoredPassword[] };
      if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) return fail('密码库格式异常');
      return value.entries.map(entry => {
        const checked = passwordInput(entry);
        return { ...checked, id: text(entry.id, 128, '密码库格式异常'), profile: text(entry.profile, 128, '密码库格式异常'), updatedAt: text(entry.updatedAt, 128, '密码库格式异常') };
      });
    } catch { return fail('密码库读取失败，请检查系统加密服务'); }
  }
  private writePasswords(entries: StoredPassword[]): void {
    if (!this.encryptionAvailable()) return fail('系统加密服务暂未就绪，密码未保存');
    if (entries.length > MAX_ENTRIES) return fail('密码库最多保存 1000 条记录');
    mkdirSync(dirname(this.options.vaultPath), { recursive: true });
    const encrypted = this.options.encryption.encryptString(JSON.stringify({ version: 1, entries }));
    const temporary = `${this.options.vaultPath}.tmp`;
    writeFileSync(temporary, encrypted, { mode: 0o600 });
    renameSync(temporary, this.options.vaultPath);
  }
  private profile(guest: BrowserGuest): string {
    const path = guest.session.getStoragePath();
    if (!path || !guest.session.isPersistent()) return fail('临时资料仅支持 Cookie 查看和清理');
    return createHash('sha256').update(path).digest('hex');
  }
  private upsert(guest: BrowserGuest, values: Array<{ origin: string; username: string; password: string }>): void {
    const profile = this.profile(guest);
    const entries = this.readPasswords();
    for (const value of values) {
      const existing = entries.find(entry => entry.profile === profile && entry.origin === value.origin && entry.username === value.username);
      if (existing) { existing.password = value.password; existing.updatedAt = new Date().toISOString(); }
      else entries.push({ ...value, profile, id: randomUUID(), updatedAt: new Date().toISOString() });
    }
    this.writePasswords(entries);
  }
  private async snapshot(guest: BrowserGuest): Promise<BrowserDataSnapshot> {
    const path = guest.session.getStoragePath();
    const profile = path ? createHash('sha256').update(path).digest('hex') : undefined;
    const sites = new Map<string, { domain: string; count: number; persistentCount: number }>();
    for (const cookie of await guest.session.cookies.get({})) {
      const host = domain(cookie.domain);
      const site = sites.get(host) ?? { domain: host, count: 0, persistentCount: 0 };
      site.count++; if (!cookie.session && cookie.expirationDate) site.persistentCount++;
      sites.set(host, site);
    }
    const available = this.encryptionAvailable();
    const passwords = profile && available ? this.readPasswords().filter(entry => entry.profile === profile).map(({ id, origin, username, updatedAt }) => ({ id, origin, username, updatedAt })) : [];
    return { storagePath: path, persistent: guest.session.isPersistent(), encryptionAvailable: available, passwords, sites: [...sites.values()].sort((a, b) => a.domain.localeCompare(b.domain)) };
  }
  private async run(senderId: number, request: BrowserDataRequest): Promise<BrowserDataResult> {
    try {
      if (!request || !Number.isSafeInteger(request.webContentsId) || request.webContentsId <= 0) return fail('浏览器页面尚未就绪');
      const guest = this.options.getGuest(request.webContentsId);
      if (!guest || guest.isDestroyed()) return fail('浏览器页面已关闭');
      embeddedBrowserSessionInfo(guest, senderId);
      let message: string | undefined;
      switch (request.action) {
        case 'list': break;
        case 'save-password': this.upsert(guest, [passwordInput(request)]); message = '密码已加密保存'; break;
        case 'save-from-page': {
          const expected = origin(guest.getURL());
          const result = await guest.executeJavaScript(browserPasswordCaptureScript(expected), true) as { ok?: boolean; origin?: string; username?: string; password?: string };
          if (!result?.ok || result.origin !== expected || origin(guest.getURL()) !== expected) return fail('未找到唯一的登录表单，请在密码管理器中手动添加');
          this.upsert(guest, [passwordInput(result)]); message = '当前登录信息已加密保存'; break;
        }
        case 'delete-password': case 'fill-password': {
          const profile = this.profile(guest); const entries = this.readPasswords();
          const entry = entries.find(item => item.id === request.id && item.profile === profile);
          if (!entry) return fail('该密码记录已不存在');
          if (request.action === 'delete-password') { this.writePasswords(entries.filter(item => item !== entry)); message = '密码记录已删除'; }
          else {
            if (origin(guest.getURL()) !== entry.origin) return fail('请先打开与密码记录完全相同的网站地址');
            const result = await guest.executeJavaScript(browserPasswordFillScript(entry), true) as { ok?: boolean };
            if (!result?.ok) return fail('当前页面没有唯一可填写的登录表单');
            message = '已填入登录信息，尚未点击登录';
          }
          break;
        }
        case 'autofill': {
          // NewMax fills the matching entry right after a page settles; a page
          // with no saved entry (or no unique login form) is a silent no-op.
          const profile = this.profile(guest);
          let current: string;
          try { current = origin(guest.getURL()); } catch { return { ok: true, snapshot: await this.snapshot(guest) }; }
          const entry = this.readPasswords().find(item => item.profile === profile && item.origin === current);
          if (!entry) return { ok: true, snapshot: await this.snapshot(guest) };
          const result = await guest.executeJavaScript(browserPasswordFillScript(entry), true) as { ok?: boolean };
          if (!result?.ok) return { ok: true, snapshot: await this.snapshot(guest) };
          message = '已自动填入登录信息';
          break;
        }
        case 'clear-session': {
          // Expire every Cookie of this profile's session one key at a time:
          // clearStorageData({storages:['cookies']}) can wipe a whole
          // registrable domain, not only the host that was displayed.
          const cookies = await guest.session.cookies.get({});
          const hosts = new Set<string>();
          for (const cookie of cookies) {
            try { hosts.add(domain(cookie.domain)); } catch { continue; }
          }
          try { hosts.add(new URL(guest.getURL()).hostname); } catch { /* Blank tab. */ }
          for (const cookie of cookies) {
            let host: string;
            try { host = domain(cookie.domain); } catch { continue; }
            await guest.session.cookies.set({
              url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
              name: cookie.name, value: '', path: cookie.path || '/',
              ...(!cookie.hostOnly ? { domain: cookie.domain } : {}),
              secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, expirationDate: 1,
            });
          }
          for (const host of hosts) {
            for (const siteOrigin of [`http://${host}`, `https://${host}`]) {
              await guest.session.clearStorageData({ origin: siteOrigin, storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers'] });
            }
          }
          await guest.session.clearCache?.();
          await guest.session.cookies.flushStore();
          message = '浏览数据已清除';
          break;
        }
        case 'clear-site': {
          const host = domain(request.domain);
          const cookies = (await guest.session.cookies.get({})).filter(cookie => domain(cookie.domain) === host);
          // Expire the exact host/domain/path cookie key. cookies.remove(url,
          // name) could select a parent-domain cookie with the same name.
          for (const cookie of cookies) await guest.session.cookies.set({
            url: `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`,
            name: cookie.name, value: '', path: cookie.path || '/',
            ...(!cookie.hostOnly ? { domain: cookie.domain } : {}),
            secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, expirationDate: 1,
          });
          // Do not use clearStorageData({storages:['cookies']}): Electron can
          // clear a whole registrable domain, not just the displayed cookie host.
          const origins = new Set([`http://${host}`, `https://${host}`]);
          try { const current = new URL(guest.getURL()); if (current.hostname === host) origins.add(current.origin); } catch { /* Blank tab. */ }
          for (const siteOrigin of origins) await guest.session.clearStorageData({ origin: siteOrigin, storages: ['localstorage', 'indexdb', 'cachestorage', 'serviceworkers'] });
          await guest.session.cookies.flushStore(); message = '该站点的 Cookie 与站点存储已清除'; break;
        }
        case 'import-file': {
          this.profile(guest);
          const file = await this.options.chooseImportFile();
          if (!file) break;
          if (guest.isDestroyed()) return fail('浏览器页面已关闭，导入已取消');
          if (statSync(file).size > MAX_BYTES) return fail('导入文件超过 2 MB');
          const contents = readFileSync(file, 'utf8');
          if (/\.csv$/i.test(file)) { const entries = parsePasswordCsv(contents); this.upsert(guest, entries); message = `已导入 ${entries.length} 条密码记录`; }
          else if (/\.json$/i.test(file)) {
            const cookies = parseCookieJson(contents); let imported = 0; let skipped = 0; let failed = 0;
            for (const cookie of cookies) {
              if (cookie.expirationDate !== undefined && cookie.expirationDate <= Date.now() / 1000) { skipped++; continue; }
              try { await guest.session.cookies.set(cookie); imported++; } catch { failed++; }
            }
            await guest.session.cookies.flushStore(); message = `Cookie：导入 ${imported} 条，已过期 ${skipped} 条，失败 ${failed} 条`;
          } else return fail('请选择密码 CSV 或 Cookie JSON 文件');
          break;
        }
        default: return fail('不支持的浏览器资料操作');
      }
      return { ok: true, snapshot: await this.snapshot(guest), message };
    } catch (error) { return { ok: false, error: error instanceof BrowserDataError ? error.message : '浏览器资料操作失败，请重试' }; }
  }
}
